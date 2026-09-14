/**
 * DOM-based sensitive-field detection.
 *
 * The browser already tells us a great deal about a field's purpose through
 * `type`, `autocomplete`, `name`, `id`, `placeholder` and `aria-label`.
 * That semantic metadata is the cheapest and most reliable signal we have,
 * so anything expressible here should NOT fall through to regex or vision.
 *
 * This module records *metadata only*. It never reads `.value` of a field.
 */

import {
  PrivacyFinding,
  PrivacyType,
  DetectionSource,
  REPLACEMENT_TOKENS,
  DEFAULT_STRATEGY,
  BoundingBox,
} from './types';

/**
 * A candidate field handed to `classifyField`. Kept framework-free so it can
 * be unit-tested without a real DOM.
 */
export interface FieldDescriptor {
  elementId?: string;
  tag?: string;
  inputType?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  autocomplete?: string;
  bbox?: BoundingBox;
}

/**
 * `autocomplete` tokens are standardized (WHATWG) and unambiguous, so they
 * get the highest confidence.
 */
const AUTOCOMPLETE_MAP: Record<string, PrivacyType> = {
  'cc-number': PrivacyType.CREDIT_CARD,
  'cc-exp': PrivacyType.CARD_EXPIRY,
  'cc-exp-month': PrivacyType.CARD_EXPIRY,
  'cc-exp-year': PrivacyType.CARD_EXPIRY,
  'cc-csc': PrivacyType.CARD_CVV,
  'cc-name': PrivacyType.PERSON,
  email: PrivacyType.EMAIL,
  username: PrivacyType.OTHER_SENSITIVE,
  'current-password': PrivacyType.PASSWORD,
  'new-password': PrivacyType.PASSWORD,
  'one-time-code': PrivacyType.OTHER_SENSITIVE,
  tel: PrivacyType.PHONE,
  'tel-national': PrivacyType.PHONE,
  name: PrivacyType.PERSON,
  'given-name': PrivacyType.PERSON,
  'family-name': PrivacyType.PERSON,
  'street-address': PrivacyType.ADDRESS,
  'address-line1': PrivacyType.ADDRESS,
  'address-line2': PrivacyType.ADDRESS,
  'postal-code': PrivacyType.ADDRESS,
};

/**
 * `input[type=...]` values that imply a sensitive purpose.
 */
const INPUT_TYPE_MAP: Record<string, PrivacyType> = {
  password: PrivacyType.PASSWORD,
  email: PrivacyType.EMAIL,
  tel: PrivacyType.PHONE,
};

/**
 * Keyword → type heuristics applied to `name` / `id` / `placeholder` /
 * `aria-label`. Lower confidence than the structured signals above because
 * authors are inconsistent. Ordered most-specific first.
 */
const KEYWORD_RULES: Array<{ type: PrivacyType; keywords: string[] }> = [
  { type: PrivacyType.PASSWORD, keywords: ['password', 'passwd', 'pwd', 'passphrase'] },
  { type: PrivacyType.CARD_CVV, keywords: ['cvv', 'cvc', 'cvv2', 'card security', 'security code'] },
  { type: PrivacyType.CARD_EXPIRY, keywords: ['card expiry', 'expiration', 'exp date', 'expiry date'] },
  { type: PrivacyType.CREDIT_CARD, keywords: ['card number', 'cardnumber', 'creditcard', 'credit card', 'debit card', 'ccnumber'] },
  { type: PrivacyType.AADHAAR_LIKE_ID, keywords: ['aadhaar', 'aadhar', 'uidai'] },
  { type: PrivacyType.PAN_LIKE_ID, keywords: ['pan number', 'pan card', 'permanent account'] },
  { type: PrivacyType.UPI_ID, keywords: ['upi id', 'upi address', 'vpa', 'virtual payment'] },
  { type: PrivacyType.ACCOUNT_NUMBER, keywords: ['account number', 'accountno', 'acct number', 'iban', 'routing number', 'ifsc'] },
  { type: PrivacyType.OTHER_SENSITIVE, keywords: ['ssn', 'social security', 'passport', 'national id'] },
  { type: PrivacyType.EMAIL, keywords: ['email', 'e-mail'] },
  { type: PrivacyType.PHONE, keywords: ['phone', 'mobile', 'telephone', 'contact number'] },
  { type: PrivacyType.ADDRESS, keywords: ['address', 'street', 'city', 'postcode', 'postal', 'zip code', 'zipcode'] },
  { type: PrivacyType.PERSON, keywords: ['full name', 'first name', 'last name', 'firstname', 'lastname', 'your name'] },
];

/**
 * Result of classifying a single field.
 */
export interface FieldClassification {
  type: PrivacyType;
  confidence: number;
  reason: string;
}

/**
 * Decide whether a field is sensitive and, if so, what kind.
 * Returns `null` for fields with no sensitive signal.
 */
export function classifyField(field: FieldDescriptor): FieldClassification | null {
  // 1. autocomplete — standardized, unambiguous.
  if (field.autocomplete) {
    const key = field.autocomplete.trim().toLowerCase();
    // autocomplete can be "shipping street-address" — check each token.
    for (const token of key.split(/\s+/)) {
      if (AUTOCOMPLETE_MAP[token]) {
        return {
          type: AUTOCOMPLETE_MAP[token],
          confidence: 1.0,
          reason: `autocomplete="${token}"`,
        };
      }
    }
  }

  // 2. input[type] — strong for password/email/tel.
  if (field.inputType) {
    const t = field.inputType.trim().toLowerCase();
    if (INPUT_TYPE_MAP[t]) {
      return {
        type: INPUT_TYPE_MAP[t],
        confidence: t === 'password' ? 1.0 : 0.9,
        reason: `input[type="${t}"]`,
      };
    }
  }

  // 3. keyword heuristics over name/id/placeholder/aria-label.
  const haystack = [field.name, field.id, field.placeholder, field.ariaLabel]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (haystack) {
    for (const rule of KEYWORD_RULES) {
      if (rule.keywords.some((kw) => haystack.includes(kw))) {
        return {
          type: rule.type,
          confidence: 0.8,
          reason: `keyword match in field metadata`,
        };
      }
    }
  }

  return null;
}

/**
 * Scan the live document for sensitive input fields.
 *
 * Only runs in a real browser/content-script context. Callers in a non-DOM
 * environment should use `classifyField` directly with their own descriptors.
 */
export class DomRuleDetector {
  scanDocument(doc: Document = document): PrivacyFinding[] {
    const findings: PrivacyFinding[] = [];
    const fields = doc.querySelectorAll<HTMLElement>(
      'input, textarea, select'
    );
    let idx = 0;
    fields.forEach((el) => {
      const descriptor = this.toDescriptor(el, `dom-field-${idx++}`);
      const cls = classifyField(descriptor);
      if (!cls) {
        return;
      }
      findings.push({
        type: cls.type,
        source: DetectionSource.DOM,
        confidence: cls.confidence,
        elementId: descriptor.elementId,
        bbox: descriptor.bbox,
        replacement: REPLACEMENT_TOKENS[cls.type],
        // DOM findings never carry a value, so token replacement is moot —
        // the redactor masks the field instead.
        strategy: cls.type === PrivacyType.PASSWORD ? 'mask' : DEFAULT_STRATEGY[cls.type],
        detail: cls.reason,
      });
    });
    return findings;
  }

  private toDescriptor(el: HTMLElement, fallbackId: string): FieldDescriptor {
    const input = el as HTMLInputElement;
    let bbox: BoundingBox | undefined;
    try {
      const r = el.getBoundingClientRect();
      bbox = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    } catch {
      bbox = undefined;
    }
    return {
      elementId: el.id || fallbackId,
      tag: el.tagName.toLowerCase(),
      inputType: input.type,
      name: input.name || undefined,
      id: el.id || undefined,
      placeholder: input.placeholder || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      autocomplete: input.getAttribute('autocomplete') || undefined,
      bbox,
    };
  }
}

export const domRuleDetector = new DomRuleDetector();
