import { describe, it, expect } from 'vitest';
import { PrivacyDetector, SensitivityLevel, privacyDetector } from './detector';

/**
 * `detector.ts` is now a thin compatibility facade over the new detection
 * layer. These tests pin the legacy API that dom-scanner / fusion / the
 * evaluators still call.
 */

describe('PrivacyDetector.detectPii (facade)', () => {
  it('detects email', () => {
    const r = PrivacyDetector.detectPii('user@example.com');
    expect(r.isSensitive).toBe(true);
    expect(r.sensitivityLevel).toBe(SensitivityLevel.CONFIDENTIAL);
    expect(r.redactedValue).toBe('[EMAIL]');
  });

  it('detects phone', () => {
    const r = PrivacyDetector.detectPii('(555) 123-4567');
    expect(r.isSensitive).toBe(true);
    expect(r.redactedValue).toBe('[PHONE]');
  });

  it('detects SSN shape', () => {
    const r = PrivacyDetector.detectPii('123-45-6789');
    expect(r.isSensitive).toBe(true);
    expect(r.redactedValue).toBe('[SSN]');
  });

  it('detects Luhn-valid credit card', () => {
    const r = PrivacyDetector.detectPii('4111 1111 1111 1111');
    expect(r.isSensitive).toBe(true);
    expect(r.redactedValue).toBe('[CREDIT_CARD]');
  });

  it('detects IPv4', () => {
    const r = PrivacyDetector.detectPii('192.168.1.1');
    expect(r.isSensitive).toBe(true);
    expect(r.redactedValue).toBe('[IP_ADDRESS]');
  });

  it('ignores plain text', () => {
    expect(PrivacyDetector.detectPii('Hello World').isSensitive).toBe(false);
  });

  it('handles empty / null', () => {
    expect(PrivacyDetector.detectPii('').isSensitive).toBe(false);
    expect(PrivacyDetector.detectPii(null).isSensitive).toBe(false);
  });
});

describe('PrivacyDetector.checkFieldSensitivity (facade)', () => {
  it('password field -> confidential', () => {
    expect(PrivacyDetector.checkFieldSensitivity('password')).toBe(SensitivityLevel.CONFIDENTIAL);
  });
  it('email input type -> confidential', () => {
    expect(PrivacyDetector.checkFieldSensitivity(undefined, 'email')).toBe(SensitivityLevel.CONFIDENTIAL);
  });
  it('tel input type -> confidential', () => {
    expect(PrivacyDetector.checkFieldSensitivity(undefined, 'tel')).toBe(SensitivityLevel.CONFIDENTIAL);
  });
  it('aria-label "Enter password" -> confidential', () => {
    expect(PrivacyDetector.checkFieldSensitivity(undefined, undefined, 'Enter password')).toBe(
      SensitivityLevel.CONFIDENTIAL
    );
  });
  it('non-PII field -> public', () => {
    expect(PrivacyDetector.checkFieldSensitivity('quantity')).toBe(SensitivityLevel.PUBLIC);
    expect(PrivacyDetector.checkFieldSensitivity('searchQuery')).toBe(SensitivityLevel.PUBLIC);
  });

  it('name field is now treated as PERSON PII (spec PrivacyType.PERSON)', () => {
    expect(PrivacyDetector.checkFieldSensitivity('firstName')).not.toBe(SensitivityLevel.PUBLIC);
  });
});

describe('PrivacyDetector.redactElement (facade)', () => {
  it('drops the value of a password field', () => {
    const out = PrivacyDetector.redactElement({ id: 'password-field', type: 'password', value: 'secret123', text: 'password field' });
    expect(out.value).toBeUndefined();
    expect(out.sensitivity).toBe('confidential');
  });

  it('token-replaces PII in text content', () => {
    const out = PrivacyDetector.redactElement({ id: 'info', text: 'Call me at (555) 123-4567' });
    expect(out.text).toBe('[PHONE]');
  });

  it('leaves non-PII fields alone', () => {
    const out = PrivacyDetector.redactElement({ id: 'quantity', type: 'number', value: '3', text: 'Quantity' });
    expect(out.value).toBe('3');
    expect(out.sensitivity).toBeUndefined();
  });

  it('is reachable through the legacy instance export', () => {
    const out = privacyDetector.redactElement({ id: 'p', type: 'password', value: 'x' });
    expect(out.value).toBeUndefined();
  });

  it('drops the value of a real dom-scanner-shaped password field, with no keyword hint to fall back on', () => {
    // dom-scanner.ts never sets the top-level `type` to the HTML input type —
    // that's the coarse ElementType ('input'/'button'/...). The real input
    // type attribute lives on `metadata.type` (InputMetadata). The tests
    // above all pass `type: 'password'` directly at the top level, which
    // doesn't reflect the real shape — worse, `id: 'password-field'` would
    // still classify correctly via the keyword-heuristics fallback even with
    // the bug this test guards against, since "password" is in the id. Using
    // a generic id/no label here means this only passes if `metadata.type`
    // is actually read.
    const out = PrivacyDetector.redactElement({
      id: 'field-7',
      type: 'input',
      metadata: { type: 'password' },
      value: 'secret123',
    });
    expect(out.value).toBeUndefined();
    expect(out.sensitivity).toBe('confidential');
  });
});

describe('Privacy guarantees (facade)', () => {
  it('never leaks password values', () => {
    const out = PrivacyDetector.redactElement({ id: 'p', type: 'password', value: 'P@ssw0rd!' });
    expect(JSON.stringify(out)).not.toContain('P@ssw0rd');
  });

  it('never leaks email values in text', () => {
    const out = PrivacyDetector.redactElement({ id: 'x', text: 'mail me user@company.com now' });
    expect(JSON.stringify(out)).not.toContain('user@company.com');
  });

  it('never leaks SSN in text', () => {
    const out = PrivacyDetector.redactElement({ id: 'x', text: 'SSN: 123-45-6789' });
    expect(JSON.stringify(out)).not.toContain('123-45-6789');
  });
});
