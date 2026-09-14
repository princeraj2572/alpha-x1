import { describe, it, expect, afterEach } from 'vitest';
import { FaceDetectionService, FaceModel } from './face-detector';
import { PrivacyType, DetectionSource } from './types';

const g = globalThis as unknown as { FaceDetector?: unknown };

afterEach(() => {
  delete g.FaceDetector;
});

describe('FaceDetectionService — capability probing', () => {
  it('reports unsupported when no backend exists', async () => {
    const service = new FaceDetectionService();
    expect(await service.isSupported()).toBe(false);
    expect(await service.activeBackend()).toBe('none');
    expect(await service.detect({} as CanvasImageSource)).toEqual([]);
  });

  it('uses the platform Shape Detection API when present', async () => {
    g.FaceDetector = class {
      async detect() {
        return [{ boundingBox: { x: 10, y: 20, width: 30, height: 40 } as DOMRectReadOnly }];
      }
    };
    const service = new FaceDetectionService();
    expect(await service.isSupported()).toBe(true);
    expect(await service.activeBackend()).toBe('shape-detection-api');
    const regions = await service.detect({} as CanvasImageSource);
    expect(regions).toHaveLength(1);
    expect(regions[0].bbox).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('falls back to a registered local model', async () => {
    const model: FaceModel = {
      name: 'blazeface-mock',
      isAvailable: async () => true,
      detect: async () => [{ bbox: { x: 1, y: 1, width: 5, height: 5 }, confidence: 0.77 }],
    };
    const service = new FaceDetectionService();
    service.setModel(model);
    expect(await service.activeBackend()).toBe('model:blazeface-mock');
    const regions = await service.detect({} as CanvasImageSource);
    expect(regions[0].confidence).toBe(0.77);
  });
});

describe('FaceDetectionService — findings', () => {
  it('emits FACE findings with a blur strategy and NO identity data', async () => {
    g.FaceDetector = class {
      async detect() {
        return [{ boundingBox: { x: 0, y: 0, width: 50, height: 50 } as DOMRectReadOnly }];
      }
    };
    const service = new FaceDetectionService();
    const findings = await service.detectFindings({} as CanvasImageSource);
    expect(findings[0].type).toBe(PrivacyType.FACE);
    expect(findings[0].source).toBe(DetectionSource.FACE_MODEL);
    expect(findings[0].strategy).toBe('blur');

    // The finding carries geometry + confidence only — no identity fields,
    // no descriptor/embedding arrays, no person label.
    const keys = Object.keys(findings[0]);
    expect(keys).toEqual(expect.arrayContaining(['type', 'source', 'confidence', 'bbox', 'strategy']));
    expect(keys).not.toEqual(expect.arrayContaining(['embedding', 'descriptor', 'personId', 'name', 'identity']));
    expect(findings[0].rawValue).toBeUndefined();
  });
});
