import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mock tesseract.js itself (not our wrapper — this file tests the wrapper).
 * Lets tests control exactly what "recognition" returns without a real
 * worker, WASM core, or language data — none of which are meaningfully
 * available under vitest/Node anyway.
 */
const { recognizeMock, createWorkerMock } = vi.hoisted(() => {
  const recognizeMock = vi.fn();
  const terminateMock = vi.fn(async () => {});
  const createWorkerMock = vi.fn(async (..._args: unknown[]) => ({
    recognize: recognizeMock,
    terminate: terminateMock,
  }));
  return { recognizeMock, createWorkerMock };
});

// tesseract.js's real `main` is CJS; Rollup's dynamic-import interop wraps it
// as `{ default: <module> }` rather than hoisting named exports — confirmed
// by inspecting the actual production bundle (see the fix this test guards).
// Mock the SAME shape so this test would have caught that bug.
vi.mock('tesseract.js', () => ({
  default: { createWorker: createWorkerMock },
}));

import { TesseractOcrEngine } from './tesseract-ocr-engine';

function page(blocks: unknown[]) {
  return { data: { blocks } };
}

function line(text: string, confidence: number, box = { x0: 10, y0: 20, x1: 110, y1: 40 }) {
  return { text, confidence, bbox: box };
}

const config = {
  workerPath: 'chrome-extension://test/tesseract/worker.min.js',
  corePath: 'chrome-extension://test/tesseract/core/tesseract-core-simd-lstm.js',
  langPath: 'chrome-extension://test/tesseract/lang',
};

beforeEach(() => {
  createWorkerMock.mockClear();
  recognizeMock.mockReset();
});

describe('TesseractOcrEngine.recognize', () => {
  it('converts Tesseract blocks/paragraphs/lines into OcrRegions', async () => {
    recognizeMock.mockResolvedValue(
      page([
        {
          paragraphs: [
            {
              lines: [
                line('PAN ABCDE1234F', 92),
                line('test.user@example.invalid', 88, { x0: 10, y0: 50, x1: 200, y1: 70 }),
              ],
            },
          ],
        },
      ])
    );

    const engine = new TesseractOcrEngine(config);
    const regions = await engine.recognize({ kind: 'canvas', canvas: {} as HTMLCanvasElement });

    expect(regions).toHaveLength(2);
    expect(regions[0]).toEqual({
      text: 'PAN ABCDE1234F',
      bbox: { x: 10, y: 20, width: 100, height: 20 },
      confidence: 0.92,
      origin: 'tesseract',
    });
    expect(regions[1].text).toBe('test.user@example.invalid');
  });

  it('regression: requests { blocks: true } output — it is NOT the default', async () => {
    // Found via a live run: worker.recognize(image) with no output options
    // returns the correct `fullText` but an EMPTY `blocks` array, which this
    // engine relies on entirely to build bounding boxes. Without requesting
    // it explicitly, OCR silently "succeeds" while producing zero findings.
    recognizeMock.mockResolvedValue(page([]));
    const engine = new TesseractOcrEngine(config);
    await engine.recognize({ kind: 'canvas', canvas: {} as HTMLCanvasElement });

    expect(recognizeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ blocks: true })
    );
  });

  it('creates the worker with the given local URLs, never a CDN default', async () => {
    recognizeMock.mockResolvedValue(page([]));
    const engine = new TesseractOcrEngine(config);
    await engine.recognize({ kind: 'canvas', canvas: {} as HTMLCanvasElement });

    expect(createWorkerMock).toHaveBeenCalledWith(
      'eng',
      1,
      expect.objectContaining({
        workerPath: config.workerPath,
        corePath: config.corePath,
        langPath: config.langPath,
        workerBlobURL: false,
        gzip: true,
      })
    );
  });

  it('reuses one worker across multiple recognize calls', async () => {
    recognizeMock.mockResolvedValue(page([]));
    const engine = new TesseractOcrEngine(config);
    await engine.recognize({ kind: 'canvas', canvas: {} as HTMLCanvasElement });
    await engine.recognize({ kind: 'canvas', canvas: {} as HTMLCanvasElement });
    expect(createWorkerMock).toHaveBeenCalledTimes(1);
  });

  it('filters out low-confidence and too-short lines', async () => {
    recognizeMock.mockResolvedValue(
      page([
        {
          paragraphs: [
            {
              lines: [
                line('ab', 99), // too short
                line('real finding here', 10), // below default min confidence 40
                line('kept line of text', 75),
              ],
            },
          ],
        },
      ])
    );
    const engine = new TesseractOcrEngine(config);
    const regions = await engine.recognize({ kind: 'canvas', canvas: {} as HTMLCanvasElement });
    expect(regions).toHaveLength(1);
    expect(regions[0].text).toBe('kept line of text');
  });

  it('returns [] for a "document" source — that is DomTextOcrEngine\'s job, not Tesseract\'s', async () => {
    const engine = new TesseractOcrEngine(config);
    const regions = await engine.recognize({ kind: 'document', doc: document });
    expect(regions).toEqual([]);
    expect(createWorkerMock).not.toHaveBeenCalled();
  });

  it('fails closed: a worker-creation error returns [] and marks isAvailable() false, never throws', async () => {
    createWorkerMock.mockRejectedValueOnce(new Error('wasm fetch failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = new TesseractOcrEngine(config);

    const regions = await engine.recognize({ kind: 'canvas', canvas: {} as HTMLCanvasElement });
    expect(regions).toEqual([]);
    expect(await engine.isAvailable()).toBe(false);

    warn.mockRestore();
  });

  it('regression: a stalled createWorker() times out instead of hanging forever', async () => {
    // Found via a live report of the vision/OCR pipeline appearing to "hang"
    // with zero feedback: nothing anywhere bounded worker/model init, so a
    // genuine stall (e.g. a stuck fetch for the WASM core) never resolved or
    // rejected. Simulate that stall with a promise that never settles.
    vi.useFakeTimers();
    createWorkerMock.mockImplementationOnce(() => new Promise(() => {}));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = new TesseractOcrEngine(config);

    const resultPromise = engine.recognize({ kind: 'canvas', canvas: {} as HTMLCanvasElement });
    await vi.advanceTimersByTimeAsync(20_000);
    const regions = await resultPromise;

    expect(regions).toEqual([]);
    expect(await engine.isAvailable()).toBe(false);

    warn.mockRestore();
    vi.useRealTimers();
  });
});

describe('TesseractOcrEngine.warmUp', () => {
  it('triggers worker creation eagerly, ahead of any recognize() call', async () => {
    const engine = new TesseractOcrEngine(config);
    await engine.warmUp();
    expect(createWorkerMock).toHaveBeenCalledTimes(1);

    // A subsequent recognize() reuses the already-warmed worker.
    recognizeMock.mockResolvedValue(page([]));
    await engine.recognize({ kind: 'canvas', canvas: {} as HTMLCanvasElement });
    expect(createWorkerMock).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when worker creation fails', async () => {
    createWorkerMock.mockRejectedValueOnce(new Error('wasm fetch failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = new TesseractOcrEngine(config);

    await expect(engine.warmUp()).resolves.toBeUndefined();

    warn.mockRestore();
  });
});
