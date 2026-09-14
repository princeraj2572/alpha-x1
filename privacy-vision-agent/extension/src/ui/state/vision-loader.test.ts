import { describe, it, expect, beforeEach, vi } from 'vitest';

// See vision-model.test.ts for why the whole ort-loader module is mocked
// rather than letting vitest's Node runner try to resolve it.
vi.mock('@/privacy/ort-loader', () => ({
  loadOrtModule: vi.fn(async () => {
    throw new Error('onnxruntime-web is browser-only; not available under vitest/Node');
  }),
}));

import { getVisionModel, resetVisionLoader } from './vision-loader';

beforeEach(() => resetVisionLoader());

describe('getVisionModel', () => {
  it('resolves to null (never throws) when no execution provider is available', async () => {
    const model = await getVisionModel();
    expect(model).toBeNull();
  });

  it('caches the init attempt — only initializes once per session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await getVisionModel();
    await getVisionModel();
    // one warning per real init attempt, not one per call
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('[VisionLoader]')).length).toBe(1);
    warn.mockRestore();
  });

  it('resetVisionLoader forces a fresh attempt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await getVisionModel();
    resetVisionLoader();
    await getVisionModel();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('[VisionLoader]')).length).toBe(2);
    warn.mockRestore();
  });
});
