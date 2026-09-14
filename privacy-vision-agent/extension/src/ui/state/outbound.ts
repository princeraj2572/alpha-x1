/**
 * The network security boundary.
 *
 * Only a `SanitizedContext` may be handed to the cloud communication layer.
 * The raw screenshot is a SEPARATE, LOCAL-ONLY type (`RawCapture`) that has no
 * path to the network — there is no function here that serializes it.
 *
 * `validateSanitizedContext()` is a runtime gate in addition to the types:
 * even if a caller constructs a malformed object, transmission is refused.
 */

import { PrivacyFinding, PrivacyType, toWireFinding } from '@/privacy/types';

/* -------------------------------------------------------------------------- */
/*  LOCAL-ONLY types — never serialized to the network                        */
/* -------------------------------------------------------------------------- */

/**
 * The raw, unredacted screenshot. Exists only in the side panel's memory for
 * local inspection. NOTHING in this module or the messaging layer accepts this
 * type as input to a send function.
 */
export interface RawCapture {
  readonly __localOnly: true;
  /** data: URL held for `<img>` preview. Revoked/cleared on session end. */
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: number;
  /** device pixel ratio at capture time, for overlay coordinate mapping. */
  dpr: number;
}

export function makeRawCapture(dataUrl: string, width: number, height: number, dpr: number): RawCapture {
  return { __localOnly: true, dataUrl, width, height, capturedAt: Date.now(), dpr };
}

/* -------------------------------------------------------------------------- */
/*  CLOUD-ELIGIBLE types                                                       */
/* -------------------------------------------------------------------------- */

export interface SanitizedElement {
  id: string;
  type: string;
  label?: string;
  text?: string;
  /** Always a token like "[EMAIL]" or absent — never a real value. */
  value?: string;
  bbox?: [number, number, number, number];
  sensitiveType?: PrivacyType;
}

export interface PrivacyReport {
  total: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
  visualRegions: number;
  tokenReplacements: number;
  /** high-risk findings the pipeline could not confidently resolve. */
  unresolvedHighRisk: number;
  verificationPassed: boolean;
}

/**
 * The sanitized screenshot as a base64 PNG. This is the SAME image shown in
 * the SANITIZED tab — `assertScreenshotMatchesPreview` enforces it.
 */
export interface SanitizedScreenshot {
  dataUrl: string;
  width: number;
  height: number;
  /** sha-256 of the PNG bytes, so UI and transport can prove equality. */
  sha256: string;
}

export interface SanitizedContext {
  page: { title: string; url?: string };
  elements: SanitizedElement[];
  sanitizedTexts: Array<{ elementId?: string; text: string }>;
  findings: Array<Omit<PrivacyFinding, 'rawValue'>>;
  privacyReport: PrivacyReport;
  sanitizedScreenshot: SanitizedScreenshot | null;
  task?: string;
  builtAt: number;
}

/* -------------------------------------------------------------------------- */
/*  Runtime validation                                                         */
/* -------------------------------------------------------------------------- */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Markers that must never appear anywhere in an outbound payload. */
const RAW_MARKERS = ['__localOnly', 'rawValue', 'rawScreenshot', 'RawCapture'];

/**
 * Full runtime check. Returns `ok:false` with reasons if the context is unsafe
 * to transmit. The transport layer MUST call this and refuse on failure.
 */
export function validateSanitizedContext(
  ctx: unknown,
  opts: { rawValues?: string[]; previewSha256?: string | null } = {}
): ValidationResult {
  const errors: string[] = [];
  if (!ctx || typeof ctx !== 'object') {
    return { ok: false, errors: ['context is not an object'] };
  }
  const c = ctx as Partial<SanitizedContext> & Record<string, unknown>;

  if (!c.page || typeof c.page !== 'object') {
    errors.push('missing page');
  }
  if (!Array.isArray(c.elements)) {
    errors.push('missing elements[]');
  }
  if (!Array.isArray(c.findings)) {
    errors.push('missing findings[]');
  }
  if (!c.privacyReport || typeof c.privacyReport !== 'object') {
    errors.push('missing privacyReport');
  }

  // No local-only markers anywhere.
  const json = safeStringify(c);
  for (const marker of RAW_MARKERS) {
    if (json.includes(marker)) {
      errors.push(`outbound payload contains forbidden marker "${marker}"`);
    }
  }

  // findings must be wire-safe (no rawValue).
  for (const f of (c.findings ?? []) as Array<Record<string, unknown>>) {
    if ('rawValue' in f) {
      errors.push('a finding still carries rawValue');
      break;
    }
  }

  // element values must be tokens, never real-looking data.
  for (const el of (c.elements ?? []) as SanitizedElement[]) {
    if (el.value !== undefined && !isToken(el.value)) {
      errors.push(`element "${el.id}" has a non-token value`);
    }
  }

  // privacy verification must have passed and no unresolved high-risk.
  const report = c.privacyReport as PrivacyReport | undefined;
  if (report) {
    if (!report.verificationPassed) {
      errors.push('privacy verification did not pass');
    }
    if ((report.unresolvedHighRisk ?? 0) > 0) {
      errors.push(`${report.unresolvedHighRisk} unresolved high-risk finding(s)`);
    }
  }

  // Sanitized screenshot (if present) must match the previewed one.
  if (c.sanitizedScreenshot && opts.previewSha256) {
    if (c.sanitizedScreenshot.sha256 !== opts.previewSha256) {
      errors.push('sanitized screenshot does not match the previewed image');
    }
  }

  // Raw values (the actual secrets from this page) must not appear.
  if (opts.rawValues?.length) {
    for (const v of opts.rawValues) {
      if (v && json.includes(v)) {
        errors.push('a raw sensitive value leaked into the payload');
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** A value is a redaction token if it looks like `[SOMETHING]`. */
export function isToken(v: string): boolean {
  return /^\[[A-Z_]+\]$/.test(v.trim());
}

/**
 * Map a raw pipeline finding to its wire form. Re-exported so callers use one
 * canonical stripper.
 */
export { toWireFinding };

/**
 * Build the outbound `SanitizedContext` from pipeline output. Does NOT accept a
 * `RawCapture` — the only screenshot it takes is the already-sanitized one.
 */
export function buildSanitizedContext(input: {
  page: { title: string; url?: string };
  elements: SanitizedElement[];
  sanitizedTexts: Array<{ elementId?: string; text: string }>;
  findings: PrivacyFinding[];
  report: {
    total: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    visualRegions: number;
    tokenReplacements: number;
  };
  unresolvedHighRisk: number;
  verificationPassed: boolean;
  sanitizedScreenshot: SanitizedScreenshot | null;
  task?: string;
}): SanitizedContext {
  return {
    page: input.page,
    elements: input.elements.map(stripElement),
    sanitizedTexts: input.sanitizedTexts,
    findings: input.findings.map(toWireFinding),
    privacyReport: {
      ...input.report,
      unresolvedHighRisk: input.unresolvedHighRisk,
      verificationPassed: input.verificationPassed,
    },
    sanitizedScreenshot: input.sanitizedScreenshot,
    task: input.task,
    builtAt: Date.now(),
  };
}

function stripElement(el: SanitizedElement): SanitizedElement {
  const out: SanitizedElement = { id: el.id, type: el.type };
  if (el.label) {
    out.label = el.label;
  }
  if (el.text) {
    out.text = el.text;
  }
  if (el.value !== undefined && isToken(el.value)) {
    out.value = el.value;
  }
  if (el.bbox) {
    out.bbox = el.bbox;
  }
  if (el.sensitiveType) {
    out.sensitiveType = el.sensitiveType;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** Guard used by `RawCapture` consumers: throws if handed something sendable. */
export function assertLocalOnly(x: unknown): asserts x is RawCapture {
  if (!isPlainObject(x) || x.__localOnly !== true) {
    throw new Error('assertLocalOnly: value is not a RawCapture');
  }
}
