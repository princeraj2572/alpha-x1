/**
 * OCR layer.
 *
 * Purpose: recover text that is visually present but not reachable through the
 * DOM — text baked into `<img>`, `<canvas>`, PDF viewers, embedded documents,
 * or a screenshot region. That recovered text is then run through the same
 * regex PII engine, so OCR never decides sensitivity on its own.
 *
 * The heavy lifting (a real OCR model such as Tesseract WASM) is intentionally
 * behind the `OcrEngine` interface. The default engine does DOM-accessible
 * text recovery only (alt text, aria-label, <canvas> that exposes text via
 * an author-provided `data-text`), which is cheap and always available. A
 * Tesseract-backed engine can be registered without touching callers.
 *
 * No raw OCR text is ever returned to the backend before it passes through
 * `scanOcrForPii`.
 */

import { RegexDetector, regexDetector } from './regex-detector';
import {
  PrivacyFinding,
  DetectionSource,
  BoundingBox,
} from './types';

/**
 * One recovered text region.
 */
export interface OcrRegion {
  text: string;
  bbox: BoundingBox;
  confidence: number;
  /** Where the text came from — `img-alt`, `canvas`, `tesseract`, ... */
  origin: string;
}

/**
 * Pluggable OCR backend. `recognize` takes an image source and returns
 * recovered regions. Implementations must run entirely on-device.
 */
export interface OcrEngine {
  readonly name: string;
  /** Cheap capability probe. */
  isAvailable(): Promise<boolean>;
  /**
   * Recognize text in an image. `source` may be a data URL, an ImageBitmap,
   * an HTMLCanvasElement, or an HTMLImageElement depending on the engine.
   */
  recognize(source: OcrSource): Promise<OcrRegion[]>;
}

export type OcrSource =
  | { kind: 'dataUrl'; dataUrl: string; bbox?: BoundingBox }
  | { kind: 'canvas'; canvas: HTMLCanvasElement }
  | { kind: 'image'; image: HTMLImageElement }
  | { kind: 'document'; doc: Document };

/**
 * Default engine: recovers only text the browser already exposes about visual
 * elements. Honest about its scope — it is NOT pixel OCR. It exists so the
 * pipeline has a working, zero-cost OCR stage until a model engine is wired.
 */
export class DomTextOcrEngine implements OcrEngine {
  readonly name = 'dom-text';

  async isAvailable(): Promise<boolean> {
    return typeof document !== 'undefined';
  }

  async recognize(source: OcrSource): Promise<OcrRegion[]> {
    if (source.kind !== 'document') {
      return [];
    }
    const doc = source.doc;
    const regions: OcrRegion[] = [];

    doc.querySelectorAll('img').forEach((img) => {
      const text = (img.alt || img.getAttribute('aria-label') || '').trim();
      if (text.length >= 3) {
        regions.push({
          text,
          bbox: rectOf(img),
          confidence: 0.6,
          origin: 'img-alt',
        });
      }
    });

    doc.querySelectorAll('canvas[data-text]').forEach((canvas) => {
      const text = (canvas.getAttribute('data-text') || '').trim();
      if (text.length >= 3) {
        regions.push({
          text,
          bbox: rectOf(canvas as HTMLElement),
          confidence: 0.5,
          origin: 'canvas-datatext',
        });
      }
    });

    doc.querySelectorAll('svg text, [role="img"][aria-label]').forEach((el) => {
      const text = (el.textContent || el.getAttribute('aria-label') || '').trim();
      if (text.length >= 3) {
        regions.push({
          text,
          bbox: rectOf(el as HTMLElement),
          confidence: 0.55,
          origin: 'svg-text',
        });
      }
    });

    return regions;
  }
}

function rectOf(el: HTMLElement): BoundingBox {
  try {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  } catch {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

/**
 * OCR service. Holds the active engine and turns recovered text into
 * `PrivacyFinding`s by running each region through the regex PII engine.
 */
export class OcrService {
  private engine: OcrEngine;
  private regex: RegexDetector;
  private runs = 0;
  private totalMs = 0;

  constructor(engine: OcrEngine = new DomTextOcrEngine(), regex: RegexDetector = regexDetector) {
    this.engine = engine;
    this.regex = regex;
  }

  /** Swap the OCR backend (e.g. to a Tesseract engine). */
  setEngine(engine: OcrEngine): void {
    this.engine = engine;
  }

  get engineName(): string {
    return this.engine.name;
  }

  async isAvailable(): Promise<boolean> {
    return this.engine.isAvailable();
  }

  /**
   * Recover text from `source`, scan it for PII, and return findings whose
   * bbox is the OCR region (so the redactor can blur that region) and whose
   * `textSpan` is relative to the region text.
   */
  async detect(source: OcrSource): Promise<PrivacyFinding[]> {
    return (await this.detectVerbose(source)).findings;
  }

  /**
   * Same as `detect`, but also reports how many text regions the engine
   * recognized in total — not just how many contained PII. "0 findings" is
   * ambiguous on its own: it's the same number whether the engine recognized
   * no text at all, or recognized plenty of text that simply isn't PII (a
   * page's ordinary headings/labels). Callers that surface OCR status to a
   * user (see `pipeline-runner.ts`) should report both.
   */
  async detectVerbose(source: OcrSource): Promise<{ findings: PrivacyFinding[]; regionCount: number }> {
    const started = now();
    const regions = await this.engine.recognize(source);
    const findings: PrivacyFinding[] = [];

    for (const region of regions) {
      const piiInRegion = this.regex.scan(region.text);
      for (const pii of piiInRegion) {
        findings.push({
          ...pii,
          source: DetectionSource.OCR,
          // Combine detector confidences: OCR region * regex match.
          confidence: round2(region.confidence * pii.confidence),
          bbox: region.bbox,
          detail: `${pii.detail ?? 'regex'} via ocr:${region.origin}`,
        });
      }
    }

    this.runs++;
    this.totalMs += now() - started;
    return { findings, regionCount: regions.length };
  }

  /**
   * Directly scan a block of already-recovered text (e.g. from a PDF text
   * layer) for PII. Exposed so non-image text sources reuse the same path.
   */
  scanText(text: string, bbox?: BoundingBox): PrivacyFinding[] {
    return this.regex.scan(text).map((pii) => ({
      ...pii,
      source: DetectionSource.OCR,
      bbox,
      detail: `${pii.detail ?? 'regex'} via ocr:text`,
    }));
  }

  getStats(): { runs: number; avgMs: number; engine: string } {
    return {
      runs: this.runs,
      avgMs: this.runs ? round2(this.totalMs / this.runs) : 0,
      engine: this.engine.name,
    };
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const ocrService = new OcrService();

/**
 * Standalone helper matching the spec's "OCR text → regex → finding" flow.
 */
export function scanOcrForPii(text: string, bbox?: BoundingBox): PrivacyFinding[] {
  return ocrService.scanText(text, bbox);
}
