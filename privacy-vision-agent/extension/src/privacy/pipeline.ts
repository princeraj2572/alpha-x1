/**
 * Local privacy pipeline — the top-level orchestrator.
 *
 *   RAW PAGE / SCREEN
 *        │
 *        ├── DOM rules        (fields: password/email/card/…)
 *        ├── Regex engine     (email/phone/card/Aadhaar/PAN/UPI/IP in text)
 *        ├── OCR → regex      (text baked into images/canvas/PDF)
 *        ├── Face detector    (face bounding boxes, no identity)
 *        └── Vision model     (person/document visual regions)
 *        │
 *        ▼
 *   Detection fusion   (merge duplicates, resolve conflicts, fail-closed)
 *        │
 *        ▼
 *   Redaction engine   (tokens for text, mask for fields, blur/blackout pixels)
 *        │
 *        ▼
 *   SANITIZED CONTEXT  (+ screenshot with visual redactions applied)
 *
 * Each stage is optional — a caller in a content script with no screenshot
 * runs DOM + regex only. Nothing here performs network I/O.
 */

import { PrivacyFinding, DetectionSource, toWireFinding } from './types';
import { RegexDetector, regexDetector } from './regex-detector';
import { DomRuleDetector, domRuleDetector, classifyField, FieldDescriptor } from './dom-rules';
import { OcrService, ocrService, OcrSource } from './ocr';
import { FaceDetectionService, faceDetectionService } from './face-detector';
import { VisionModel, visionModel } from './vision-model';
import { DetectionFusionEngine, detectionFusionEngine, FusionOptions } from './detection-fusion';
import { Redactor, redactor, VisualRedactionRegion, ImageLike } from './redactor';

export interface PipelineInput {
  /** Live document for DOM-rule + DOM-text-OCR scanning. */
  document?: Document;
  /** Free text blocks (element labels, page text) to scan with regex. */
  texts?: Array<{ text: string; elementId?: string }>;
  /** A screenshot for visual detectors + pixel redaction. */
  screenshot?: ImageLike;
  /** Image element/canvas sources for OCR. */
  ocrSources?: OcrSource[];
  /** Image source for face + vision detection (usually the screenshot). */
  visualSource?: CanvasImageSource;
}

export interface PipelineStageTiming {
  dom: number;
  regex: number;
  ocr: number;
  face: number;
  vision: number;
  fusion: number;
  redaction: number;
  total: number;
}

export interface PipelineResult {
  /** Fused, policy-applied findings. */
  findings: PrivacyFinding[];
  /** Regions to redact on the screenshot. */
  visualRegions: VisualRedactionRegion[];
  /** Screenshot with blur/blackout applied (only if a screenshot was given). */
  redactedScreenshot?: ImageLike;
  /** Redacted copies of the input text blocks, keyed by index. */
  redactedTexts: Array<{ elementId?: string; text: string }>;
  /** Count/type report — safe to log, no raw values. */
  report: ReturnType<Redactor['report']>;
  timing: PipelineStageTiming;
  /** Which backends actually ran. */
  backends: { face: string; vision: string; ocr: string };
}

export interface PipelineConfig {
  fusion?: FusionOptions;
  regexMinConfidence?: number;
  enableOcr?: boolean;
  enableFace?: boolean;
  enableVision?: boolean;
}

export class PrivacyPipeline {
  constructor(
    private dom: DomRuleDetector = domRuleDetector,
    private regex: RegexDetector = regexDetector,
    private ocr: OcrService = ocrService,
    private face: FaceDetectionService = faceDetectionService,
    private vision: VisionModel = visionModel,
    private fusion: DetectionFusionEngine = detectionFusionEngine,
    private redact: Redactor = redactor
  ) {}

  async run(input: PipelineInput, config: PipelineConfig = {}): Promise<PipelineResult> {
    const t0 = now();
    const raw: PrivacyFinding[] = [];
    const timing: PipelineStageTiming = {
      dom: 0, regex: 0, ocr: 0, face: 0, vision: 0, fusion: 0, redaction: 0, total: 0,
    };

    // --- DOM rules ---
    let mark = now();
    if (input.document) {
      raw.push(...this.dom.scanDocument(input.document));
    }
    timing.dom = since(mark);

    // --- Regex over supplied text blocks ---
    mark = now();
    const redactedTexts: Array<{ elementId?: string; text: string }> = [];
    for (const block of input.texts ?? []) {
      const findings = this.regex.scan(block.text, { minConfidence: config.regexMinConfidence });
      for (const f of findings) {
        raw.push({ ...f, elementId: block.elementId ?? f.elementId });
      }
      redactedTexts.push({
        elementId: block.elementId,
        text: this.redact.redactText(block.text, findings).text,
      });
    }
    timing.regex = since(mark);

    // --- OCR -> regex ---
    mark = now();
    let ocrBackend = 'disabled';
    if (config.enableOcr !== false) {
      ocrBackend = this.ocr.engineName;
      const sources: OcrSource[] = [...(input.ocrSources ?? [])];
      if (input.document) {
        sources.push({ kind: 'document', doc: input.document });
      }
      for (const source of sources) {
        try {
          raw.push(...(await this.ocr.detect(source)));
        } catch (err) {
          console.warn('[Pipeline] OCR source failed:', err);
        }
      }
    }
    timing.ocr = since(mark);

    // --- Face detection ---
    mark = now();
    let faceBackend = 'disabled';
    if (config.enableFace !== false && input.visualSource) {
      try {
        faceBackend = await this.face.activeBackend();
        raw.push(...(await this.face.detectFindings(input.visualSource)));
      } catch (err) {
        console.warn('[Pipeline] face detection failed:', err);
      }
    }
    timing.face = since(mark);

    // --- Vision model ---
    mark = now();
    let visionBackend = 'disabled';
    if (config.enableVision !== false && input.screenshot && this.vision.isReady()) {
      try {
        visionBackend = this.vision.getExecutionProvider();
        raw.push(...(await this.vision.detectFindings(input.screenshot)));
      } catch (err) {
        console.warn('[Pipeline] vision model failed:', err);
      }
    }
    timing.vision = since(mark);

    // --- Fusion + risk policy ---
    mark = now();
    let fused = this.fusion.fuse(raw, config.fusion);
    fused = this.fusion.applyRiskPolicy(fused);
    timing.fusion = since(mark);

    // --- Redaction ---
    mark = now();
    const visualRegions = this.redact.visualRegions(fused);
    let redactedScreenshot: ImageLike | undefined;
    if (input.screenshot && visualRegions.length) {
      redactedScreenshot = this.redact.applyVisualRedaction(input.screenshot, visualRegions);
    }
    timing.redaction = since(mark);

    timing.total = since(t0);

    return {
      findings: fused,
      visualRegions,
      redactedScreenshot,
      redactedTexts,
      report: this.redact.report(fused),
      timing,
      backends: { face: faceBackend, vision: visionBackend, ocr: ocrBackend },
    };
  }

  /**
   * Assertion used by the critical security test: given the pipeline result
   * and the original raw values, verify none of them appear in the outbound
   * artifacts (redacted texts + report JSON).
   */
  static assertNoRawLeak(result: PipelineResult, rawValues: string[]): { ok: boolean; leaked: string[] } {
    const haystack = JSON.stringify({
      texts: result.redactedTexts,
      report: result.report,
      // findings are serialized WITHOUT rawValue by the transport layer, but
      // check the sanitized projection here too.
      findings: result.findings.map((f) => ({ ...f, rawValue: undefined })),
    });
    const leaked = rawValues.filter((v) => v && haystack.includes(v));
    return { ok: leaked.length === 0, leaked };
  }
}

/** Re-exported from `./types` for existing import sites. */
export { toWireFinding };

/** Classify an ad-hoc field descriptor (re-export for callers). */
export function classifyFieldDescriptor(desc: FieldDescriptor) {
  return classifyField(desc);
}

/** Re-export for convenience. */
export { DetectionSource };

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
function since(mark: number): number {
  return Math.round((now() - mark) * 100) / 100;
}

export const privacyPipeline = new PrivacyPipeline();
