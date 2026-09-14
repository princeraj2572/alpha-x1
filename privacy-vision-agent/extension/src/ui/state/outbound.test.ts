import { describe, it, expect } from 'vitest';
import {
  validateSanitizedContext,
  buildSanitizedContext,
  makeRawCapture,
  assertLocalOnly,
  isToken,
  SanitizedContext,
} from './outbound';
import { PrivacyType, DetectionSource, PrivacyFinding } from '@/privacy/types';

function goodContext(over: Partial<SanitizedContext> = {}): SanitizedContext {
  return {
    page: { title: 'Checkout', url: 'https://shop.example/checkout' },
    elements: [
      { id: 'email', type: 'input', label: 'Email', value: '[EMAIL]' },
      { id: 'buy', type: 'button', text: 'BUY NOW' },
    ],
    sanitizedTexts: [{ elementId: 'note', text: 'Contact [EMAIL]' }],
    findings: [{ type: PrivacyType.EMAIL, source: DetectionSource.REGEX, confidence: 0.97 }],
    privacyReport: {
      total: 1,
      byType: { EMAIL: 1 },
      bySource: { REGEX: 1 },
      visualRegions: 0,
      tokenReplacements: 1,
      unresolvedHighRisk: 0,
      verificationPassed: true,
    },
    sanitizedScreenshot: null,
    builtAt: Date.now(),
    ...over,
  };
}

describe('isToken', () => {
  it('accepts [EMAIL], rejects real values', () => {
    expect(isToken('[EMAIL]')).toBe(true);
    expect(isToken('[CREDIT_CARD]')).toBe(true);
    expect(isToken('john@x.com')).toBe(false);
    expect(isToken('[email]')).toBe(false);
  });
});

describe('validateSanitizedContext', () => {
  it('passes a well-formed context', () => {
    expect(validateSanitizedContext(goodContext()).ok).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(validateSanitizedContext(null).ok).toBe(false);
    expect(validateSanitizedContext('nope').ok).toBe(false);
  });

  it('rejects a context missing required parts', () => {
    const r = validateSanitizedContext({ page: { title: 'x' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/elements|findings|privacyReport/);
  });

  it('rejects a finding that still carries rawValue', () => {
    const ctx = goodContext({
      findings: [{ type: PrivacyType.EMAIL, source: DetectionSource.REGEX, confidence: 1, rawValue: 'secret@x.com' } as unknown as Omit<PrivacyFinding, 'rawValue'>],
    });
    const r = validateSanitizedContext(ctx);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/rawValue/);
  });

  it('rejects an element with a non-token value', () => {
    const ctx = goodContext({ elements: [{ id: 'e', type: 'input', value: 'prince@gmail.com' }] });
    expect(validateSanitizedContext(ctx).ok).toBe(false);
  });

  it('rejects when a RawCapture marker leaks in', () => {
    const ctx = goodContext();
    (ctx as unknown as Record<string, unknown>).leak = { __localOnly: true, dataUrl: 'data:...' };
    const r = validateSanitizedContext(ctx);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/__localOnly/);
  });

  it('rejects when verification did not pass', () => {
    const ctx = goodContext();
    ctx.privacyReport.verificationPassed = false;
    expect(validateSanitizedContext(ctx).ok).toBe(false);
  });

  it('rejects unresolved high-risk findings', () => {
    const ctx = goodContext();
    ctx.privacyReport.unresolvedHighRisk = 2;
    const r = validateSanitizedContext(ctx);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/high-risk/);
  });

  it('rejects a raw sensitive value appearing anywhere', () => {
    const ctx = goodContext({ sanitizedTexts: [{ text: 'oops prince@gmail.com slipped through' }] });
    const r = validateSanitizedContext(ctx, { rawValues: ['prince@gmail.com'] });
    expect(r.ok).toBe(false);
  });

  it('rejects a screenshot that does not match the preview hash', () => {
    const ctx = goodContext({ sanitizedScreenshot: { dataUrl: 'data:image/png;base64,AAAA', width: 10, height: 10, sha256: 'abc' } });
    const r = validateSanitizedContext(ctx, { previewSha256: 'different' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/does not match/);
  });

  it('accepts a screenshot that matches the preview hash', () => {
    const ctx = goodContext({ sanitizedScreenshot: { dataUrl: 'data:image/png;base64,AAAA', width: 10, height: 10, sha256: 'abc123' } });
    expect(validateSanitizedContext(ctx, { previewSha256: 'abc123' }).ok).toBe(true);
  });
});

describe('buildSanitizedContext', () => {
  it('strips non-token element values and rawValue from findings', () => {
    const ctx = buildSanitizedContext({
      page: { title: 'x' },
      elements: [
        { id: 'a', type: 'input', value: '[EMAIL]' },
        { id: 'b', type: 'input', value: 'real@value.com' }, // must be dropped
      ],
      sanitizedTexts: [],
      findings: [
        { type: PrivacyType.EMAIL, source: DetectionSource.REGEX, confidence: 1, rawValue: 'real@value.com' },
      ],
      report: { total: 1, byType: {}, bySource: {}, visualRegions: 0, tokenReplacements: 1 },
      unresolvedHighRisk: 0,
      verificationPassed: true,
      sanitizedScreenshot: null,
    });
    expect(ctx.elements[0].value).toBe('[EMAIL]');
    expect(ctx.elements[1].value).toBeUndefined();
    expect(JSON.stringify(ctx)).not.toContain('real@value.com');
  });
});

describe('assertLocalOnly', () => {
  it('accepts a RawCapture, throws on anything else', () => {
    const raw = makeRawCapture('data:image/png;base64,AA', 4, 4, 2);
    expect(() => assertLocalOnly(raw)).not.toThrow();
    expect(() => assertLocalOnly({ dataUrl: 'x' })).toThrow();
  });
});
