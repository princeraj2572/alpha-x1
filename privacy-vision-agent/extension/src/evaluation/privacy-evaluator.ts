/**
 * Privacy Evaluator
 * Measures PII detection accuracy and redaction effectiveness
 */

import { PrivacyDetector } from '@/privacy/detector';

export interface PIITestCase {
  input: string;
  expectedType: 'email' | 'phone' | 'ssn' | 'credit_card' | 'name' | 'address' | 'none';
  shouldRedact: boolean;
}

export interface PrivacyEvaluationResult {
  totalCases: number;
  detectedCorrectly: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
}

export class PrivacyEvaluator {
  /**
   * Synthetic test cases with ground truth
   */
  private static readonly TEST_CASES: PIITestCase[] = [
    // Valid emails
    { input: 'user@example.com', expectedType: 'email', shouldRedact: true },
    { input: 'john.doe+tag@company.co.uk', expectedType: 'email', shouldRedact: true },
    { input: 'test.email@subdomain.example.com', expectedType: 'email', shouldRedact: true },

    // Valid phone numbers
    { input: '+1-555-123-4567', expectedType: 'phone', shouldRedact: true },
    { input: '(555) 123-4567', expectedType: 'phone', shouldRedact: true },
    { input: '555.123.4567', expectedType: 'phone', shouldRedact: true },

    // Valid SSNs
    { input: '123-45-6789', expectedType: 'ssn', shouldRedact: true },
    { input: '000-00-0001', expectedType: 'ssn', shouldRedact: true },

    // Valid credit cards
    { input: '4532-1234-5678-9010', expectedType: 'credit_card', shouldRedact: true },
    { input: '5412345678901234', expectedType: 'credit_card', shouldRedact: true },

    // Invalid/borderline cases
    { input: 'not-an-email', expectedType: 'none', shouldRedact: false },
    { input: '123-456-7890', expectedType: 'none', shouldRedact: false }, // Could be phone or SSN - ambiguous
    { input: 'hello world', expectedType: 'none', shouldRedact: false },
    { input: '192.168.1.1', expectedType: 'none', shouldRedact: false }, // IP address, not tested here
  ];

  /**
   * Evaluate PII detection accuracy
   */
  static evaluateDetection(): PrivacyEvaluationResult {
    let detectedCorrectly = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    for (const testCase of this.TEST_CASES) {
      const result = PrivacyDetector.detectPii(testCase.input);

      const wasDetected = result.isSensitive;
      const shouldHaveDetected = testCase.shouldRedact;

      if (wasDetected && shouldHaveDetected) {
        // True positive
        detectedCorrectly++;
      } else if (wasDetected && !shouldHaveDetected) {
        // False positive
        falsePositives++;
      } else if (!wasDetected && shouldHaveDetected) {
        // False negative
        falseNegatives++;
      }
      // True negative (not detected, shouldn't be detected) - not counted in metrics
    }

    const precision = detectedCorrectly / (detectedCorrectly + falsePositives) || 0;
    const recall = detectedCorrectly / (detectedCorrectly + falseNegatives) || 0;
    const f1Score = (2 * precision * recall) / (precision + recall) || 0;

    return {
      totalCases: this.TEST_CASES.length,
      detectedCorrectly,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      f1Score,
    };
  }

  /**
   * Evaluate redaction effectiveness
   */
  static evaluateRedaction(): {
    allRedacted: boolean;
    redactionExamples: Array<{ input: string; redacted: string }>;
  } {
    const examples = this.TEST_CASES.filter((tc) => tc.shouldRedact).slice(0, 5);
    const redactionExamples = examples.map((tc) => ({
      input: tc.input,
      redacted: PrivacyDetector.detectPii(tc.input).redactedValue,
    }));

    const allRedacted = redactionExamples.every((ex) => ex.redacted !== ex.input);

    return {
      allRedacted,
      redactionExamples,
    };
  }

  /**
   * Evaluate field sensitivity detection
   */
  static evaluateFieldSensitivity(): {
    passwordFieldDetected: boolean;
    emailFieldDetected: boolean;
    phoneFieldDetected: boolean;
  } {
    return {
      passwordFieldDetected: PrivacyDetector.checkFieldSensitivity('password', 'password', 'Enter password') !== 'public',
      emailFieldDetected: PrivacyDetector.checkFieldSensitivity('email', 'email', 'Email address') !== 'public',
      phoneFieldDetected: PrivacyDetector.checkFieldSensitivity('phone', 'tel', 'Phone number') !== 'public',
    };
  }

  /**
   * Generate privacy evaluation summary
   */
  static evaluateSummary() {
    const detection = this.evaluateDetection();
    const redaction = this.evaluateRedaction();
    const fields = this.evaluateFieldSensitivity();

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
        examples: redaction.redactionExamples,
      },
      fieldSensitivity: {
        passed: fields.passwordFieldDetected && fields.emailFieldDetected && fields.phoneFieldDetected,
        passwordDetected: fields.passwordFieldDetected,
        emailDetected: fields.emailFieldDetected,
        phoneDetected: fields.phoneFieldDetected,
      },
      overall: {
        allTestsPassed:
          detection.precision >= 0.8 &&
          detection.recall >= 0.8 &&
          redaction.allRedacted &&
          fields.passwordFieldDetected &&
          fields.emailFieldDetected &&
          fields.phoneFieldDetected,
      },
    };
  }
}

export const privacyEvaluator = new PrivacyEvaluator();
