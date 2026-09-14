/**
 * Registers the real (Tesseract.js) OCR engine on the shared `ocrService`
 * singleton, panel-side only.
 *
 * Mirrors `vision-loader.ts`: the content script's own `PrivacyPipeline.run()`
 * call keeps using the default `DomTextOcrEngine` (cheap, DOM-only, no
 * download) — this loader only affects the Side Panel's separate module
 * instance, since the content script and panel are separate bundles/processes
 * and never share JS module state. See DECISION-023 for why OCR runs
 * panel-side, on the captured screenshot, rather than content-script-side.
 */

import { ocrService } from '@/privacy/ocr';
import { TesseractOcrEngine } from '@/privacy/tesseract-ocr-engine';

let initPromise: Promise<TesseractOcrEngine | null> | null = null;

function resolveUrl(path: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return `/${path}`;
}

/**
 * Ensure the Tesseract engine is registered on `ocrService`. Safe to call
 * repeatedly — only sets it up once per panel session. Never throws; a
 * failure here just means OCR-on-screenshot findings will be empty and the
 * pipeline's own try/catch around the OCR step reports it as a warning.
 */
export async function ensureRealOcrEngine(): Promise<TesseractOcrEngine | null> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const engine = new TesseractOcrEngine({
          workerPath: resolveUrl('tesseract/worker.min.js'),
          // Must sit in the SAME directory as worker.min.js, not a
          // subdirectory: the Emscripten glue file resolves its sibling
          // .wasm file relative to `self.location.href` (the worker's own
          // URL) when loaded via importScripts(), not relative to whatever
          // corePath itself points at. Confirmed by reproducing the 404 with
          // a `core/` subdirectory layout — see DECISION-023.
          corePath: resolveUrl('tesseract/tesseract-core-simd-lstm.js'),
          langPath: resolveUrl('tesseract/lang'),
        });
        ocrService.setEngine(engine);
        // Actually trigger worker/WASM/lang-data loading now, during idle
        // pre-warm, instead of leaving it deferred to the first real
        // `recognize()` call mid-inspection. Constructing the engine above is
        // cheap/sync; this is the real cost. `warmUp()` never throws.
        await engine.warmUp();
        return engine;
      } catch (err) {
        console.warn('[OcrLoader] Tesseract unavailable:', err instanceof Error ? err.message : err);
        return null;
      }
    })();
  }
  return initPromise;
}

/** For tests: force a fresh load on the next call. */
export function resetOcrLoader(): void {
  initPromise = null;
}
