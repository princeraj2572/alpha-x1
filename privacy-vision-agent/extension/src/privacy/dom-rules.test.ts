import { describe, it, expect } from 'vitest';
import { classifyField, DomRuleDetector } from './dom-rules';
import { PrivacyType, DetectionSource } from './types';
import { SYNTHETIC_FIELD_CASES } from './synthetic-dataset';

describe('classifyField — structured signals', () => {
  it('password by input type (confidence 1.0)', () => {
    const c = classifyField({ inputType: 'password', name: 'x' })!;
    expect(c.type).toBe(PrivacyType.PASSWORD);
    expect(c.confidence).toBe(1);
  });

  it('email by input type', () => {
    expect(classifyField({ inputType: 'email' })!.type).toBe(PrivacyType.EMAIL);
  });

  it('phone by input type tel', () => {
    expect(classifyField({ inputType: 'tel' })!.type).toBe(PrivacyType.PHONE);
  });

  it('card number by autocomplete=cc-number', () => {
    const c = classifyField({ inputType: 'text', autocomplete: 'cc-number' })!;
    expect(c.type).toBe(PrivacyType.CREDIT_CARD);
    expect(c.confidence).toBe(1);
  });

  it('cvv by autocomplete=cc-csc', () => {
    expect(classifyField({ autocomplete: 'cc-csc' })!.type).toBe(PrivacyType.CARD_CVV);
  });

  it('multi-token autocomplete "shipping street-address"', () => {
    expect(classifyField({ autocomplete: 'shipping street-address' })!.type).toBe(PrivacyType.ADDRESS);
  });
});

describe('classifyField — keyword heuristics', () => {
  it('detects card number from name/placeholder', () => {
    const c = classifyField({ inputType: 'text', name: 'cardNumber', placeholder: 'Card number' })!;
    expect(c.type).toBe(PrivacyType.CREDIT_CARD);
    expect(c.confidence).toBeLessThan(1);
  });

  it('detects Aadhaar field', () => {
    expect(classifyField({ name: 'aadhaar_number' })!.type).toBe(PrivacyType.AADHAAR_LIKE_ID);
  });

  it('detects PAN field', () => {
    expect(classifyField({ placeholder: 'Enter PAN number' })!.type).toBe(PrivacyType.PAN_LIKE_ID);
  });

  it('detects UPI / VPA field', () => {
    expect(classifyField({ name: 'vpa', placeholder: 'yourname@upi' })!.type).toBe(PrivacyType.UPI_ID);
  });

  it('detects bank account field', () => {
    expect(classifyField({ ariaLabel: 'Bank account number' })!.type).toBe(PrivacyType.ACCOUNT_NUMBER);
  });
});

describe('classifyField — negatives', () => {
  const negatives = [
    { name: 'search', placeholder: 'Search products' },
    { name: 'quantity', placeholder: 'Qty' },
    { name: 'coupon', placeholder: 'Promo code' },
    {},
  ];
  for (const field of negatives) {
    it(`no classification for ${JSON.stringify(field)}`, () => {
      expect(classifyField(field)).toBeNull();
    });
  }
});

describe('classifyField — labelled dataset', () => {
  it('matches expected type on every field case', () => {
    const misses: string[] = [];
    for (const c of SYNTHETIC_FIELD_CASES) {
      const got = classifyField(c.field)?.type ?? null;
      if (got !== c.expectedType) {
        misses.push(`${JSON.stringify(c.field)} expected ${c.expectedType} got ${got}`);
      }
    }
    expect(misses).toEqual([]);
  });
});

describe('DomRuleDetector.scanDocument', () => {
  it('emits DOM findings with element ids and no values', () => {
    document.body.innerHTML = `
      <form>
        <input id="user-email" type="email" name="email" value="real@person.com" />
        <input id="user-pass" type="password" name="password" value="hunter2" />
        <input id="search" type="text" name="q" value="shoes" />
      </form>`;
    const findings = new DomRuleDetector().scanDocument(document);
    const byId = Object.fromEntries(findings.map((f) => [f.elementId, f]));

    expect(byId['user-email'].type).toBe(PrivacyType.EMAIL);
    expect(byId['user-email'].source).toBe(DetectionSource.DOM);
    expect(byId['user-pass'].type).toBe(PrivacyType.PASSWORD);
    expect(byId['user-pass'].strategy).toBe('mask');
    expect(byId['search']).toBeUndefined();

    // Absolutely no field value anywhere in the serialized findings.
    const json = JSON.stringify(findings);
    expect(json).not.toContain('real@person.com');
    expect(json).not.toContain('hunter2');
  });
});
