/**
 * Lazily initializes the shared `visionModel` singleton (see
 * `@/privacy/vision-model`) against a model file packaged at the extension
 * origin. Runs once per Side Panel session; later calls reuse the same
 * `InferenceSession`.
 *
 * The model is currently YOLOv8n (COCO). It shares YOLO11n's exact output
 * tensor shape (`[1, 4+nc, n]`), so `VisionModel` needed zero code changes —
 * see DECISION-018 for why YOLOv8n was substituted for the originally-planned
 * YOLO11n candidate.
 */

import { visionModel, VisionModel } from '@/privacy/vision-model';
import { withTimeout } from '@/privacy/async-utils';

const MODEL_FILENAME = 'models/yolov8n.onnx';
/** Generous margin over the ~1.9s cold WebGPU compile measured in
 * DECISION-018 — covers slower hardware/disk, still bounded. If this ever
 * fires, it means the session genuinely stalled (e.g. a WebGPU driver hang),
 * not that it was merely slow. */
const INIT_TIMEOUT_MS = 20_000;

let initPromise: Promise<VisionModel | null> | null = null;
let lastError: string | null = null;

function resolveModelUrl(): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(MODEL_FILENAME);
  }
  // Fallback for non-extension contexts (e.g. a dev server / tests).
  return `/${MODEL_FILENAME}`;
}

/**
 * Returns the ready `VisionModel`, or `null` if it could not be loaded (model
 * file missing, no execution provider available, ...). Never throws — the
 * pipeline treats "no vision model" the same as "no face detector": a
 * `warning` stage, not a hard failure.
 */
export async function getVisionModel(): Promise<VisionModel | null> {
  if (!initPromise) {
    initPromise = withTimeout(
      visionModel.init({ modelUrl: resolveModelUrl(), inputSize: 640 }),
      INIT_TIMEOUT_MS,
      'vision model init'
    )
      .then(() => visionModel)
      .catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn('[VisionLoader] model unavailable:', lastError);
        return null;
      });
  }
  return initPromise;
}

/** Reason the last `getVisionModel()` attempt returned `null`, if any. */
export function getVisionModelError(): string | null {
  return lastError;
}

/** For tests: force a fresh load on the next call. */
export function resetVisionLoader(): void {
  initPromise = null;
  lastError = null;
}
