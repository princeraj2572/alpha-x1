import { describe, it, expect } from 'vitest';
import { Redactor } from './redactor';
import { regexDetector } from './regex-detector';
import { PrivacyFinding, PrivacyType, DetectionSource } from './types';
import { makeSyntheticScreenshot } from './synthetic-dataset';

const redactor = new Redactor();

describe('Redactor.redactText', () => {
  it('replaces spans with semantic tokens, right-to-left', () => {
    const text = 'email a@example.invalid then phone +1 555 123 4567';
    const findings = regexDetector.scan(text);
    const { text: out, appliedCount } = redactor.redactText(text, findings);
    expect(out).toContain('[EMAIL]');
    expect(out).toContain('[PHONE]');
    expect(out).not.toContain('a@example.invalid');
    expect(appliedCount).toBe(2);
  });

  it('preserves non-sensitive context (README §13)', () => {
    const text = 'Name: Rahul, Email: rahul@example.invalid, Product: Headphones, Price: 2499';
    const { text: out } = redactor.redactText(text, regexDetector.scan(text));
    expect(out).toContain('Product: Headphones');
    expect(out).toContain('Price: 2499');
    expect(out).toContain('[EMAIL]');
  });

  it('ignores visual-strategy findings', () => {
    const findings: PrivacyFinding[] = [
      { type: PrivacyType.FACE, source: DetectionSource.FACE_MODEL, confidence: 0.9, textSpan: [0, 4], strategy: 'blur' },
    ];
    const { text: out } = redactor.redactText('face here', findings);
    expect(out).toBe('face here');
  });
});

describe('Redactor.redactRecordStrings', () => {
  it('recurses into nested objects and arrays', () => {
    const record = {
      label: 'Contact rahul@example.invalid',
      nested: { note: 'call +1 555 123 4567', items: ['ok', 'ssn 123-45-6789'] },
    };
    const out = redactor.redactRecordStrings(record, (s) => regexDetector.scan(s));
    expect(out.label).toContain('[EMAIL]');
    expect(out.nested.note).toContain('[PHONE]');
    expect(out.nested.items[1]).toContain('[SSN]');
    expect(JSON.stringify(out)).not.toContain('rahul@example.invalid');
  });
});

describe('Redactor.maskFieldPatch', () => {
  it('omits value and records the sensitive type', () => {
    const patch = redactor.maskFieldPatch({
      type: PrivacyType.PASSWORD,
      source: DetectionSource.DOM,
      confidence: 1,
      elementId: 'e1',
    });
    expect(patch.value).toBeUndefined();
    expect(patch.valueOmitted).toBe(true);
    expect(patch.sensitiveType).toBe(PrivacyType.PASSWORD);
  });
});

describe('Redactor — visual redaction', () => {
  const shot = makeSyntheticScreenshot();
  const image = { data: shot.data, width: shot.width, height: shot.height } as ImageData;

  it('collects blur/blackout regions only', () => {
    const findings: PrivacyFinding[] = [
      { type: PrivacyType.FACE, source: DetectionSource.FACE_MODEL, confidence: 0.9, bbox: shot.faceBox, strategy: 'blur' },
      { type: PrivacyType.EMAIL, source: DetectionSource.REGEX, confidence: 0.9, textSpan: [0, 5], strategy: 'token' },
    ];
    const regions = redactor.visualRegions(findings);
    expect(regions).toHaveLength(1);
    expect(regions[0].strategy).toBe('blur');
  });

  it('blackout fills the region with solid black', () => {
    const out = redactor.applyVisualRedaction(image, [
      { bbox: shot.faceBox, strategy: 'blackout', type: PrivacyType.DOCUMENT },
    ]);
    const i = (shot.faceBox.y * shot.width + shot.faceBox.x) * 4;
    expect([out.data[i], out.data[i + 1], out.data[i + 2]]).toEqual([0, 0, 0]);
    // a pixel outside the box is untouched
    const j = ((shot.height - 1) * shot.width + (shot.width - 1)) * 4;
    expect(out.data[j]).toBe(230);
  });

  it('blur changes face pixels but not the whole frame', () => {
    const out = redactor.applyVisualRedaction(image, [
      { bbox: shot.faceBox, strategy: 'blur', type: PrivacyType.FACE },
    ]);
    const outsideIdx = ((shot.height - 1) * shot.width + (shot.width - 1)) * 4;
    expect(out.data[outsideIdx]).toBe(230);
  });

  it('does not mutate the input image', () => {
    const before = image.data[(shot.faceBox.y * shot.width + shot.faceBox.x) * 4];
    redactor.applyVisualRedaction(image, [{ bbox: shot.faceBox, strategy: 'blackout', type: PrivacyType.DOCUMENT }]);
    const after = image.data[(shot.faceBox.y * shot.width + shot.faceBox.x) * 4];
    expect(after).toBe(before);
  });
});

describe('Redactor.report', () => {
  it('summarizes counts by type and source without raw values', () => {
    const findings: PrivacyFinding[] = [
      { type: PrivacyType.EMAIL, source: DetectionSource.REGEX, confidence: 0.9, rawValue: 'secret@x.com', strategy: 'token' },
      { type: PrivacyType.FACE, source: DetectionSource.FACE_MODEL, confidence: 0.9, strategy: 'blur' },
    ];
    const report = redactor.report(findings);
    expect(report.total).toBe(2);
    expect(report.byType[PrivacyType.EMAIL]).toBe(1);
    expect(report.tokenReplacements).toBe(1);
    expect(report.visualRegions).toBe(1);
    expect(JSON.stringify(report)).not.toContain('secret@x.com');
  });
});
