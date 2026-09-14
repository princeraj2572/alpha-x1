import { describe, it, expect } from 'vitest';
import {
  RegexDetector,
  RuleRegistry,
  luhnValid,
  verhoeffValid,
  BUILT_IN_RULES,
} from './regex-detector';
import { PrivacyType, DetectionSource } from './types';
import { SYNTHETIC_TEXT_CASES, TEST_CARD_NUMBERS, TEST_IDS } from './synthetic-dataset';

const detector = new RegexDetector();

function types(text: string): PrivacyType[] {
  return [...new Set(detector.scan(text).map((f) => f.type))];
}

describe('RegexDetector — checksums', () => {
  it('luhn accepts known test PANs', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('5555555555554444')).toBe(true);
  });
  it('luhn rejects malformed numbers', () => {
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(luhnValid('1234')).toBe(false);
  });
  it('verhoeff validates a synthetic Aadhaar-shaped number', () => {
    expect(verhoeffValid(TEST_IDS.aadhaarLike)).toBe(true);
    expect(verhoeffValid(TEST_IDS.aadhaarInvalid)).toBe(false);
  });
});

describe('RegexDetector — individual categories', () => {
  it('detects email', () => {
    expect(types('reach me at test.user@example.invalid')).toContain(PrivacyType.EMAIL);
  });

  it('detects phone with parentheses grouping', () => {
    const found = detector.scan('Reception: (555) 019-9999');
    expect(found.map((f) => f.type)).toContain(PrivacyType.PHONE);
  });

  it('detects +CC phone', () => {
    expect(types('Call +91 90000 00000')).toContain(PrivacyType.PHONE);
  });

  it('detects a Luhn-valid card and scores it high', () => {
    const found = detector.scan(`card ${TEST_CARD_NUMBERS.visaDashed}`);
    const card = found.find((f) => f.type === PrivacyType.CREDIT_CARD);
    expect(card).toBeDefined();
    expect(card!.confidence).toBeGreaterThan(0.9);
  });

  it('does not treat a 16-digit non-Luhn run as a card at high confidence', () => {
    const found = detector.scan('ref 1111222233334441');
    const card = found.find((f) => f.type === PrivacyType.CREDIT_CARD);
    // either rejected or low-confidence
    expect(!card || card.confidence < 0.6).toBe(true);
  });

  it('detects PAN-like id', () => {
    expect(types(`PAN ${TEST_IDS.panLike}`)).toContain(PrivacyType.PAN_LIKE_ID);
  });

  it('detects Aadhaar-like id', () => {
    expect(types(`Aadhaar ${TEST_IDS.aadhaarLike}`)).toContain(PrivacyType.AADHAAR_LIKE_ID);
  });

  it('detects UPI id and not as email', () => {
    const found = detector.scan(`pay ${TEST_IDS.upi}`);
    expect(found.some((f) => f.type === PrivacyType.UPI_ID)).toBe(true);
    expect(found.some((f) => f.type === PrivacyType.EMAIL)).toBe(false);
  });

  it('keeps a real email as email, not UPI', () => {
    const found = detector.scan('mail jane@sub.example.com');
    expect(found.some((f) => f.type === PrivacyType.EMAIL)).toBe(true);
    expect(found.some((f) => f.type === PrivacyType.UPI_ID)).toBe(false);
  });

  it('detects IPv4', () => {
    expect(types('origin 192.168.1.100')).toContain(PrivacyType.IP_ADDRESS);
  });

  it('detects IPv6', () => {
    expect(types('addr 2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toContain(PrivacyType.IP_ADDRESS);
  });

  it('detects US SSN shape with [SSN] token', () => {
    const found = detector.scan('ssn 123-45-6789');
    const ssn = found.find((f) => f.replacement === '[SSN]');
    expect(ssn).toBeDefined();
    expect(ssn!.type).toBe(PrivacyType.OTHER_SENSITIVE);
  });
});

describe('RegexDetector — negatives', () => {
  const negatives = [
    'The meeting is at 3pm on the 4th floor',
    'Order #100200300 shipped',
    'Version 4.11.2024 of the doc',
    'Buy 2 get 1 free — code SAVE20',
  ];
  for (const text of negatives) {
    it(`no PII in: "${text}"`, () => {
      expect(detector.scan(text)).toHaveLength(0);
    });
  }
});

describe('RegexDetector — findings shape', () => {
  it('produces spans, raw values, tokens, and REGEX source', () => {
    const [f] = detector.scan('x test@example.invalid y');
    expect(f.source).toBe(DetectionSource.REGEX);
    expect(f.textSpan).toEqual([2, 22]);
    expect(f.rawValue).toBe('test@example.invalid');
    expect(f.replacement).toBe('[EMAIL]');
  });

  it('redactText replaces every match and leaves other text intact', () => {
    const out = detector.redactText('name Bob email bob@example.invalid phone +1 555 123 4567');
    expect(out).toContain('name Bob');
    expect(out).toContain('[EMAIL]');
    expect(out).toContain('[PHONE]');
    expect(out).not.toContain('bob@example.invalid');
  });

  it('regression: card match does not swallow the trailing space before the next word', () => {
    // Found via a live extraction test: the separator sat *after* each digit
    // in the pattern, so the final repetition's optional separator consumed
    // a sentence-level space that wasn't part of the card number at all,
    // producing "[CREDIT_CARD]was" instead of "[CREDIT_CARD] was".
    const out = detector.redactText('Order reference: 4111-1111-1111-1111 was used for the last transaction.');
    expect(out).toBe('Order reference: [CREDIT_CARD] was used for the last transaction.');
  });

  it('dedupes overlapping matches keeping the stronger one', () => {
    // A card number also loosely matches phone-ish digit runs; only one wins.
    const found = detector.scan(`pay ${TEST_CARD_NUMBERS.visa}`);
    const spans = found.map((f) => f.textSpan!.join('-'));
    expect(new Set(spans).size).toBe(spans.length);
  });
});

describe('RegexDetector — registry extensibility', () => {
  it('supports registering a new rule without touching the engine', () => {
    const registry = new RuleRegistry();
    registry.register({
      name: 'employee-code',
      type: PrivacyType.OTHER_SENSITIVE,
      pattern: /\bEMP-\d{6}\b/g,
      baseConfidence: 0.9,
      replacement: '[EMPLOYEE_ID]',
    });
    const d = new RegexDetector(registry);
    const found = d.scan('user EMP-004521 logged in');
    expect(found[0].replacement).toBe('[EMPLOYEE_ID]');
  });

  it('rejects a non-global pattern', () => {
    const registry = new RuleRegistry([]);
    expect(() =>
      registry.register({
        name: 'bad',
        type: PrivacyType.OTHER_SENSITIVE,
        pattern: /abc/,
        baseConfidence: 1,
      })
    ).toThrow(/global flag/);
  });

  it('ships the documented built-in rule set', () => {
    const names = BUILT_IN_RULES.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['email', 'phone', 'credit-card', 'aadhaar-like', 'pan-like', 'upi-id', 'ipv4', 'ipv6'])
    );
  });
});

describe('RegexDetector — synthetic dataset recall', () => {
  it('detects every expected type across the labelled set', () => {
    const misses: string[] = [];
    for (const c of SYNTHETIC_TEXT_CASES) {
      const detected = new Set(detector.scan(c.text).map((f) => f.type));
      for (const expected of c.expectedTypes) {
        if (!detected.has(expected)) {
          misses.push(`${expected} in "${c.text}"`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it('keeps false positives on negative cases at zero', () => {
    const fps: string[] = [];
    for (const c of SYNTHETIC_TEXT_CASES.filter((c) => c.expectedTypes.length === 0)) {
      const detected = detector.scan(c.text);
      if (detected.length) {
        fps.push(`"${c.text}" -> ${detected.map((f) => f.type).join(',')}`);
      }
    }
    expect(fps).toEqual([]);
  });
});
