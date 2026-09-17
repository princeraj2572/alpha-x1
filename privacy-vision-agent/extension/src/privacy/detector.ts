/**
 * Backward-compatible facade over the local detection layer.
 *
 * The real work now lives in:
 *   - `regex-detector.ts`     textual PII (email/phone/card/Aadhaar/PAN/UPI/IP)
 *   - `dom-rules.ts`          semantic form-field classification
 *   - `detection-fusion.ts`   merge / conflict resolution
 *   - `redactor.ts`           token + visual redaction
 *   - `pipeline.ts`           orchestration
 *
 * This module keeps the older `PrivacyDetector` API that `dom-scanner.ts`,
 * `vision/fusion.ts` and the evaluators already call, so nothing downstream
 * had to change. New code should import the modules above directly.
 */

import { regexDetector } from './regex-detector';
import { classifyField } from './dom-rules';
import { PrivacyType } from './types';

export enum SensitivityLevel {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  SENSITIVE = 'sensitive',
  CONFIDENTIAL = 'confidential',
}

export interface RedactionResult {
  isSensitive: boolean;
  sensitivityLevel: SensitivityLevel;
  reason: string;
  redactedValue?: string;
}

/** Types that always imply the highest sensitivity band. */
const CONFIDENTIAL_TYPES: ReadonlySet<PrivacyType> = new Set([
  PrivacyType.PASSWORD,
  PrivacyType.EMAIL,
  PrivacyType.PHONE,
  PrivacyType.CREDIT_CARD,
  PrivacyType.CARD_CVV,
  PrivacyType.CARD_EXPIRY,
  PrivacyType.AADHAAR_LIKE_ID,
  PrivacyType.PAN_LIKE_ID,
  PrivacyType.UPI_ID,
  PrivacyType.ACCOUNT_NUMBER,
  PrivacyType.IP_ADDRESS,
  PrivacyType.OTHER_SENSITIVE,
]);

export class PrivacyDetector {
  /**
   * Detect PII inside a free-text string. Returns the first (highest priority)
   * match as a legacy `RedactionResult`.
   */
  static detectPii(text: string | null | undefined): RedactionResult {
    if (!text) {
      return { isSensitive: false, sensitivityLevel: SensitivityLevel.PUBLIC, reason: 'Empty value' };
    }
    const findings = regexDetector.scan(String(text).trim());
    if (findings.length === 0) {
      return { isSensitive: false, sensitivityLevel: SensitivityLevel.PUBLIC, reason: 'No PII detected' };
    }
    // Prefer the highest-confidence finding.
    const top = findings.slice().sort((a, b) => b.confidence - a.confidence)[0];
    return {
      isSensitive: true,
      sensitivityLevel: CONFIDENTIAL_TYPES.has(top.type)
        ? SensitivityLevel.CONFIDENTIAL
        : SensitivityLevel.SENSITIVE,
      reason: `Detected ${top.type} (${top.detail ?? 'regex'})`,
      redactedValue: top.replacement ?? '[REDACTED]',
    };
  }

  /**
   * Classify a form field's sensitivity from its metadata.
   */
  static checkFieldSensitivity(
    fieldName?: string,
    inputType?: string,
    ariaLabel?: string
  ): SensitivityLevel {
    if (!fieldName && !inputType && !ariaLabel) {
      return SensitivityLevel.PUBLIC;
    }
    const cls = classifyField({
      name: fieldName,
      id: fieldName,
      inputType,
      ariaLabel,
    });
    if (!cls) {
      return SensitivityLevel.PUBLIC;
    }
    return CONFIDENTIAL_TYPES.has(cls.type)
      ? SensitivityLevel.CONFIDENTIAL
      : SensitivityLevel.SENSITIVE;
  }

  /**
   * Redact a plain element record: drop the value of sensitive fields, and
   * token-replace any PII found in its text.
   */
  static redactElement(element: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = { ...element };

    // `element.type` (when this came from dom-scanner.ts) is the coarse
    // ElementType ('input'/'button'/'textarea'/...), not the HTML input type
    // attribute — that lives on `metadata.type` (InputMetadata, types/index.ts).
    // vision/fusion.ts had the identical bug (read a field named `inputType`
    // that never existed on real data) — fixed there; this was left as a
    // named follow-up (DECISIONS.md, "Closed: Lint Gate") until now.
    const sensitivity = this.checkFieldSensitivity(
      element.id as string | undefined,
      ((element.metadata as Record<string, unknown> | undefined)?.type as string | undefined) ??
        (element.type as string | undefined),
      (element.label as string | undefined) ?? (element.ariaLabel as string | undefined)
    );

    if (sensitivity === SensitivityLevel.CONFIDENTIAL || sensitivity === SensitivityLevel.SENSITIVE) {
      delete redacted.value;
      redacted.sensitivity = 'confidential';
      redacted.note = 'Value redacted for privacy';
    }

    if (typeof element.text === 'string' && element.text) {
      const pii = this.detectPii(element.text);
      if (pii.isSensitive) {
        redacted.text = pii.redactedValue;
        redacted.sensitivity = pii.sensitivityLevel;
      }
    }

    return redacted;
  }
}

/**
 * Legacy instance export. Kept as an object exposing the same static methods
 * so existing `privacyDetector.redactElement(...)` call sites keep working
 * (the previous `new PrivacyDetector()` instance did NOT expose them).
 */
export const privacyDetector = {
  detectPii: PrivacyDetector.detectPii.bind(PrivacyDetector),
  checkFieldSensitivity: PrivacyDetector.checkFieldSensitivity.bind(PrivacyDetector),
  redactElement: PrivacyDetector.redactElement.bind(PrivacyDetector),
};
