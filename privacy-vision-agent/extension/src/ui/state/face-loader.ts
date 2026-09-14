/**
 * Lazily registers a `YuNetFaceModel` onto the shared `faceDetectionService`
 * singleton (see `@/privacy/face-detector`) as its local-model fallback, so
 * `FaceDetectionService.detect()` still finds faces on browsers that don't
 * expose the platform Shape Detection API (i.e. almost all of them outside
 * ChromeOS/Android) — see `@/privacy/yunet-face-model` for the model itself.
 *
 * Mirrors `vision-loader.ts`: runs once per Side Panel session, never throws.
 */

import { faceDetectionService } from '@/privacy/face-detector';
import { YuNetFaceModel } from '@/privacy/yunet-face-model';
import { withTimeout } from '@/privacy/async-utils';

const MODEL_FILENAME = 'models/face_detection_yunet_2023mar.onnx';
const INIT_TIMEOUT_MS = 20_000;

let initPromise: Promise<boolean> | null = null;
let lastError: string | null = null;

function resolveModelUrl(): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(MODEL_FILENAME);
  }
  return `/${MODEL_FILENAME}`;
}

/**
 * Registers the local face model and warms it up. Returns whether it's
 * usable — never throws. Safe to call repeatedly; only initializes once.
 */
export async function ensureLocalFaceModel(): Promise<boolean> {
  if (!initPromise) {
    const model = new YuNetFaceModel({ modelUrl: resolveModelUrl() });
    faceDetectionService.setModel(model);
    initPromise = withTimeout(model.isAvailable(), INIT_TIMEOUT_MS, 'face model init')
      .then((ok) => {
        // `isAvailable()` never rejects (it catches its own init errors and
        // resolves `false`), so surface a fallback reason here — the real
        // one already went to console via YuNetFaceModel's own warning.
        if (!ok) {
          lastError = 'model reported unavailable';
          console.warn('[FaceLoader] local model unavailable:', lastError);
        }
        return ok;
      })
      .catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn('[FaceLoader] local model unavailable:', lastError);
        return false;
      });
  }
  return initPromise;
}

export function getFaceModelError(): string | null {
  return lastError;
}

/** For tests: force a fresh load on the next call. */
export function resetFaceLoader(): void {
  initPromise = null;
  lastError = null;
}
