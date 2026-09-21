import { describe, it, expect } from 'vitest';
import { PrivacyEvaluator } from './privacy-evaluator';

/**
 * Runs the PII-detection accuracy evaluation (DECISION-031) as part of the
 * normal test suite — not a manually-clicked panel nobody could actually
 * reach (the previous UI for this, popup/evaluation-panel.tsx, was orphaned:
 * unreferenced by the live vanilla-JS popup, and its content-script handler
 * never existed). This makes the "evaluation methodology" something that
 * runs, and can regress, on every commit.
 */
describe('PrivacyEvaluator (DECISION-031 accuracy benchmark)', () => {
  it('meets the accuracy bar on the synthetic text dataset', () => {
    const detection = PrivacyEvaluator.evaluateDetection();
    expect(detection.totalCases).toBeGreaterThan(0);
    expect(detection.precision).toBeGreaterThanOrEqual(0.8);
    expect(detection.recall).toBeGreaterThanOrEqual(0.8);
  });

  it('redacts every text case that contains PII', () => {
    const redaction = PrivacyEvaluator.evaluateRedaction();
    expect(redaction.allRedacted).toBe(true);
    expect(redaction.redactedCases).toBe(redaction.totalCases);
  });

  it('classifies form-field sensitivity accurately on the synthetic field dataset', () => {
    const fields = PrivacyEvaluator.evaluateFieldClassification();
    expect(fields.totalCases).toBeGreaterThan(0);
    expect(fields.accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('evaluateSummary reports overall pass', () => {
    const summary = PrivacyEvaluator.evaluateSummary();
    expect(summary.overall.allTestsPassed).toBe(true);
  });
});
