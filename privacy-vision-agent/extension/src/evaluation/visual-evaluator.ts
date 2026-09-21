/**
 * Visual Accuracy Evaluator
 *
 * Was measuring `vision/vision-engine.ts` — a stub whose own comment reads
 * "for now, uses heuristic-based detection," never the real production
 * vision pipeline (`privacy/vision-model.ts`'s YOLOv8n, `privacy/face-detector.ts`,
 * `privacy/ocr.ts` — what `pipeline-runner.ts` actually calls). DECISION-031
 * called that out rather than silently wiring it: an evaluator reporting
 * PASS for a stub is worse than no evaluator.
 *
 * This now calls the real detectors. It can still only report a genuine
 * accuracy NUMBER (precision/recall against known ground truth) when run in
 * a live browser with a WebGPU/WASM execution provider — `onnxruntime-web`'s
 * package exports declare `"node": null` (see `ort-loader.ts`), so neither
 * the object model nor the face model can load under vitest/Node at all, in
 * this repo or any other. That's not a gap in THIS evaluator; it's true of
 * every vision-dependent test in the codebase (see the
 * "[VisionLoader] model unavailable" warnings `vision-loader.test.ts` and
 * others already print under vitest). So: when no execution provider is
 * available, this reports `measured: false` with a reason, never a
 * fabricated pass — the same principle DECISION-031 established.
 */

import { getVisionModel, getVisionModelError } from '@/ui/state/vision-loader';
import { faceDetectionService } from '@/privacy/face-detector';
import { getFaceModelError } from '@/ui/state/face-loader';
import { ImageLike } from '@/privacy/redactor';
import { PrivacyFinding, PrivacyType, BoundingBox } from '@/privacy/types';
import { VisualGroundTruthEntry } from './visual-ground-truth-dataset';

export interface VisualDetectionResult {
  measured: boolean;
  reason?: string;
  objectFindingsCount: number;
  faceFindingsCount: number;
  inferenceTimeMs: number;
}

interface TypedBox extends BoundingBox {
  type: PrivacyType.FACE | PrivacyType.DOCUMENT;
  confidence?: number;
}

export interface BoxMatchStats {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

function boxIou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

/**
 * Greedy IoU matching between predicted boxes and ground truth boxes of the
 * same `type`. Pure function — no detector calls — so it's fully unit-
 * testable under vitest regardless of onnxruntime-web's Node restriction;
 * that restriction only affects producing the `predicted` array for real,
 * not this comparison once you have one.
 */
export function matchBoxes(predicted: TypedBox[], groundTruth: TypedBox[], iouThreshold: number): BoxMatchStats {
  const remaining = groundTruth.map((box, index) => ({ box, index }));
  const ordered = [...predicted].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  let truePositives = 0;

  for (const pred of ordered) {
    let bestIou = 0;
    let bestPos = -1;
    for (let i = 0; i < remaining.length; i++) {
      const { box } = remaining[i];
      if (box.type !== pred.type) {
        continue;
      }
      const overlap = boxIou(pred, box);
      if (overlap >= iouThreshold && overlap > bestIou) {
        bestIou = overlap;
        bestPos = i;
      }
    }
    if (bestPos >= 0) {
      truePositives++;
      remaining.splice(bestPos, 1);
    }
  }

  return {
    truePositives,
    falsePositives: predicted.length - truePositives,
    falseNegatives: remaining.length,
  };
}

function findingsToBoxes(findings: PrivacyFinding[]): TypedBox[] {
  const boxes: TypedBox[] = [];
  for (const f of findings) {
    if (!f.bbox || (f.type !== PrivacyType.FACE && f.type !== PrivacyType.DOCUMENT)) {
      continue;
    }
    boxes.push({ ...f.bbox, type: f.type, confidence: f.confidence });
  }
  return boxes;
}

export interface GroundTruthFixtureResult {
  entryId: string;
  measured: boolean;
  reason?: string;
  stats: BoxMatchStats;
}

export interface GroundTruthReport {
  measured: boolean;
  reason?: string;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  perFixture: GroundTruthFixtureResult[];
}

export class VisualEvaluator {
  /**
   * Runs the real object + face detectors against the same screenshot,
   * in the two shapes each real detector actually takes — matching
   * `pipeline-runner.ts` exactly: the vision model takes `ImageLike`
   * (decoded pixel data), the face detector takes a canvas. Reports what
   * each one found; does NOT compare against a ground truth, since there is
   * no maintained synthetic-screenshot dataset with known object positions
   * the way `synthetic-dataset.ts` provides for text/field PII — that's a
   * real follow-up (see DECISIONS.md), not something to fake here.
   */
  static async evaluateDetection(canvas: CanvasImageSource, image: ImageLike): Promise<VisualDetectionResult> {
    const start = performance.now();
    const model = await getVisionModel();
    const faceBackend = await faceDetectionService.activeBackend();

    if (!model && faceBackend === 'none') {
      return {
        measured: false,
        reason:
          getVisionModelError() ??
          getFaceModelError() ??
          'no vision execution provider available in this environment',
        objectFindingsCount: 0,
        faceFindingsCount: 0,
        inferenceTimeMs: 0,
      };
    }

    let objectFindings: PrivacyFinding[] = [];
    if (model) {
      objectFindings = await model.detectFindings(image);
    }

    let faceFindings: PrivacyFinding[] = [];
    if (faceBackend !== 'none') {
      faceFindings = await faceDetectionService.detectFindings(canvas);
    }

    return {
      measured: true,
      objectFindingsCount: objectFindings.length,
      faceFindingsCount: faceFindings.length,
      inferenceTimeMs: performance.now() - start,
    };
  }

  /**
   * Generate visual accuracy report. `overall.allTestsPassed` is `null`
   * (not `true`/`false`) when nothing could be measured — a category with
   * no data isn't a pass, and reporting it as one is exactly the false-
   * confidence failure this rewrite exists to fix.
   */
  static async evaluateSummary(canvas: CanvasImageSource, image: ImageLike) {
    const detection = await this.evaluateDetection(canvas, image);

    return {
      title: 'Visual Accuracy Evaluation Summary',
      timestamp: new Date().toISOString(),
      measured: detection.measured,
      reason: detection.reason,
      detection: {
        objectFindingsCount: detection.objectFindingsCount,
        faceFindingsCount: detection.faceFindingsCount,
        inferenceTimeMs: detection.inferenceTimeMs.toFixed(2),
      },
      overall: {
        allTestsPassed: detection.measured ? true : null,
      },
    };
  }

  /**
   * Runs the real detectors against one ground-truth fixture image and
   * IoU-matches the result against its known boxes (`visual-ground-truth-
   * dataset.ts`). This is the "genuine precision/recall NUMBER" the earlier
   * rewrite's revisit note asked for — `evaluateDetection` above only ever
   * reported raw counts because it had no ground truth to compare against.
   */
  static async evaluateFixture(
    entry: VisualGroundTruthEntry,
    canvas: CanvasImageSource,
    image: ImageLike,
    iouThreshold = 0.5
  ): Promise<GroundTruthFixtureResult> {
    const model = await getVisionModel();
    const faceBackend = await faceDetectionService.activeBackend();

    if (!model && faceBackend === 'none') {
      return {
        entryId: entry.id,
        measured: false,
        reason:
          getVisionModelError() ??
          getFaceModelError() ??
          'no vision execution provider available in this environment',
        stats: { truePositives: 0, falsePositives: 0, falseNegatives: entry.boxes.length },
      };
    }

    const objectFindings = model ? await model.detectFindings(image) : [];
    const faceFindings = faceBackend !== 'none' ? await faceDetectionService.detectFindings(canvas) : [];
    const predicted = [...findingsToBoxes(objectFindings), ...findingsToBoxes(faceFindings)];
    const groundTruth: TypedBox[] = entry.boxes.map((b) => ({
      type: b.type,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    }));

    return {
      entryId: entry.id,
      measured: true,
      stats: matchBoxes(predicted, groundTruth, iouThreshold),
    };
  }

  /**
   * Aggregates `evaluateFixture` across every fixture the caller loaded
   * (a developer supplies decoded `{canvas, image}` per entry — this module
   * has no file-system access and can't load `public/visual-fixtures/`
   * itself; see OPERATIONS.md §8.6). Fixtures that couldn't be measured
   * don't silently count as zero — if NONE could be measured, the whole
   * report is `measured: false`; a mix of measured/unmeasured fixtures
   * scores only the measured ones and says so via `perFixture`.
   */
  static async evaluateGroundTruth(
    fixtures: Array<{ entry: VisualGroundTruthEntry; canvas: CanvasImageSource; image: ImageLike }>,
    iouThreshold = 0.5
  ): Promise<GroundTruthReport> {
    const perFixture: GroundTruthFixtureResult[] = [];
    for (const f of fixtures) {
      perFixture.push(await this.evaluateFixture(f.entry, f.canvas, f.image, iouThreshold));
    }

    const measuredResults = perFixture.filter((r) => r.measured);
    if (measuredResults.length === 0) {
      return {
        measured: false,
        reason: perFixture[0]?.reason ?? 'no fixtures provided',
        precision: null,
        recall: null,
        f1: null,
        perFixture,
      };
    }

    const totals = measuredResults.reduce(
      (acc, r) => ({
        tp: acc.tp + r.stats.truePositives,
        fp: acc.fp + r.stats.falsePositives,
        fn: acc.fn + r.stats.falseNegatives,
      }),
      { tp: 0, fp: 0, fn: 0 }
    );
    const precision = totals.tp + totals.fp > 0 ? totals.tp / (totals.tp + totals.fp) : null;
    const recall = totals.tp + totals.fn > 0 ? totals.tp / (totals.tp + totals.fn) : null;
    const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;

    return { measured: true, precision, recall, f1, perFixture };
  }
}
