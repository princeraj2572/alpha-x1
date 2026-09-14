import { describe, it, expect } from 'vitest';
import { OcrService, DomTextOcrEngine, OcrEngine, OcrSource, scanOcrForPii } from './ocr';
import { DetectionSource, PrivacyType } from './types';

describe('DomTextOcrEngine', () => {
  it('recovers alt text and aria-labels from images', async () => {
    document.body.innerHTML = `
      <img alt="PAN card ABCDE1234F" src="x.png" />
      <img aria-label="Contact test.user@example.invalid" src="y.png" />
      <canvas data-text="phone +1 555 987 6543"></canvas>`;
    const engine = new DomTextOcrEngine();
    const regions = await engine.recognize({ kind: 'document', doc: document });
    const texts = regions.map((r) => r.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        'PAN card ABCDE1234F',
        'Contact test.user@example.invalid',
        'phone +1 555 987 6543',
      ])
    );
  });
});

describe('OcrService — recovered text is scanned for PII', () => {
  it('turns OCR regions into OCR-sourced findings', async () => {
    document.body.innerHTML = `<img alt="email leak: hidden@example.invalid" src="x.png" />`;
    const service = new OcrService();
    const findings = await service.detect({ kind: 'document', doc: document });
    expect(findings).toHaveLength(1);
    expect(findings[0].source).toBe(DetectionSource.OCR);
    expect(findings[0].type).toBe(PrivacyType.EMAIL);
    expect(findings[0].bbox).toBeDefined();
    // OCR confidence is the product of region and regex confidence.
    expect(findings[0].confidence).toBeLessThan(0.97);
  });

  it('scanText handles a PDF-style text layer', () => {
    const findings = scanOcrForPii('Account holder PAN ABCDE1234F, UPI test@oksbi');
    const types = findings.map((f) => f.type);
    expect(types).toContain(PrivacyType.PAN_LIKE_ID);
    expect(types).toContain(PrivacyType.UPI_ID);
    expect(findings.every((f) => f.source === DetectionSource.OCR)).toBe(true);
  });

  it('supports swapping in a model OCR engine', async () => {
    const fakeTesseract: OcrEngine = {
      name: 'fake-tesseract',
      isAvailable: async () => true,
      async recognize(source: OcrSource) {
        void source;
        return [{ text: 'card 4111 1111 1111 1111', bbox: { x: 1, y: 2, width: 3, height: 4 }, confidence: 0.88, origin: 'tesseract' }];
      },
    };
    const service = new OcrService();
    service.setEngine(fakeTesseract);
    expect(service.engineName).toBe('fake-tesseract');
    const findings = await service.detect({ kind: 'dataUrl', dataUrl: 'data:,' });
    expect(findings[0].type).toBe(PrivacyType.CREDIT_CARD);
    expect(findings[0].detail).toContain('tesseract');
  });

  it('tracks run stats', async () => {
    const service = new OcrService();
    await service.detect({ kind: 'document', doc: document });
    expect(service.getStats().runs).toBeGreaterThan(0);
  });

  describe('detectVerbose', () => {
    it('reports regionCount even when none of the recognized text is PII', async () => {
      // Regression: "0 findings" alone can't distinguish "the engine
      // recognized no text" from "it recognized plenty of ordinary,
      // non-PII text" — those are very different outcomes for a caller
      // trying to tell whether OCR itself is actually working.
      const nonPiiEngine: OcrEngine = {
        name: 'fake-tesseract',
        isAvailable: async () => true,
        async recognize() {
          return [
            { text: 'Welcome back', bbox: { x: 0, y: 0, width: 10, height: 10 }, confidence: 0.9, origin: 'tesseract' },
            { text: 'Settings', bbox: { x: 0, y: 20, width: 10, height: 10 }, confidence: 0.9, origin: 'tesseract' },
          ];
        },
      };
      const service = new OcrService();
      service.setEngine(nonPiiEngine);
      const { findings, regionCount } = await service.detectVerbose({ kind: 'dataUrl', dataUrl: 'data:,' });
      expect(findings).toHaveLength(0);
      expect(regionCount).toBe(2);
    });

    it('reports regionCount 0 when the engine recognizes no text at all', async () => {
      document.body.innerHTML = '';
      const service = new OcrService();
      const { findings, regionCount } = await service.detectVerbose({ kind: 'document', doc: document });
      expect(findings).toHaveLength(0);
      expect(regionCount).toBe(0);
    });

    it('detect() still returns just the findings array (unchanged public behavior)', async () => {
      document.body.innerHTML = `<img alt="email leak: hidden@example.invalid" src="x.png" />`;
      const service = new OcrService();
      const findings = await service.detect({ kind: 'document', doc: document });
      expect(Array.isArray(findings)).toBe(true);
      expect(findings).toHaveLength(1);
    });
  });
});
