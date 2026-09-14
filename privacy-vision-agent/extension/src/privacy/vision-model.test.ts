import { describe, it, expect, vi } from 'vitest';

// `./ort-loader` imports onnxruntime-web's `/webgpu` and `/wasm` subpaths with
// STATIC specifiers so the real bundler can code-split them for the browser.
// Both subpaths declare `"node": null` in their package exports, so Node
// (vitest's runner) cannot resolve either one — mock the whole loader module
// so its real source (and those imports) is never transformed/evaluated here.
vi.mock('./ort-loader', () => ({
  loadOrtModule: vi.fn(async () => {
    throw new Error('onnxruntime-web is browser-only; not available under vitest/Node');
  }),
}));

import { nms, VisionDetection, VisionModel } from './vision-model';

function det(x: number, score: number, classId = 0): VisionDetection {
  return { classId, className: 'person', score, bbox: { x, y: 0, width: 50, height: 50 } };
}

describe('nms', () => {
  it('suppresses heavily overlapping boxes of the same class', () => {
    const kept = nms([det(0, 0.9), det(5, 0.8), det(300, 0.7)], 0.5);
    expect(kept).toHaveLength(2);
    expect(kept.map((d) => d.bbox.x).sort((a, b) => a - b)).toEqual([0, 300]);
  });

  it('keeps overlapping boxes of different classes', () => {
    const kept = nms([det(0, 0.9, 0), det(2, 0.85, 1)], 0.5);
    expect(kept).toHaveLength(2);
  });

  it('returns the highest-scoring box from a cluster', () => {
    const kept = nms([det(0, 0.6), det(3, 0.95), det(6, 0.7)], 0.5);
    expect(kept).toHaveLength(1);
    expect(kept[0].score).toBe(0.95);
  });
});

describe('VisionModel — lifecycle without a model file', () => {
  it('is not ready before init and reports "none" provider', () => {
    const model = new VisionModel();
    expect(model.isReady()).toBe(false);
    expect(model.getExecutionProvider()).toBe('none');
  });

  it('detectFindings returns [] when uninitialized', async () => {
    const model = new VisionModel();
    expect(await model.detectFindings({ data: new Uint8ClampedArray(4), width: 1, height: 1 })).toEqual([]);
  });

  it('init rejects clearly when the model URL cannot be fetched', async () => {
    const model = new VisionModel();
    await expect(
      model.init({ modelUrl: 'https://localhost:0/definitely-missing-model.onnx' })
    ).rejects.toThrow();
  });
});
