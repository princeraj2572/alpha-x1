import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the wrapper (not tesseract.js itself) — that class is tested on its
// own in tesseract-ocr-engine.test.ts. This file only tests the loader's
// registration/caching behavior.
// `vi.mock` factories are hoisted above imports/consts, so the mock fn has
// to be created via `vi.hoisted` to be safely referenced inside one.
const { setEngineMock, warmUpMock } = vi.hoisted(() => ({
  setEngineMock: vi.fn(),
  warmUpMock: vi.fn(async () => {}),
}));
vi.mock('@/privacy/ocr', () => ({
  ocrService: { setEngine: setEngineMock },
}));
vi.mock('@/privacy/tesseract-ocr-engine', () => ({
  TesseractOcrEngine: vi.fn().mockImplementation((config: unknown) => ({
    __mockEngine: true,
    config,
    warmUp: warmUpMock,
  })),
}));

import { ensureRealOcrEngine, resetOcrLoader } from './ocr-loader';
import { ocrService } from '@/privacy/ocr';

beforeEach(() => {
  resetOcrLoader();
  setEngineMock.mockClear();
  warmUpMock.mockClear();
});

describe('ensureRealOcrEngine', () => {
  it('registers a TesseractOcrEngine on ocrService', async () => {
    const engine = await ensureRealOcrEngine();
    expect(engine).toBeTruthy();
    expect(ocrService.setEngine).toHaveBeenCalledWith(engine);
  });

  it('never fetches from a CDN — always resolves local extension-relative URLs', async () => {
    const engine = (await ensureRealOcrEngine()) as unknown as { config: Record<string, string> };
    for (const url of Object.values(engine.config)) {
      expect(url).not.toMatch(/^https?:\/\//);
      expect(url.startsWith('/')).toBe(true); // non-extension test fallback: "/tesseract/..."
    }
  });

  it('only registers once per session — repeat calls reuse the same engine', async () => {
    const a = await ensureRealOcrEngine();
    const b = await ensureRealOcrEngine();
    expect(a).toBe(b);
    expect(setEngineMock).toHaveBeenCalledTimes(1);
  });

  it('resetOcrLoader forces a fresh registration', async () => {
    await ensureRealOcrEngine();
    resetOcrLoader();
    await ensureRealOcrEngine();
    expect(setEngineMock).toHaveBeenCalledTimes(2);
  });

  it('actually pre-warms the worker, not just constructs the engine object', async () => {
    // Regression: an earlier version only `new`'d the TesseractOcrEngine
    // (cheap/sync) and never triggered real worker/WASM/lang-data loading,
    // making the "pre-warm" claim in App.tsx's mount effect false.
    await ensureRealOcrEngine();
    expect(warmUpMock).toHaveBeenCalledTimes(1);
  });

  it('never throws even if warmUp rejects (though the real engine never does)', async () => {
    // TesseractOcrEngine.warmUp() is documented to never throw, but the
    // loader's own try/catch is what actually guarantees this call site is
    // safe regardless — verify that guarantee holds on its own.
    warmUpMock.mockRejectedValueOnce(new Error('worker init failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(ensureRealOcrEngine()).resolves.toBeNull();
    warn.mockRestore();
  });
});
