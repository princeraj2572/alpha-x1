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
import { PrivacyFinding } from '@/privacy/types';

export interface VisualDetectionResult {
  measured: boolean;
  reason?: string;
  objectFindingsCount: number;
  faceFindingsCount: number;
  inferenceTimeMs: number;
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
}
