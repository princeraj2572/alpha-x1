/**
 * Privacy Evaluator
 * Measures PII detection accuracy and redaction effectiveness against the
 * REAL detection layer (RegexDetector + dom-rules' classifyField, via the
 * `PrivacyDetector` facade), using `synthetic-dataset.ts` — the same
 * maintained, privacy-safe ground truth `regex-detector.test.ts` and
 * `dom-rules.test.ts` already exercise per-case. This used to carry its own
 * separate, smaller, duplicate test-case list (12 cases, no Aadhaar/PAN/UPI/
 * IP coverage at all) — consolidated onto the one real dataset instead, so
 * there's a single source of truth for what "correct" means.
 */

import { PrivacyDetector } from '@/privacy/detector';
import { regexDetector } from '@/privacy/regex-detector';
import { classifyField } from '@/privacy/dom-rules';
import { SYNTHETIC_TEXT_CASES, SYNTHETIC_FIELD_CASES } from '@/privacy/synthetic-dataset';

export interface PrivacyEvaluationResult {
  totalCases: number;
  detectedCorrectly: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
}

export interface FieldClassificationResult {
  totalCases: number;
  correct: number;
  accuracy: number;
}

export class PrivacyEvaluator {
  /**
   * Per-type precision/recall/F1 over every text case in the synthetic
   * dataset. Scored at the TYPE level (did it find the RIGHT kind of PII,
   * not just "something") using every finding RegexDetector produces, not
   * just the single top-confidence one `PrivacyDetector.detectPii` returns —
   * that matters for the dataset's combined-PII cases (one string, three
   * expected types).
   */
  static evaluateDetection(): PrivacyEvaluationResult {
    let detectedCorrectly = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    for (const testCase of SYNTHETIC_TEXT_CASES) {
      const foundTypes = new Set(regexDetector.scan(testCase.text).map((f) => f.type));
      const expectedTypes = new Set(testCase.expectedTypes);

      for (const type of expectedTypes) {
        if (foundTypes.has(type)) {
          detectedCorrectly++;
        } else {
          falseNegatives++;
        }
      }
      for (const type of foundTypes) {
        if (!expectedTypes.has(type)) {
          falsePositives++;
        }
      }
    }

    const precision = detectedCorrectly / (detectedCorrectly + falsePositives) || 0;
    const recall = detectedCorrectly / (detectedCorrectly + falseNegatives) || 0;
    const f1Score = (2 * precision * recall) / (precision + recall) || 0;

    return {
      totalCases: SYNTHETIC_TEXT_CASES.length,
      detectedCorrectly,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      f1Score,
    };
  }

  /**
   * Redaction effectiveness: every text case that expects at least one PII
   * type must come back redacted (changed from its original text) through
   * the same `PrivacyDetector.detectPii` facade the real pipeline's simpler
   * callers use.
   */
  static evaluateRedaction(): {
    allRedacted: boolean;
    totalCases: number;
    redactedCases: number;
    redactionExamples: Array<{ input: string; redacted: string }>;
  } {
    const positiveCases = SYNTHETIC_TEXT_CASES.filter((tc) => tc.expectedTypes.length > 0);
    const results = positiveCases.map((tc) => ({
      input: tc.text,
      redacted: PrivacyDetector.detectPii(tc.text).redactedValue ?? tc.text,
    }));

    const redactedCases = results.filter((r) => r.redacted !== r.input).length;

    return {
      allRedacted: redactedCases === positiveCases.length,
      totalCases: positiveCases.length,
      redactedCases,
      redactionExamples: results.slice(0, 5),
    };
  }

  /**
   * Form-field sensitivity classification accuracy over the full synthetic
   * field dataset (structured autocomplete/type signals, keyword heuristics,
   * and negatives that must NOT be flagged).
   */
  static evaluateFieldClassification(): FieldClassificationResult {
    let correct = 0;
    for (const testCase of SYNTHETIC_FIELD_CASES) {
      const actualType = classifyField(testCase.field)?.type ?? null;
      if (actualType === testCase.expectedType) {
        correct++;
      }
    }
    return {
      totalCases: SYNTHETIC_FIELD_CASES.length,
      correct,
      accuracy: correct / SYNTHETIC_FIELD_CASES.length,
    };
  }

  /**
   * Generate privacy evaluation summary
   */
  static evaluateSummary() {
    const detection = this.evaluateDetection();
    const redaction = this.evaluateRedaction();
    const fields = this.evaluateFieldClassification();

    return {
      title: 'Privacy Evaluation Summary',
      timestamp: new Date().toISOString(),
      piiDetection: {
        passed: detection.precision >= 0.8 && detection.recall >= 0.8,
        precision: (detection.precision * 100).toFixed(1) + '%',
        recall: (detection.recall * 100).toFixed(1) + '%',
        f1Score: (detection.f1Score * 100).toFixed(1) + '%',
        detailsCorrect: detection.detectedCorrectly,
        detailsFalsePositives: detection.falsePositives,
        detailsFalseNegatives: detection.falseNegatives,
      },
      redaction: {
        passed: redaction.allRedacted,
        allSensitiveRedacted: redaction.allRedacted,
        redactedCases: redaction.redactedCases,
        totalCases: redaction.totalCases,
        examples: redaction.redactionExamples,
      },
      fieldSensitivity: {
        passed: fields.accuracy >= 0.9,
        accuracy: (fields.accuracy * 100).toFixed(1) + '%',
        correct: fields.correct,
        totalCases: fields.totalCases,
      },
      overall: {
        allTestsPassed:
          detection.precision >= 0.8 &&
          detection.recall >= 0.8 &&
          redaction.allRedacted &&
          fields.accuracy >= 0.9,
      },
    };
  }
}

export const privacyEvaluator = new PrivacyEvaluator();
