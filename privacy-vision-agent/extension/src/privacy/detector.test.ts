import { describe, it, expect } from 'vitest';
import { PrivacyDetector, SensitivityLevel } from './detector';

describe('PrivacyDetector', () => {
  describe('PII Detection', () => {
    it('should detect email addresses', () => {
      const result = PrivacyDetector.detectPii('user@example.com');
      expect(result.isSensitive).toBe(true);
      expect(result.sensitivityLevel).toBe(SensitivityLevel.CONFIDENTIAL);
      expect(result.redactedValue).toBe('[EMAIL]');
    });

    it('should detect phone numbers', () => {
      const result = PrivacyDetector.detectPii('(555) 123-4567');
      expect(result.isSensitive).toBe(true);
      expect(result.sensitivityLevel).toBe(SensitivityLevel.CONFIDENTIAL);
      expect(result.redactedValue).toBe('[PHONE]');
    });

    it('should detect SSN', () => {
      const result = PrivacyDetector.detectPii('123-45-6789');
      expect(result.isSensitive).toBe(true);
      expect(result.sensitivityLevel).toBe(SensitivityLevel.CONFIDENTIAL);
      expect(result.redactedValue).toBe('[SSN]');
    });

    it('should detect credit card numbers', () => {
      const result = PrivacyDetector.detectPii('4111-1111-1111-1111');
      expect(result.isSensitive).toBe(true);
      expect(result.sensitivityLevel).toBe(SensitivityLevel.CONFIDENTIAL);
      expect(result.redactedValue).toBe('[CREDITCARD]');
    });

    it('should detect IP addresses', () => {
      const result = PrivacyDetector.detectPii('192.168.1.1');
      expect(result.isSensitive).toBe(true);
      expect(result.sensitivityLevel).toBe(SensitivityLevel.CONFIDENTIAL);
      expect(result.redactedValue).toBe('[IPADDRESS]');
    });

    it('should not flag non-PII text', () => {
      const result = PrivacyDetector.detectPii('Hello World');
      expect(result.isSensitive).toBe(false);
      expect(result.sensitivityLevel).toBe(SensitivityLevel.PUBLIC);
    });

    it('should handle empty values', () => {
      const result = PrivacyDetector.detectPii('');
      expect(result.isSensitive).toBe(false);
    });

    it('should handle null values', () => {
      const result = PrivacyDetector.detectPii(null);
      expect(result.isSensitive).toBe(false);
    });
  });

  describe('Field Sensitivity Detection', () => {
    it('should detect password fields', () => {
      const sensitivity = PrivacyDetector.checkFieldSensitivity('password');
      expect(sensitivity).toBe(SensitivityLevel.CONFIDENTIAL);
    });

    it('should detect email input types', () => {
      const sensitivity = PrivacyDetector.checkFieldSensitivity(undefined, 'email');
      expect(sensitivity).toBe(SensitivityLevel.CONFIDENTIAL);
    });

    it('should detect tel input types', () => {
      const sensitivity = PrivacyDetector.checkFieldSensitivity(undefined, 'tel');
      expect(sensitivity).toBe(SensitivityLevel.CONFIDENTIAL);
    });

    it('should detect from aria-label', () => {
      const sensitivity = PrivacyDetector.checkFieldSensitivity(undefined, undefined, 'Enter password');
      expect(sensitivity).toBe(SensitivityLevel.CONFIDENTIAL);
    });

    it('should handle non-sensitive fields', () => {
      const sensitivity = PrivacyDetector.checkFieldSensitivity('firstName');
      expect(sensitivity).toBe(SensitivityLevel.PUBLIC);
    });
  });

  describe('Element Redaction', () => {
    it('should redact password field values', () => {
      const element = {
        id: 'password-field',
        type: 'password',
        value: 'secret123',
        text: 'password field',
      };

      const redacted = PrivacyDetector.redactElement(element);
      expect(redacted.value).toBeUndefined();
      expect(redacted.sensitivity).toBe('confidential');
      expect(redacted.note).toBe('Value redacted for privacy');
    });

    it('should redact email field values', () => {
      const element = {
        id: 'email',
        type: 'email',
        value: 'user@example.com',
        text: 'email input',
      };

      const redacted = PrivacyDetector.redactElement(element);
      expect(redacted.value).toBeUndefined();
      expect(redacted.sensitivity).toBe('confidential');
    });

    it('should redact PII in text content', () => {
      const element = {
        id: 'info',
        text: 'Call me at (555) 123-4567',
      };

      const redacted = PrivacyDetector.redactElement(element);
      expect(redacted.text).toBe('[PHONE]');
      expect(redacted.sensitivity).toBe(SensitivityLevel.CONFIDENTIAL);
    });

    it('should not redact public fields', () => {
      const element = {
        id: 'firstName',
        type: 'text',
        value: 'John',
        text: 'First Name',
      };

      const redacted = PrivacyDetector.redactElement(element);
      expect(redacted.value).toBe('John');
      expect(redacted.sensitivity).toBeUndefined();
    });

    it('should preserve element ID', () => {
      const element = {
        id: 'elem-42',
        type: 'password',
        value: 'secret',
      };

      const redacted = PrivacyDetector.redactElement(element);
      expect(redacted.id).toBe('elem-42');
    });
  });

  describe('Privacy Guarantees', () => {
    it('should never leak password values', () => {
      const elements = [
        { type: 'password', value: 'mypassword123' },
        { type: 'password', value: 'P@ssw0rd!' },
      ];

      const redacted = elements.map((el) => PrivacyDetector.redactElement(el));
      redacted.forEach((el) => {
        expect(el.value).toBeUndefined();
        expect(JSON.stringify(el)).not.toContain('password');
        expect(JSON.stringify(el)).not.toContain('P@ssw0rd');
      });
    });

    it('should never leak email addresses', () => {
      const element = {
        id: 'email-field',
        value: 'user@company.com',
      };

      const redacted = PrivacyDetector.redactElement(element);
      expect(JSON.stringify(redacted)).not.toContain('user@company.com');
    });

    it('should never leak PII in text', () => {
      const element = {
        id: 'info-text',
        text: 'SSN: 123-45-6789',
      };

      const redacted = PrivacyDetector.redactElement(element);
      expect(JSON.stringify(redacted)).not.toContain('123-45-6789');
    });
  });
});
