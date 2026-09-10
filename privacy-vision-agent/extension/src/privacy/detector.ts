/**
 * Local privacy detection and redaction
 * All sensitive data processing happens client-side
 */

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

export class PrivacyDetector {
  // Regex patterns for PII detection
  private static readonly PATTERNS = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    phone: /\b(?:\+?1[-.]?)?\(?([0-9]{3})\)?[-.]?([0-9]{3})[-.]?([0-9]{4})\b/,
    ssn: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/,
    creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
    ipAddress: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/,
  };

  // Field names that indicate sensitive content
  private static readonly SENSITIVE_FIELD_NAMES = {
    password: true,
    passwd: true,
    pwd: true,
    secret: true,
    pin: true,
    credit_card: true,
    card_number: true,
    cvv: true,
    cvc: true,
    ssn: true,
    social_security: true,
    passport: true,
    license: true,
    drivers_license: true,
    private_key: true,
    api_key: true,
    token: true,
    session: true,
    auth: true,
    login: true,
  };

  // Input types that indicate sensitive content
  private static readonly SENSITIVE_INPUT_TYPES = {
    password: true,
    email: true,
    tel: true,
    hidden: true,
  };

  static detectPii(text: string | null | undefined): RedactionResult {
    if (!text) {
      return {
        isSensitive: false,
        sensitivityLevel: SensitivityLevel.PUBLIC,
        reason: 'Empty value',
      };
    }

    const textStr = String(text).trim();

    // Check each pattern
    for (const [patternName, pattern] of Object.entries(this.PATTERNS)) {
      if (pattern.test(textStr)) {
        console.log(`[Privacy] Detected ${patternName}: ${textStr.substring(0, 20)}...`);
        return {
          isSensitive: true,
          sensitivityLevel: SensitivityLevel.CONFIDENTIAL,
          reason: `Detected ${patternName}`,
          redactedValue: `[${patternName.toUpperCase()}]`,
        };
      }
    }

    return {
      isSensitive: false,
      sensitivityLevel: SensitivityLevel.PUBLIC,
      reason: 'No PII detected',
    };
  }

  static checkFieldSensitivity(
    fieldName?: string,
    inputType?: string,
    ariaLabel?: string
  ): SensitivityLevel {
    if (!fieldName && !inputType && !ariaLabel) {
      return SensitivityLevel.PUBLIC;
    }

    // Check field name
    if (fieldName) {
      const fieldLower = fieldName.toLowerCase();
      if (this.SENSITIVE_FIELD_NAMES[fieldLower as keyof typeof this.SENSITIVE_FIELD_NAMES]) {
        return SensitivityLevel.CONFIDENTIAL;
      }
    }

    // Check input type
    if (inputType) {
      const typeLower = inputType.toLowerCase();
      if (this.SENSITIVE_INPUT_TYPES[typeLower as keyof typeof this.SENSITIVE_INPUT_TYPES]) {
        return SensitivityLevel.CONFIDENTIAL;
      }
    }

    // Check aria-label
    if (ariaLabel) {
      const labelLower = ariaLabel.toLowerCase();
      for (const term of Object.keys(this.SENSITIVE_FIELD_NAMES)) {
        if (labelLower.includes(term)) {
          return SensitivityLevel.CONFIDENTIAL;
        }
      }
    }

    return SensitivityLevel.INTERNAL;
  }

  static redactElement(element: Record<string, unknown>): Record<string, unknown> {
    const redacted = { ...element };

    // Check if field is sensitive
    const sensitivity = this.checkFieldSensitivity(
      element.id as string | undefined,
      element.type as string | undefined,
      element.label as string | undefined
    );

    // For password/email/tel fields, don't expose the value
    if (sensitivity === SensitivityLevel.CONFIDENTIAL) {
      delete redacted.value;
      redacted.sensitivity = 'confidential';
      redacted.note = 'Value redacted for privacy';
    }

    // Check text content for PII
    if (element.text) {
      const piiResult = this.detectPii(element.text as string);
      if (piiResult.isSensitive) {
        redacted.text = piiResult.redactedValue;
        redacted.sensitivity = piiResult.sensitivityLevel;
      }
    }

    return redacted;
  }
}

export const privacyDetector = new PrivacyDetector();
