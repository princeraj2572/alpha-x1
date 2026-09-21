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

import { VisualEvaluator, matchBoxes } from './visual-evaluator';
import { PrivacyType } from '@/privacy/types';
import { VISUAL_GROUND_TRUTH } from './visual-ground-truth-dataset';

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

  it('evaluateGroundTruth reports measured: false (no fixtures can run without a provider)', async () => {
    const fixtures = VISUAL_GROUND_TRUTH.slice(0, 2).map((entry) => ({
      entry,
      canvas: fakeCanvas,
      image: fakeImage,
    }));
    const report = await VisualEvaluator.evaluateGroundTruth(fixtures);
    expect(report.measured).toBe(false);
    expect(report.precision).toBeNull();
    expect(report.recall).toBeNull();
    expect(report.perFixture).toHaveLength(2);
    expect(report.perFixture.every((r) => !r.measured)).toBe(true);
  });
});

describe('matchBoxes (pure IoU matching — no detector involved, real correctness surface)', () => {
  const face = (x: number, y: number, w: number, h: number, confidence?: number) => ({
    type: PrivacyType.FACE as const,
    x,
    y,
    width: w,
    height: h,
    confidence,
  });
  const doc = (x: number, y: number, w: number, h: number) => ({
    type: PrivacyType.DOCUMENT as const,
    x,
    y,
    width: w,
    height: h,
  });

  it('counts an exact-overlap prediction as one true positive, nothing else', () => {
    const stats = matchBoxes([face(10, 10, 100, 100)], [face(10, 10, 100, 100)], 0.5);
    expect(stats).toEqual({ truePositives: 1, falsePositives: 0, falseNegatives: 0 });
  });

  it('counts a prediction with no nearby ground truth as a false positive', () => {
    const stats = matchBoxes([face(0, 0, 10, 10)], [face(500, 500, 10, 10)], 0.5);
    expect(stats).toEqual({ truePositives: 0, falsePositives: 1, falseNegatives: 1 });
  });

  it('counts an undetected ground truth box as a false negative', () => {
    const stats = matchBoxes([], [face(10, 10, 100, 100)], 0.5);
    expect(stats).toEqual({ truePositives: 0, falsePositives: 0, falseNegatives: 1 });
  });

  it('never matches boxes of different types even at perfect overlap', () => {
    const stats = matchBoxes([doc(10, 10, 100, 100)], [face(10, 10, 100, 100)], 0.5);
    expect(stats).toEqual({ truePositives: 0, falsePositives: 1, falseNegatives: 1 });
  });

  it('rejects a match below the IoU threshold', () => {
    // Same top-left, half the size on each axis -> IoU well under 0.5.
    const stats = matchBoxes([face(10, 10, 50, 50)], [face(10, 10, 100, 100)], 0.5);
    expect(stats).toEqual({ truePositives: 0, falsePositives: 1, falseNegatives: 1 });
  });

  it('prefers higher-confidence predictions when two predictions could match the same box', () => {
    const gt = [face(10, 10, 100, 100)];
    const predicted = [face(200, 200, 100, 100, 0.9), face(10, 10, 100, 100, 0.4)];
    // The high-confidence prediction is checked first but doesn't overlap
    // anything, so it becomes a false positive; the second still matches.
    const stats = matchBoxes(predicted, gt, 0.5);
    expect(stats).toEqual({ truePositives: 1, falsePositives: 1, falseNegatives: 0 });
  });

  it('does not double-count one ground truth box against two overlapping predictions', () => {
    const gt = [face(10, 10, 100, 100)];
    const predicted = [face(10, 10, 100, 100, 0.9), face(12, 12, 100, 100, 0.8)];
    const stats = matchBoxes(predicted, gt, 0.5);
    expect(stats.truePositives).toBe(1);
    expect(stats.falsePositives).toBe(1);
    expect(stats.falseNegatives).toBe(0);
  });

  it('matches every hand-verified ground truth fixture against itself perfectly (sanity check on the dataset shape)', () => {
    for (const entry of VISUAL_GROUND_TRUTH) {
      const boxes = entry.boxes.map((b) => ({ type: b.type, x: b.x, y: b.y, width: b.width, height: b.height }));
      const stats = matchBoxes(boxes, boxes, 0.99);
      expect(stats).toEqual({ truePositives: boxes.length, falsePositives: 0, falseNegatives: 0 });
    }
  });
});
