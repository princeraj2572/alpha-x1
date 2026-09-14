/**
 * Synthetic test data for the local detection layer.
 *
 * Every value here is fabricated. Emails use the reserved `example.*` /
 * `.invalid` domains; phone numbers use documentation ranges; card numbers
 * are the well-known test PANs; Aadhaar/PAN values are structurally valid but
 * not issued. No real personal data.
 */

import { PrivacyType } from './types';

export interface TextCase {
  text: string;
  /** Types that SHOULD be detected somewhere in the text. */
  expectedTypes: PrivacyType[];
  note?: string;
}

export interface FieldCase {
  field: {
    inputType?: string;
    name?: string;
    id?: string;
    placeholder?: string;
    ariaLabel?: string;
    autocomplete?: string;
  };
  /** Expected classification, or null if the field is not sensitive. */
  expectedType: PrivacyType | null;
}

/** Card test numbers (industry-standard test PANs, Luhn-valid). */
export const TEST_CARD_NUMBERS = {
  visa: '4111 1111 1111 1111',
  visaDashed: '4111-1111-1111-1111',
  mastercard: '5555 5555 5555 4444',
  amex: '3782 822463 10005',
};

/** Structurally-valid-but-fake identifiers. */
export const TEST_IDS = {
  panLike: 'ABCDE1234F',
  aadhaarLike: '2338 5972 6560', // Verhoeff-valid synthetic (not issued)
  aadhaarInvalid: '2338 5972 6561', // fails Verhoeff — still Aadhaar-shaped
  upi: 'testuser@oksbi',
  upiGeneric: 'q4payments@paytm',
};

export const SYNTHETIC_TEXT_CASES: TextCase[] = [
  // --- email ---
  { text: 'Contact: test.user@example.invalid for details', expectedTypes: [PrivacyType.EMAIL] },
  { text: 'jane.doe+news@sub.example.com', expectedTypes: [PrivacyType.EMAIL] },

  // --- phone ---
  { text: 'Call +91 90000 00000 to confirm', expectedTypes: [PrivacyType.PHONE] },
  { text: 'Reception: (555) 019-9999', expectedTypes: [PrivacyType.PHONE], note: 'NANP documentation range' },
  { text: 'mobile 9000012345', expectedTypes: [PrivacyType.PHONE] },

  // --- cards ---
  { text: `Card on file ${TEST_CARD_NUMBERS.visa}`, expectedTypes: [PrivacyType.CREDIT_CARD] },
  { text: `Pay with ${TEST_CARD_NUMBERS.visaDashed}`, expectedTypes: [PrivacyType.CREDIT_CARD] },
  { text: 'exp 04/27 cvv omitted', expectedTypes: [PrivacyType.CARD_EXPIRY] },

  // --- indian ids ---
  { text: `PAN: ${TEST_IDS.panLike}`, expectedTypes: [PrivacyType.PAN_LIKE_ID] },
  { text: `Aadhaar ${TEST_IDS.aadhaarLike}`, expectedTypes: [PrivacyType.AADHAAR_LIKE_ID] },
  { text: `Send to ${TEST_IDS.upi}`, expectedTypes: [PrivacyType.UPI_ID] },
  { text: `UPI ${TEST_IDS.upiGeneric} verified`, expectedTypes: [PrivacyType.UPI_ID] },

  // --- ip ---
  { text: 'Origin 192.168.1.100 blocked', expectedTypes: [PrivacyType.IP_ADDRESS] },
  { text: 'v6 addr 2001:0db8:85a3:0000:0000:8a2e:0370:7334', expectedTypes: [PrivacyType.IP_ADDRESS] },

  // --- combined ---
  {
    text: `Name: Test Person, email test@example.invalid, phone +91 98765 43210, card ${TEST_CARD_NUMBERS.mastercard}`,
    expectedTypes: [PrivacyType.EMAIL, PrivacyType.PHONE, PrivacyType.CREDIT_CARD],
  },

  // --- negatives (must NOT trigger) ---
  { text: 'The meeting is at 3pm on the 4th floor', expectedTypes: [] },
  { text: 'Order #100200300 shipped', expectedTypes: [], note: '9-digit order id, not an SSN-format' },
  { text: 'Version 4.11.2024 of the doc', expectedTypes: [], note: 'looks card-ish but fails Luhn/length' },
  { text: 'Buy 2 get 1 free — code SAVE20', expectedTypes: [] },
  { text: 'RGB 255.128.064 swatch', expectedTypes: [], note: 'not a valid IPv4 (out of range octet handled)' },
];

export const SYNTHETIC_FIELD_CASES: FieldCase[] = [
  // structured signals
  { field: { inputType: 'password', name: 'password' }, expectedType: PrivacyType.PASSWORD },
  { field: { inputType: 'password', autocomplete: 'new-password' }, expectedType: PrivacyType.PASSWORD },
  { field: { inputType: 'email', name: 'email' }, expectedType: PrivacyType.EMAIL },
  { field: { inputType: 'tel', name: 'phone' }, expectedType: PrivacyType.PHONE },
  { field: { inputType: 'text', autocomplete: 'cc-number' }, expectedType: PrivacyType.CREDIT_CARD },
  { field: { inputType: 'text', autocomplete: 'cc-exp' }, expectedType: PrivacyType.CARD_EXPIRY },
  { field: { inputType: 'text', autocomplete: 'cc-csc' }, expectedType: PrivacyType.CARD_CVV },
  { field: { inputType: 'text', autocomplete: 'shipping street-address' }, expectedType: PrivacyType.ADDRESS },

  // keyword heuristics
  { field: { inputType: 'text', name: 'cardNumber', placeholder: 'Card number' }, expectedType: PrivacyType.CREDIT_CARD },
  { field: { inputType: 'text', id: 'cvv', ariaLabel: 'CVV' }, expectedType: PrivacyType.CARD_CVV },
  { field: { inputType: 'text', name: 'aadhaar_number' }, expectedType: PrivacyType.AADHAAR_LIKE_ID },
  { field: { inputType: 'text', placeholder: 'Enter PAN number' }, expectedType: PrivacyType.PAN_LIKE_ID },
  { field: { inputType: 'text', name: 'vpa', placeholder: 'yourname@upi' }, expectedType: PrivacyType.UPI_ID },
  { field: { inputType: 'text', ariaLabel: 'Bank account number' }, expectedType: PrivacyType.ACCOUNT_NUMBER },
  { field: { inputType: 'text', name: 'fullName', placeholder: 'Full name' }, expectedType: PrivacyType.PERSON },

  // negatives
  { field: { inputType: 'text', name: 'search', placeholder: 'Search products' }, expectedType: null },
  { field: { inputType: 'checkbox', name: 'subscribe' }, expectedType: null },
  { field: { inputType: 'text', name: 'quantity', placeholder: 'Qty' }, expectedType: null },
  { field: { inputType: 'text', name: 'coupon', placeholder: 'Promo code' }, expectedType: null },
];

/**
 * A tiny synthetic screenshot: a grey frame with a darker rectangle where a
 * "face" would be. Used to exercise the redactor and vision path without a
 * real image. Returns raw RGBA bytes.
 */
export function makeSyntheticScreenshot(width = 200, height = 120): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  faceBox: { x: number; y: number; width: number; height: number };
} {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 230;
    data[i * 4 + 1] = 230;
    data[i * 4 + 2] = 235;
    data[i * 4 + 3] = 255;
  }
  const faceBox = { x: 20, y: 20, width: 40, height: 40 };
  for (let y = faceBox.y; y < faceBox.y + faceBox.height; y++) {
    for (let x = faceBox.x; x < faceBox.x + faceBox.width; x++) {
      const i = (y * width + x) * 4;
      data[i] = 120;
      data[i + 1] = 90;
      data[i + 2] = 80;
      data[i + 3] = 255;
    }
  }
  return { width, height, data, faceBox };
}
