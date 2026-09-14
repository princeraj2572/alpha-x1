import { describe, it, expect, vi } from 'vitest';

// See vision-model.test.ts for why the whole ort-loader module is mocked
// rather than letting vitest's Node runner try to resolve onnxruntime-web
// (this pipeline pulls in the vision model, which isn't exercised here).
vi.mock('./ort-loader', () => ({
  loadOrtModule: vi.fn(async () => {
    throw new Error('onnxruntime-web is browser-only; not available under vitest/Node');
  }),
}));

import { PrivacyPipeline, toWireFinding } from './pipeline';
import { PrivacyType } from './types';
import { makeSyntheticScreenshot, TEST_CARD_NUMBERS, TEST_IDS } from './synthetic-dataset';

const pipeline = new PrivacyPipeline();

describe('PrivacyPipeline — end to end (DOM + regex + OCR)', () => {
  it('produces sanitized text and findings from a synthetic page', async () => {
    document.body.innerHTML = `
      <form>
        <input id="pw" type="password" name="password" value="s3cr3t!" />
        <input id="em" type="email" name="email" value="real@person.example" />
        <img alt="statement PAN ${TEST_IDS.panLike}" src="s.png" />
      </form>`;

    const result = await pipeline.run({
      document,
      texts: [
        { text: `Contact test.user@example.invalid, card ${TEST_CARD_NUMBERS.visa}`, elementId: 'note' },
        { text: 'Product: Wireless Headphones  Price: 2499', elementId: 'summary' },
      ],
    });

    // DOM findings for the sensitive fields
    const byId = Object.fromEntries(result.findings.filter((f) => f.elementId).map((f) => [f.elementId, f]));
    expect(byId['pw'].type).toBe(PrivacyType.PASSWORD);
    expect(byId['em'].type).toBe(PrivacyType.EMAIL);

    // regex over the note
    const noteText = result.redactedTexts.find((t) => t.elementId === 'note')!.text;
    expect(noteText).toContain('[EMAIL]');
    expect(noteText).toContain('[CREDIT_CARD]');
    expect(noteText).not.toContain('test.user@example.invalid');

    // non-sensitive text preserved
    const summary = result.redactedTexts.find((t) => t.elementId === 'summary')!.text;
    expect(summary).toBe('Product: Wireless Headphones  Price: 2499');

    // OCR recovered the PAN from the image alt text
    expect(result.findings.some((f) => f.type === PrivacyType.PAN_LIKE_ID)).toBe(true);

    // report is safe to log
    expect(JSON.stringify(result.report)).not.toContain('real@person.example');
    expect(result.timing.total).toBeGreaterThanOrEqual(0);
  });
});

describe('PrivacyPipeline — visual redaction', () => {
  it('blurs a face region reported by a registered face model', async () => {
    const shot = makeSyntheticScreenshot();
    const image = { data: shot.data, width: shot.width, height: shot.height };

    pipeline['face'].setModel({
      name: 'mock',
      isAvailable: async () => true,
      detect: async () => [{ bbox: shot.faceBox, confidence: 0.95 }],
    });

    const result = await pipeline.run({
      screenshot: image,
      visualSource: {} as CanvasImageSource,
    });

    expect(result.visualRegions.some((r) => r.strategy === 'blur')).toBe(true);
    expect(result.redactedScreenshot).toBeDefined();
    // outside pixel untouched
    const j = ((shot.height - 1) * shot.width + (shot.width - 1)) * 4;
    expect(result.redactedScreenshot!.data[j]).toBe(230);
  });
});

describe('CRITICAL SECURITY TEST — no raw sensitive data leaves the layer', () => {
  it('raw email / password / card / phone / id / UPI never appear in outbound artifacts', async () => {
    const rawSecrets = {
      email: 'victim.name@realmail.example',
      password: 'Tr0ub4dor&3',
      card: TEST_CARD_NUMBERS.visa,
      phone: '+1 555 013 4021',
      pan: TEST_IDS.panLike,
      upi: TEST_IDS.upi,
      ssn: '456-12-7890',
    };

    document.body.innerHTML = `
      <input id="p" type="password" name="password" value="${rawSecrets.password}" />
      <input id="e" type="email" name="email" value="${rawSecrets.email}" />
      <img alt="card on file ${rawSecrets.card}" src="c.png" />`;

    const result = await pipeline.run({
      document,
      texts: [
        {
          text: `Reach ${rawSecrets.email} or ${rawSecrets.phone}. PAN ${rawSecrets.pan}. UPI ${rawSecrets.upi}. SSN ${rawSecrets.ssn}.`,
          elementId: 'blob',
        },
      ],
    });

    // Serialize exactly what the transport layer would send.
    const outbound = JSON.stringify({
      findings: result.findings.map(toWireFinding),
      redactedTexts: result.redactedTexts,
      report: result.report,
      visualRegions: result.visualRegions,
    });

    for (const [label, value] of Object.entries(rawSecrets)) {
      expect(outbound, `raw ${label} leaked`).not.toContain(value);
    }

    const check = PrivacyPipeline.assertNoRawLeak(result, Object.values(rawSecrets));
    expect(check.ok, `leaked: ${check.leaked.join(', ')}`).toBe(true);
  });

  it('toWireFinding strips rawValue', () => {
    const wire = toWireFinding({
      type: PrivacyType.EMAIL,
      source: 'REGEX' as never,
      confidence: 1,
      rawValue: 'secret@x.com',
    });
    expect('rawValue' in wire).toBe(false);
    expect(JSON.stringify(wire)).not.toContain('secret@x.com');
  });
});
