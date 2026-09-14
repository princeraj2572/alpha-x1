import { describe, it, expect } from 'vitest';
import { DetectionFusionEngine, HIGH_RISK_TYPES } from './detection-fusion';
import { PrivacyFinding, PrivacyType, DetectionSource } from './types';

const engine = new DetectionFusionEngine();

function f(partial: Partial<PrivacyFinding>): PrivacyFinding {
  return {
    type: PrivacyType.EMAIL,
    source: DetectionSource.REGEX,
    confidence: 0.9,
    ...partial,
  };
}

describe('DetectionFusionEngine — merging', () => {
  it('merges DOM + regex findings for the same element id', () => {
    const out = engine.fuse([
      f({ source: DetectionSource.DOM, elementId: 'e1', type: PrivacyType.EMAIL, confidence: 1 }),
      f({ source: DetectionSource.REGEX, elementId: 'e1', type: PrivacyType.EMAIL, confidence: 0.97, textSpan: [0, 10] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe(DetectionSource.FUSED);
    expect(out[0].confidence).toBe(1);
    expect(out[0].elementId).toBe('e1');
  });

  it('merges overlapping text spans within the same element', () => {
    const out = engine.fuse([
      f({ elementId: 'label-1', textSpan: [5, 25], confidence: 0.8 }),
      f({ elementId: 'label-1', textSpan: [10, 25], confidence: 0.95 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0.95);
  });

  it('does NOT merge same-looking spans from different source texts', () => {
    const out = engine.fuse([
      f({ elementId: 'note', textSpan: [8, 28], type: PrivacyType.EMAIL }),
      f({ textSpan: [14, 24], type: PrivacyType.PAN_LIKE_ID, source: DetectionSource.OCR, confidence: 0.6 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('merges overlapping bounding boxes (IoU > threshold)', () => {
    const out = engine.fuse([
      f({ source: DetectionSource.FACE_MODEL, type: PrivacyType.FACE, bbox: { x: 0, y: 0, width: 100, height: 100 } }),
      f({ source: DetectionSource.VISION_MODEL, type: PrivacyType.FACE, bbox: { x: 10, y: 10, width: 100, height: 100 }, confidence: 0.6 }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps distinct findings separate', () => {
    const out = engine.fuse([
      f({ textSpan: [0, 10] }),
      f({ textSpan: [40, 55], type: PrivacyType.PHONE }),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('DetectionFusionEngine — conflict resolution', () => {
  it('higher-ranked source wins the type when detectors disagree', () => {
    const out = engine.fuse([
      f({ source: DetectionSource.VISION_MODEL, type: PrivacyType.DOCUMENT, bbox: { x: 0, y: 0, width: 50, height: 50 }, confidence: 0.7 }),
      f({ source: DetectionSource.DOM, type: PrivacyType.CREDIT_CARD, bbox: { x: 5, y: 5, width: 50, height: 50 }, elementId: 'card', confidence: 0.9 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe(PrivacyType.CREDIT_CARD);
    expect(out[0].detail).toContain('type-conflict');
  });
});

describe('DetectionFusionEngine — fail closed', () => {
  it('drops low-confidence low-risk findings', () => {
    const out = engine.fuse([f({ type: PrivacyType.PERSON, confidence: 0.2, textSpan: [0, 4] })], { minConfidence: 0.4 });
    expect(out).toHaveLength(0);
  });

  it('keeps low-confidence HIGH-RISK findings (fail closed)', () => {
    const out = engine.fuse([f({ type: PrivacyType.CREDIT_CARD, confidence: 0.2, textSpan: [0, 4] })], { minConfidence: 0.4 });
    expect(out).toHaveLength(1);
    expect(out[0].detail).toContain('fail-closed');
  });

  it('applyRiskPolicy annotates uncertain high-risk findings', () => {
    const out = engine.applyRiskPolicy([f({ type: PrivacyType.PASSWORD, confidence: 0.5 })]);
    expect(out[0].detail).toContain('risk-policy');
  });

  it('every documented high-risk type is covered', () => {
    for (const t of [
      PrivacyType.PASSWORD,
      PrivacyType.CREDIT_CARD,
      PrivacyType.CARD_CVV,
      PrivacyType.AADHAAR_LIKE_ID,
      PrivacyType.PAN_LIKE_ID,
      PrivacyType.ACCOUNT_NUMBER,
      PrivacyType.FACE,
    ]) {
      expect(HIGH_RISK_TYPES.has(t)).toBe(true);
    }
  });
});

describe('DetectionFusionEngine — ordering', () => {
  it('element findings come before positional ones, then by position', () => {
    const out = engine.fuse([
      f({ bbox: { x: 0, y: 300, width: 10, height: 10 }, textSpan: undefined }),
      f({ elementId: 'e1' }),
      f({ bbox: { x: 0, y: 100, width: 10, height: 10 } }),
    ]);
    expect(out[0].elementId).toBe('e1');
    expect(out[1].bbox!.y).toBe(100);
    expect(out[2].bbox!.y).toBe(300);
  });
});
