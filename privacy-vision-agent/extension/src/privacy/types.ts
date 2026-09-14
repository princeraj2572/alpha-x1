/**
 * Common schema for the Local Detection & Sanitization Layer.
 *
 * Every detector (DOM rules, regex, OCR, face, vision) emits `PrivacyFinding`
 * objects. The fusion engine normalizes them into a single list; the redaction
 * engine consumes that list to produce the sanitized context.
 *
 * Nothing in this file performs network I/O. All detection is local.
 */

/**
 * Semantic category of a detected sensitive item.
 *
 * `*_LIKE_ID` names are deliberate: pattern matching can identify the *shape*
 * of an identifier but never its real-world validity. We never claim a string
 * is a genuine government ID or bank card purely from a regex match.
 */
export enum PrivacyType {
  PERSON = 'PERSON',
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  PASSWORD = 'PASSWORD',
  CREDIT_CARD = 'CREDIT_CARD',
  CARD_EXPIRY = 'CARD_EXPIRY',
  CARD_CVV = 'CARD_CVV',
  AADHAAR_LIKE_ID = 'AADHAAR_LIKE_ID',
  PAN_LIKE_ID = 'PAN_LIKE_ID',
  UPI_ID = 'UPI_ID',
  ACCOUNT_NUMBER = 'ACCOUNT_NUMBER',
  ADDRESS = 'ADDRESS',
  IP_ADDRESS = 'IP_ADDRESS',
  FACE = 'FACE',
  DOCUMENT = 'DOCUMENT',
  OTHER_SENSITIVE = 'OTHER_SENSITIVE',
}

/**
 * Which detector produced a finding. `FUSED` marks a finding created by
 * merging two or more raw findings.
 */
export enum DetectionSource {
  DOM = 'DOM',
  REGEX = 'REGEX',
  OCR = 'OCR',
  FACE_MODEL = 'FACE_MODEL',
  VISION_MODEL = 'VISION_MODEL',
  FUSED = 'FUSED',
}

/**
 * Axis-aligned bounding box in CSS pixels relative to the viewport top-left.
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How a finding should be neutralized before the context leaves the device.
 *
 * - `token`  : replace matched text with a semantic placeholder ([EMAIL], ...)
 * - `mask`   : blank the value (used for DOM fields where we never had the value)
 * - `blur`   : visually blur a screenshot region (faces, documents)
 * - `blackout`: solid fill a screenshot region (highest-risk visual regions)
 */
export type RedactionStrategy = 'token' | 'mask' | 'blur' | 'blackout';

/**
 * A single sensitive item detected somewhere on the page.
 *
 * At least one of `bbox` / `elementId` / `textSpan` is present so the
 * redaction engine knows what to act on.
 */
export interface PrivacyFinding {
  /** Semantic category. */
  type: PrivacyType;
  /** Detector that produced this finding. */
  source: DetectionSource;
  /** 0..1 detector confidence. DOM semantic fields are 1.0. */
  confidence: number;
  /** Visual location, when the finding came from a pixel-space detector. */
  bbox?: BoundingBox;
  /** Local DOM element id, when the finding came from the DOM. */
  elementId?: string;
  /** Character span `[start, end)` within a supplied text, when text-based. */
  textSpan?: [number, number];
  /** The raw matched substring. Kept only in local memory, never serialized out. */
  rawValue?: string;
  /** Recommended placeholder, e.g. `[EMAIL]`. */
  replacement?: string;
  /** Recommended redaction strategy. */
  strategy?: RedactionStrategy;
  /** Free-form detector notes (rule name, model class, ...). */
  detail?: string;
}

/**
 * Default semantic replacement token for each privacy type.
 */
export const REPLACEMENT_TOKENS: Record<PrivacyType, string> = {
  [PrivacyType.PERSON]: '[PERSON]',
  [PrivacyType.EMAIL]: '[EMAIL]',
  [PrivacyType.PHONE]: '[PHONE]',
  [PrivacyType.PASSWORD]: '[PASSWORD]',
  [PrivacyType.CREDIT_CARD]: '[CREDIT_CARD]',
  [PrivacyType.CARD_EXPIRY]: '[CARD_EXPIRY]',
  [PrivacyType.CARD_CVV]: '[CARD_CVV]',
  [PrivacyType.AADHAAR_LIKE_ID]: '[AADHAAR_LIKE_ID]',
  [PrivacyType.PAN_LIKE_ID]: '[PAN_LIKE_ID]',
  [PrivacyType.UPI_ID]: '[UPI_ID]',
  [PrivacyType.ACCOUNT_NUMBER]: '[ACCOUNT_NUMBER]',
  [PrivacyType.ADDRESS]: '[ADDRESS]',
  [PrivacyType.IP_ADDRESS]: '[IP_ADDRESS]',
  [PrivacyType.FACE]: '[FACE]',
  [PrivacyType.DOCUMENT]: '[DOCUMENT]',
  [PrivacyType.OTHER_SENSITIVE]: '[REDACTED]',
};

/**
 * Default redaction strategy per type. Visual types get a pixel strategy;
 * everything else is token replacement.
 */
export const DEFAULT_STRATEGY: Record<PrivacyType, RedactionStrategy> = {
  [PrivacyType.PERSON]: 'token',
  [PrivacyType.EMAIL]: 'token',
  [PrivacyType.PHONE]: 'token',
  [PrivacyType.PASSWORD]: 'mask',
  [PrivacyType.CREDIT_CARD]: 'token',
  [PrivacyType.CARD_EXPIRY]: 'token',
  [PrivacyType.CARD_CVV]: 'token',
  [PrivacyType.AADHAAR_LIKE_ID]: 'token',
  [PrivacyType.PAN_LIKE_ID]: 'token',
  [PrivacyType.UPI_ID]: 'token',
  [PrivacyType.ACCOUNT_NUMBER]: 'token',
  [PrivacyType.ADDRESS]: 'token',
  [PrivacyType.IP_ADDRESS]: 'token',
  [PrivacyType.FACE]: 'blur',
  [PrivacyType.DOCUMENT]: 'blackout',
  [PrivacyType.OTHER_SENSITIVE]: 'token',
};

/**
 * Source reliability ranking used by the fusion engine to resolve conflicts.
 * Higher wins. Documented in DECISIONS.md (DECISION-016).
 */
export const SOURCE_RANK: Record<DetectionSource, number> = {
  [DetectionSource.DOM]: 5,
  [DetectionSource.REGEX]: 4,
  [DetectionSource.OCR]: 3,
  [DetectionSource.FACE_MODEL]: 3,
  [DetectionSource.VISION_MODEL]: 2,
  [DetectionSource.FUSED]: 5,
};

/**
 * Return the token for a type, honoring an explicit override on the finding.
 */
export function tokenFor(finding: Pick<PrivacyFinding, 'type' | 'replacement'>): string {
  return finding.replacement ?? REPLACEMENT_TOKENS[finding.type] ?? '[REDACTED]';
}

/**
 * Strip fields that must never cross the network boundary from a finding.
 * The transport layer MUST map findings through this before sending.
 */
export function toWireFinding(f: PrivacyFinding): Omit<PrivacyFinding, 'rawValue'> {
  const { rawValue: _omit, ...rest } = f;
  void _omit;
  return rest;
}
