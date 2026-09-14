import { describe, it, expect } from 'vitest';
import { computeGate, canTransmit, countUnresolvedHighRisk } from './privacy-gate';
import { PrivacyType, DetectionSource } from '@/privacy/types';
import { SanitizedContext } from './outbound';

function ff(type: PrivacyType, confidence: number, detail?: string) {
  return { type, source: DetectionSource.REGEX, confidence, detail };
}

describe('countUnresolvedHighRisk', () => {
  it('counts low-confidence high-risk findings not forced by risk policy', () => {
    const n = countUnresolvedHighRisk([
      ff(PrivacyType.CREDIT_CARD, 0.4),
      ff(PrivacyType.PASSWORD, 0.9), // resolved by confidence
      ff(PrivacyType.EMAIL, 0.1), // not high-risk
      ff(PrivacyType.AADHAAR_LIKE_ID, 0.3, 'rule:aadhaar | risk-policy: redact despite low confidence'), // forced
    ]);
    expect(n).toBe(1);
  });
});

describe('computeGate', () => {
  const base = { redactedCount: 3, sanitizedContextReady: true, sanitizedScreenshotReady: true };

  it('safe when verified, clean, screenshot ready', () => {
    const g = computeGate({ ...base, findings: [ff(PrivacyType.EMAIL, 0.99)], verificationPassed: true });
    expect(g.status).toBe('safe');
  });

  it('warning when no sanitized screenshot', () => {
    const g = computeGate({ ...base, sanitizedScreenshotReady: false, findings: [], verificationPassed: true });
    expect(g.status).toBe('warning');
  });

  it('blocked when verification failed', () => {
    const g = computeGate({ ...base, findings: [], verificationPassed: false });
    expect(g.status).toBe('blocked');
  });

  it('blocked with unresolved high-risk', () => {
    const g = computeGate({ ...base, findings: [ff(PrivacyType.CREDIT_CARD, 0.3)], verificationPassed: true });
    expect(g.status).toBe('blocked');
    expect(g.unresolvedHighRisk).toBe(1);
  });

  it('idle before the context is built', () => {
    const g = computeGate({ ...base, sanitizedContextReady: false, findings: [], verificationPassed: false });
    expect(g.status).toBe('idle');
  });

  it('always reports raw transmission flags as false', () => {
    const g = computeGate({ ...base, findings: [], verificationPassed: true });
    expect(g.rawScreenshotTransmitted).toBe(false);
    expect(g.rawDomTransmitted).toBe(false);
    expect(g.rawPiiTransmitted).toBe(false);
  });
});

describe('canTransmit', () => {
  const ctx: SanitizedContext = {
    page: { title: 'x' },
    elements: [],
    sanitizedTexts: [],
    findings: [],
    privacyReport: { total: 0, byType: {}, bySource: {}, visualRegions: 0, tokenReplacements: 0, unresolvedHighRisk: 0, verificationPassed: true },
    sanitizedScreenshot: null,
    builtAt: Date.now(),
  };
  const safeGate = computeGate({ findings: [], verificationPassed: true, sanitizedScreenshotReady: true, sanitizedContextReady: true, redactedCount: 0 });

  it('strict: blocked until approved', () => {
    expect(canTransmit({ mode: 'strict', gate: safeGate, approved: false, sent: false, stopped: false, outboundContext: ctx, previewSha256: null }).allowed).toBe(false);
    expect(canTransmit({ mode: 'strict', gate: safeGate, approved: true, sent: false, stopped: false, outboundContext: ctx, previewSha256: null }).allowed).toBe(true);
  });

  it('automatic: allowed on a clean gate, no approval needed', () => {
    const d = canTransmit({ mode: 'automatic', gate: safeGate, approved: false, sent: false, stopped: false, outboundContext: ctx, previewSha256: null });
    expect(d.allowed).toBe(true);
  });

  it('automatic: refuses a warning gate', () => {
    const warnGate = computeGate({ findings: [], verificationPassed: true, sanitizedScreenshotReady: false, sanitizedContextReady: true, redactedCount: 0 });
    expect(canTransmit({ mode: 'automatic', gate: warnGate, approved: false, sent: false, stopped: false, outboundContext: ctx, previewSha256: null }).allowed).toBe(false);
  });

  it('never transmits when stopped', () => {
    expect(canTransmit({ mode: 'automatic', gate: safeGate, approved: true, sent: false, stopped: true, outboundContext: ctx, previewSha256: null }).allowed).toBe(false);
  });

  it('never transmits twice', () => {
    expect(canTransmit({ mode: 'strict', gate: safeGate, approved: true, sent: true, stopped: false, outboundContext: ctx, previewSha256: null }).allowed).toBe(false);
  });

  it('refuses when runtime validation fails', () => {
    const bad = { ...ctx, privacyReport: { ...ctx.privacyReport, verificationPassed: false } };
    expect(canTransmit({ mode: 'strict', gate: safeGate, approved: true, sent: false, stopped: false, outboundContext: bad, previewSha256: null }).allowed).toBe(false);
  });
});
