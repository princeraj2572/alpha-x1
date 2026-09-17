import { describe, it, expect, vi } from 'vitest';

// See vision-loader.test.ts / vision-model.test.ts for why: vitest's Vite-
// powered Node runner tries to statically resolve ort-loader.ts's
// `import('onnxruntime-web/webgpu')` specifier even though it's only ever
// reached inside an async function, and onnxruntime-web declares
// `"node": null` in its package exports — so resolution fails before any
// test code runs, not just when the branch is taken.
vi.mock('@/privacy/ort-loader', () => ({
  loadOrtModule: vi.fn(async () => {
    throw new Error('onnxruntime-web is browser-only; not available under vitest/Node');
  }),
}));

import { VisualEvaluator } from './visual-evaluator';

/**
 * Under vitest/Node, both the object model (`getVisionModel`) and the face
 * model naturally resolve to "unavailable" — onnxruntime-web declares
 * `"node": null` in its package exports, so neither can load here, exactly
 * as `vision-loader.test.ts` / `yunet-face-model.test.ts` already document.
 * No mocking needed: this IS the real, always-true-in-this-environment
 * condition the graceful-degradation path exists for.
 */
describe('VisualEvaluator (no execution provider available, as under vitest/Node)', () => {
  const fakeImage = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  const fakeCanvas = {} as CanvasImageSource;

  it('reports measured: false with a reason, never a fabricated pass', async () => {
    const result = await VisualEvaluator.evaluateDetection(fakeCanvas, fakeImage);
    expect(result.measured).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.objectFindingsCount).toBe(0);
    expect(result.faceFindingsCount).toBe(0);
  });

  it('evaluateSummary carries measured:false through to overall.allTestsPassed = null, not true/false', async () => {
    const summary = await VisualEvaluator.evaluateSummary(fakeCanvas, fakeImage);
    expect(summary.measured).toBe(false);
    // null, not false: a category with no data isn't a fail either — it's
    // simply not graded, so it can't silently drag down an aggregate score
    // the way a fabricated `false` would.
    expect(summary.overall.allTestsPassed).toBeNull();
  });
});
