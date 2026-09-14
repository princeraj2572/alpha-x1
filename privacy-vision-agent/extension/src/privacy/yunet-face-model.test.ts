import { describe, it, expect, vi } from 'vitest';

// See vision-model.test.ts for why the whole ort-loader module is mocked
// rather than letting vitest's Node runner try to resolve it.
vi.mock('./ort-loader', () => ({
  loadOrtModule: vi.fn(async () => {
    throw new Error('onnxruntime-web is browser-only; not available under vitest/Node');
  }),
}));

import { nms, YuNetFaceModel } from './yunet-face-model';

function box(x: number, score: number) {
  return { x, y: 0, w: 50, h: 50, score };
}

describe('nms (single-class)', () => {
  it('suppresses heavily overlapping boxes', () => {
    const kept = nms([box(0, 0.9), box(5, 0.8), box(300, 0.7)], 0.5);
    expect(kept).toHaveLength(2);
    expect(kept.map((d) => d.x).sort((a, b) => a - b)).toEqual([0, 300]);
  });

  it('keeps the highest-scoring box from a cluster', () => {
    const kept = nms([box(0, 0.6), box(3, 0.95), box(6, 0.7)], 0.5);
    expect(kept).toHaveLength(1);
    expect(kept[0].score).toBe(0.95);
  });
});

describe('YuNetFaceModel — lifecycle without a model file', () => {
  it('isAvailable() resolves false (never throws) when the model URL cannot be fetched', async () => {
    const model = new YuNetFaceModel({ modelUrl: 'https://localhost:0/definitely-missing-model.onnx' });
    expect(await model.isAvailable()).toBe(false);
  });

  // Mirrors FaceDetectionService's own contract: callers only invoke
  // detect() after isAvailable() confirmed the backend is usable, so an
  // uninitialized detect() call surfaces the failure rather than silently
  // returning [] — the same behavior VisionModel.detect() has.
  it('detect() rejects when the backend never became available', async () => {
    const model = new YuNetFaceModel({ modelUrl: 'https://localhost:0/definitely-missing-model.onnx' });
    await expect(model.detect({} as CanvasImageSource)).rejects.toThrow();
  });
});
