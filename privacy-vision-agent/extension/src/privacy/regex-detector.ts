/**
 * Regex / rule-based PII detection.
 *
 * Fast, deterministic, local. Handles textual PII with a well-known shape:
 * email, phone, payment card, Indian identifiers (Aadhaar / PAN / UPI),
 * IP addresses. Extensible through a rule registry so new patterns can be
 * added without touching the engine.
 *
 * This layer never asserts real-world validity. A card pattern that passes
 * Luhn is a *card-shaped, checksum-valid* string, not proof of a real account.
 */

import {
  PrivacyFinding,
  PrivacyType,
  DetectionSource,
  REPLACEMENT_TOKENS,
  DEFAULT_STRATEGY,
} from './types';

/**
 * A single detection rule.
 */
export interface PiiRule {
  /** Stable identifier, e.g. `email`, `pan-like`. */
  name: string;
  /** Semantic category emitted on match. */
  type: PrivacyType;
  /** Global-flagged pattern. Must have the `g` flag for span extraction. */
  pattern: RegExp;
  /** Base confidence before validators adjust it. */
  baseConfidence: number;
  /**
   * Optional secondary check on the raw match. Return `false` to reject,
   * or a number in 0..1 to override confidence. Used for Luhn, range checks.
   */
  validate?: (match: string) => boolean | number;
  /** Optional replacement token override (defaults to the type's token). */
  replacement?: string;
}

/** Luhn checksum — used to reduce card-number false positives. */
export function luhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) {
    return false;
  }
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) {
      return false;
    }
    if (double) {
      d *= 2;
      if (d > 9) {
        d -= 9;
      }
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Verhoeff checksum — the algorithm Aadhaar actually uses. Passing it means
 * the number is *well-formed*, still not that it is a real, issued Aadhaar.
 */
export function verhoeffValid(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 12) {
    return false;
  }
  const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];
  let c = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = d[c][p[i % 8][reversed[i].charCodeAt(0) - 48]];
  }
  return c === 0;
}

/**
 * The built-in rule set. Order matters only for tie-breaking in fusion;
 * every rule is evaluated against the full text.
 */
export const BUILT_IN_RULES: PiiRule[] = [
  {
    name: 'email',
    type: PrivacyType.EMAIL,
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    baseConfidence: 0.97,
  },
  {
    name: 'upi-id',
    type: PrivacyType.UPI_ID,
    // handle@bank — bank handles are alphabetic, 2+ chars; exclude anything
    // that looks like an email (has a dot in the domain part).
    pattern: /\b[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}\b/g,
    baseConfidence: 0.6,
    validate: (m) => {
      const domain = m.split('@')[1] ?? '';
      if (domain.includes('.')) {
        return false; // that's an email, let the email rule own it
      }
      const knownHandles = [
        'okhdfcbank', 'oksbi', 'okicici', 'okaxis', 'ybl', 'paytm',
        'apl', 'ibl', 'axl', 'upi', 'sbi', 'hdfcbank', 'icici', 'axisbank',
      ];
      return knownHandles.includes(domain.toLowerCase()) ? 0.95 : 0.6;
    },
  },
  {
    name: 'credit-card',
    type: PrivacyType.CREDIT_CARD,
    // Separator sits BEFORE each subsequent digit, not trailing after it —
    // `(?:\d[ -]?){N}` would let the final repetition's optional separator
    // consume a space that belongs to the surrounding sentence, not the card
    // number (e.g. "...1111 was used" -> match ate the space before "was").
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    baseConfidence: 0.5,
    validate: (m) => {
      const digits = m.replace(/\D/g, '');
      if (digits.length < 13 || digits.length > 19) {
        return false;
      }
      return luhnValid(m) ? 0.95 : 0.4;
    },
  },
  {
    name: 'aadhaar-like',
    type: PrivacyType.AADHAAR_LIKE_ID,
    pattern: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g,
    baseConfidence: 0.55,
    validate: (m) => (verhoeffValid(m) ? 0.9 : 0.55),
  },
  {
    name: 'pan-like',
    type: PrivacyType.PAN_LIKE_ID,
    // 5 letters, 4 digits, 1 letter. 4th letter is the holder-type code.
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    baseConfidence: 0.9,
  },
  {
    name: 'us-ssn',
    type: PrivacyType.OTHER_SENSITIVE,
    // US SSN shape: area (not 000/666/9xx) - group (not 00) - serial (not 0000).
    pattern: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    baseConfidence: 0.9,
    replacement: '[SSN]',
  },
  {
    name: 'phone',
    type: PrivacyType.PHONE,
    // Optional +CC, optional parenthesized area code, then grouped digits with
    // space / dot / dash separators. Digit count is validated (10-15) so
    // shorter id-like runs and 16-digit cards are rejected.
    pattern:
      /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3}[\s.-]?\d{3,4}(?:[\s.-]?\d{1,4})?/g,
    baseConfidence: 0.75,
    validate: (m) => {
      const digits = m.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) {
        return false;
      }
      // Reject all-same-digit runs (often placeholders / test fixtures noise).
      if (/^(\d)\1+$/.test(digits)) {
        return 0.5;
      }
      return true;
    },
  },
  {
    name: 'card-expiry',
    type: PrivacyType.CARD_EXPIRY,
    pattern: /\b(0[1-9]|1[0-2])\s?\/\s?(\d{2}|\d{4})\b/g,
    baseConfidence: 0.55,
  },
  {
    name: 'ipv4',
    type: PrivacyType.IP_ADDRESS,
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g,
    baseConfidence: 0.9,
  },
  {
    name: 'ipv6',
    type: PrivacyType.IP_ADDRESS,
    pattern: /\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/g,
    baseConfidence: 0.8,
    validate: (m) => {
      // Require at least two groups and a plausible structure.
      const parts = m.split(':');
      return parts.length >= 3 && parts.length <= 8;
    },
  },
];

/**
 * A registry of rules. Extra rules can be registered at runtime; the engine
 * itself does not change.
 */
export class RuleRegistry {
  private rules = new Map<string, PiiRule>();

  constructor(seed: PiiRule[] = BUILT_IN_RULES) {
    for (const rule of seed) {
      this.register(rule);
    }
  }

  register(rule: PiiRule): void {
    if (!rule.pattern.global) {
      throw new Error(`Rule "${rule.name}" pattern must have the global flag`);
    }
    this.rules.set(rule.name, rule);
  }

  unregister(name: string): void {
    this.rules.delete(name);
  }

  list(): PiiRule[] {
    return [...this.rules.values()];
  }
}

/**
 * Runs every rule in a registry against a block of text and returns findings
 * with character spans, raw values, and recommended replacements.
 */
export class RegexDetector {
  private registry: RuleRegistry;

  constructor(registry: RuleRegistry = new RuleRegistry()) {
    this.registry = registry;
  }

  /** Access the underlying registry to add/remove rules. */
  get rules(): RuleRegistry {
    return this.registry;
  }

  /**
   * Scan `text` and return one finding per non-overlapping match.
   * When two rules match the same span, the higher-confidence one is kept.
   */
  scan(text: string, opts: { minConfidence?: number } = {}): PrivacyFinding[] {
    if (!text) {
      return [];
    }
    // 0.4, not 0.5: matches detection-fusion.ts's own default minConfidence.
    // A stricter pre-filter here than fusion's own threshold would silently
    // discard findings fusion's fail-closed policy was designed to keep —
    // concretely, credit-card's deliberate Luhn-invalid fallback score of
    // 0.4 (still worth surfacing as "card-shaped", see the rule's own
    // comment) never used to reach fusion at all.
    const minConfidence = opts.minConfidence ?? 0.4;
    const raw: PrivacyFinding[] = [];

    for (const rule of this.registry.list()) {
      // Reset lastIndex — patterns are shared and stateful with the `g` flag.
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(text)) !== null) {
        const value = match[0];
        // Guard against zero-width matches causing an infinite loop.
        if (value.length === 0) {
          rule.pattern.lastIndex++;
          continue;
        }
        let confidence = rule.baseConfidence;
        if (rule.validate) {
          const verdict = rule.validate(value);
          if (verdict === false) {
            continue;
          }
          if (typeof verdict === 'number') {
            confidence = verdict;
          }
        }
        if (confidence < minConfidence) {
          continue;
        }
        const start = match.index;
        raw.push({
          type: rule.type,
          source: DetectionSource.REGEX,
          confidence,
          textSpan: [start, start + value.length],
          rawValue: value,
          replacement: rule.replacement ?? REPLACEMENT_TOKENS[rule.type],
          strategy: DEFAULT_STRATEGY[rule.type],
          detail: `rule:${rule.name}`,
        });
      }
    }

    return this.dedupeBySpan(raw);
  }

  /**
   * Convenience: scan text and return the redacted string with every match
   * replaced by its token. Non-destructive to the input.
   */
  redactText(text: string, opts: { minConfidence?: number } = {}): string {
    const findings = this.scan(text, opts)
      .filter((f) => f.textSpan)
      .sort((a, b) => b.textSpan![0] - a.textSpan![0]); // right-to-left
    let out = text;
    for (const f of findings) {
      const [s, e] = f.textSpan!;
      out = out.slice(0, s) + (f.replacement ?? '[REDACTED]') + out.slice(e);
    }
    return out;
  }

  /**
   * When several findings cover the same or overlapping spans, keep the
   * single most confident one (ties broken by longer match) — UNLESS one
   * match's span fully contains the other's, in which case completeness
   * wins outright regardless of confidence. Without that exception, a
   * 16-digit card number whose first 12 digits happen to also satisfy the
   * (shorter, unrelated) Aadhaar-shaped pattern could lose to that
   * coincidental sub-match purely because a Luhn-invalid card scores lower
   * (0.4) than a Verhoeff-invalid Aadhaar guess (0.55) — silently
   * truncating the real finding to 12 of its 16 digits and mislabeling it,
   * discovered by live-testing OCR'd card-shaped text through this exact
   * pipeline.
   */
  private dedupeBySpan(findings: PrivacyFinding[]): PrivacyFinding[] {
    const sorted = [...findings].sort((a, b) => {
      const [as] = a.textSpan!;
      const [bs] = b.textSpan!;
      if (as !== bs) {
        return as - bs;
      }
      return b.confidence - a.confidence;
    });

    const kept: PrivacyFinding[] = [];
    for (const f of sorted) {
      const [fs, fe] = f.textSpan!;
      const clash = kept.find((k) => {
        const [ks, ke] = k.textSpan!;
        return fs < ke && ks < fe; // overlap
      });
      if (!clash) {
        kept.push(f);
        continue;
      }
      const [cs, ce] = clash.textSpan!;
      const clashLen = ce - cs;
      const fLen = fe - fs;

      if (fLen !== clashLen && fs <= cs && fe >= ce) {
        // f strictly contains clash — the more complete match wins outright.
        kept[kept.indexOf(clash)] = f;
        continue;
      }
      if (fLen !== clashLen && cs <= fs && ce >= fe) {
        // clash strictly contains f — keep clash, f contributes nothing new.
        continue;
      }

      if (
        f.confidence > clash.confidence ||
        (f.confidence === clash.confidence && fLen > clashLen)
      ) {
        kept[kept.indexOf(clash)] = f;
      }
    }
    return kept.sort((a, b) => a.textSpan![0] - b.textSpan![0]);
  }
}

/** Shared default instance. */
export const regexDetector = new RegexDetector();
