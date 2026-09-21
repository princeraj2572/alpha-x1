/**
 * Real pixel-level OCR backend for the `OcrEngine` interface (see `ocr.ts`),
 * using Tesseract.js. This is what `DomTextOcrEngine` could never do: read
 * text that is actually baked into image/canvas pixels — a photographed ID
 * card, a screenshot pasted into a page, a PAN/Aadhaar number rendered inside
 * a `<canvas>`.
 *
 * Everything Tesseract needs (worker script, WASM core, English language
 * data) is loaded from explicit local URLs passed in by the caller — never a
 * CDN. This project's whole premise is that local processing makes zero
 * external network calls; Tesseract.js defaults to fetching its assets from
 * a public CDN unless told otherwise, so every path below is mandatory, not
 * an optimization.
 */

import { OcrEngine, OcrRegion, OcrSource } from './ocr';
import { BoundingBox } from './types';
import { withTimeout } from './async-utils';

/** Generous margin — cold worker creation (core load + WASM init + language
 * data decompress) measured ~1-2s live (DECISION-023); this bounds a genuine
 * stall, not ordinary load time. */
const WORKER_INIT_TIMEOUT_MS = 20_000;

/** Character set for the digit-recovery pass (see `recoverDigitLikeRegions`). */
const DIGIT_WHITELIST = '0123456789 -';

/** Minimum digit count for a digit-pass line to be worth recovering. Below
 * this, expiry dates ("12/20") and other short numbers would generate a
 * recovery candidate on every capture; every sensitive numeric type this
 * pipeline detects (phone, SSN, PAN's numeric run, Aadhaar, card) is at or
 * above this length. */
const MIN_RECOVERY_DIGITS = 8;

export interface TesseractEngineConfig {
  /** URL to tesseract.js's worker.min.js, served from the extension origin. */
  workerPath: string;
  /** URL to the core WASM wrapper .js (e.g. tesseract-core-simd-lstm.js). */
  corePath: string;
  /** URL to the DIRECTORY containing `<lang>.traineddata.gz`. */
  langPath: string;
  /** Language code(s), e.g. 'eng'. */
  lang?: string;
  /** Discard recognized lines below this confidence (0-100, Tesseract scale). */
  minConfidence?: number;
}

/** Minimal structural types so this file type-checks without tesseract.js loaded. */
interface TesseractBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TesseractLine {
  text: string;
  confidence: number;
  bbox: TesseractBbox;
}
interface TesseractWorker {
  recognize(
    image: unknown,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>
  ): Promise<{
    data: { blocks: Array<{ paragraphs: Array<{ lines: TesseractLine[] }> }> | null };
  }>;
  setParameters(params: Record<string, unknown>): Promise<unknown>;
  terminate(): Promise<unknown>;
}
interface TesseractModule {
  createWorker(
    langs: string,
    oem: number,
    options: Record<string, unknown>
  ): Promise<TesseractWorker>;
}

export class TesseractOcrEngine implements OcrEngine {
  readonly name = 'tesseract';
  private config: Required<TesseractEngineConfig>;
  private workerPromise: Promise<TesseractWorker> | null = null;
  private loadError: string | null = null;

  constructor(config: TesseractEngineConfig) {
    this.config = { lang: 'eng', minConfidence: 40, ...config };
  }

  async isAvailable(): Promise<boolean> {
    // Bundled statically at build time (see OPERATIONS §8.5); the only real
    // failure mode is the worker/wasm failing to load, which surfaces from
    // `recognize()` itself and is caught by the pipeline as a warning.
    return this.loadError === null;
  }

  async recognize(source: OcrSource): Promise<OcrRegion[]> {
    const image = toTesseractImage(source);
    if (image === null) {
      return [];
    }
    let worker: TesseractWorker;
    try {
      worker = await this.getWorker();
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
      console.warn('[TesseractOcrEngine] failed to load:', this.loadError);
      return [];
    }

    // `blocks: true` is NOT the default — confirmed by a live run that came
    // back with the correct `fullText` but an EMPTY `blocks` array. Without
    // this, OCR silently "succeeds" (recognizes real text) while producing
    // zero findings and zero bounding boxes, since block/paragraph/line
    // structure is what this engine reads to build `OcrRegion`s.
    const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
    const lines = this.extractLines(data);
    const regions: OcrRegion[] = lines
      .filter((l) => l.confidenceRaw >= this.config.minConfidence)
      .map((l) => ({ text: l.text, bbox: l.bbox, confidence: Math.round(l.confidenceRaw) / 100, origin: 'tesseract' }));

    const digitRegions = await this.recoverDigitLikeRegions(worker, image, regions);
    return [...regions, ...digitRegions];
  }

  /**
   * Second OCR pass restricted to digits/space/dash, layered on top of the
   * normal pass rather than replacing it.
   *
   * Tesseract's general-purpose English model frequently mangles
   * embossed/stylized card fonts badly enough that no PII regex can ever
   * match the first pass's text — confirmed live against a real credit card
   * screenshot: "5678" came back as "Sb1I8", "9010" as "90.0". A digit-only
   * whitelist reads the SAME pixels far more accurately (though still not
   * perfectly) because it can't misread a digit as a letter or symbol.
   * That's enough: this pipeline's job is recognizing "this is a card/ID-
   * shaped number" so it gets redacted, not transcribing it correctly.
   *
   * Two guards keep this from adding noise:
   * - `MIN_RECOVERY_DIGITS`: short digit runs (dates, quantities) are
   *   ignored — every sensitive numeric type this pipeline looks for is
   *   longer.
   * - Only lines overlapping a bbox the NORMAL pass already found text in
   *   are kept, so a digit-only pass latching onto background texture noise
   *   can't invent findings the first pass saw nothing at all in.
   *
   * Never throws: a failure here degrades to "no recovery", not a broken
   * OCR result — see the outer `recognize()`, which still returns the
   * normal-pass regions either way.
   */
  private async recoverDigitLikeRegions(
    worker: TesseractWorker,
    image: unknown,
    normalRegions: OcrRegion[]
  ): Promise<OcrRegion[]> {
    try {
      await worker.setParameters({ tessedit_char_whitelist: DIGIT_WHITELIST });
      const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
      const digitLines = this.extractLines(data);

      const recovered: OcrRegion[] = [];
      for (const line of digitLines) {
        const digitCount = (line.text.match(/\d/g) ?? []).length;
        if (digitCount < MIN_RECOVERY_DIGITS) {
          continue;
        }
        if (!normalRegions.some((r) => bboxesOverlap(r.bbox, line.bbox))) {
          continue;
        }
        recovered.push({
          text: line.text,
          bbox: line.bbox,
          // Tesseract's own confidence metric is unreliable under a
          // restricted whitelist — observed returning 0 even for an
          // accurate read, live, against the same card image quoted above.
          // A fixed moderate value stands in: this is a recovery candidate
          // for the regex engine to judge, not a verified read.
          confidence: 0.5,
          origin: 'tesseract-digits',
        });
      }
      return recovered;
    } catch (err) {
      console.warn('[TesseractOcrEngine] digit-recovery pass failed, continuing without it:', err);
      return [];
    } finally {
      // This worker is cached and reused for every future recognize() call
      // (see getWorker()) — never leave it whitelist-restricted for the next
      // caller's normal-text pass.
      await worker.setParameters({ tessedit_char_whitelist: '' }).catch(() => {});
    }
  }

  private extractLines(data: {
    blocks: Array<{ paragraphs: Array<{ lines: TesseractLine[] }> }> | null;
  }): Array<{ text: string; confidenceRaw: number; bbox: BoundingBox }> {
    const out: Array<{ text: string; confidenceRaw: number; bbox: BoundingBox }> = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const text = line.text.trim();
          if (text.length < 3) {
            continue;
          }
          out.push({ text, confidenceRaw: line.confidence, bbox: bboxFrom(line.bbox) });
        }
      }
    }
    return out;
  }

  /** Release the worker. Call when the panel session ends, if ever needed. */
  async terminate(): Promise<void> {
    if (this.workerPromise) {
      const worker = await this.workerPromise;
      await worker.terminate();
      this.workerPromise = null;
    }
  }

  /**
   * Force worker creation now instead of on the first `recognize()` call.
   * Intended for callers that want to pre-warm during idle time (see
   * `ocr-loader.ts`) rather than pay the cold-start cost mid-inspection.
   * Never throws — a failure here just means `recognize()` will report it
   * again (and fail the same way) when actually invoked.
   */
  async warmUp(): Promise<void> {
    try {
      await this.getWorker();
    } catch {
      /* surfaced again from recognize() when it's actually called */
    }
  }

  private async getWorker(): Promise<TesseractWorker> {
    if (!this.workerPromise) {
      this.workerPromise = withTimeout(this.createWorker(), WORKER_INIT_TIMEOUT_MS, 'tesseract worker init');
    }
    return this.workerPromise;
  }

  private async createWorker(): Promise<TesseractWorker> {
    // Dynamic import: tesseract.js is only pulled in when OCR is actually
    // used, and this keeps it out of any bundle that doesn't need it.
    //
    // tesseract.js's package `main` is a CJS module (`module.exports = {...}`).
    // Rollup's CJS interop wraps that as `{ default: <the real object> }` on
    // dynamic import, rather than hoisting `createWorker` etc. to the
    // namespace's own properties — confirmed by inspecting the actual built
    // chunk, not assumed. `mod.createWorker` is `undefined` in the real
    // bundle; only `mod.default.createWorker` exists. Handle both shapes so
    // this doesn't silently break if the bundler's interop behavior changes.
    const mod = await import('tesseract.js');
    const Tesseract = ((mod as unknown as { default?: TesseractModule }).default ??
      (mod as unknown as TesseractModule));
    const OEM_LSTM_ONLY = 1;
    return Tesseract.createWorker(this.config.lang, OEM_LSTM_ONLY, {
      workerPath: this.config.workerPath,
      corePath: this.config.corePath,
      langPath: this.config.langPath,
      // Load the worker script directly from its extension-origin URL
      // instead of wrapping it in a blob: URL — blob-sourced workers are a
      // recurring source of CSP friction in extension contexts.
      workerBlobURL: false,
      gzip: true, // the bundled lang data is `.traineddata.gz`
    });
  }
}

function bboxFrom(b: TesseractBbox): BoundingBox {
  return { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 };
}

function bboxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Map our generic OcrSource to whatever Tesseract's ImageLike expects. */
function toTesseractImage(source: OcrSource): unknown {
  switch (source.kind) {
    case 'canvas':
      return source.canvas;
    case 'image':
      return source.image;
    case 'dataUrl':
      return source.dataUrl;
    case 'document':
      // Tesseract has no notion of a whole document — that source kind is
      // DomTextOcrEngine's job (DOM-exposed alt/aria text).
      return null;
    default:
      return null;
  }
}
