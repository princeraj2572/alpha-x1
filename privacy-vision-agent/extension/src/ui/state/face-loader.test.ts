import { describe, it, expect, beforeEach, vi } from 'vitest';

// See vision-model.test.ts for why the whole ort-loader module is mocked
// rather than letting vitest's Node runner try to resolve it.
vi.mock('@/privacy/ort-loader', () => ({
  loadOrtModule: vi.fn(async () => {
    throw new Error('onnxruntime-web is browser-only; not available under vitest/Node');
  }),
}));

import { faceDetectionService } from '@/privacy/face-detector';
import { ensureLocalFaceModel, getFaceModelError, resetFaceLoader } from './face-loader';

beforeEach(() => resetFaceLoader());

describe('ensureLocalFaceModel', () => {
  it('registers a model and resolves false when no execution provider is available', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = await ensureLocalFaceModel();
    expect(ok).toBe(false);
    expect(await faceDetectionService.activeBackend()).toBe('none');
    expect(getFaceModelError()).toBeTruthy();
    warn.mockRestore();
  });

  it('caches the init attempt — only registers once per session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await ensureLocalFaceModel();
    await ensureLocalFaceModel();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('[FaceLoader]')).length).toBe(1);
    warn.mockRestore();
  });
});
