/**
 * Face DETECTION (not recognition).
 *
 * Job: answer "is there a human face, and where is its bounding box" so the
 * redaction engine can blur it. That is the entire contract.
 *
 * Explicitly NOT done here:
 *   - identifying who the person is
 *   - biometric matching / comparison
 *   - computing or storing facial embeddings
 *   - attaching names or labels to faces
 *
 * Backend:
 *   1. `FaceDetector` (Shape Detection API) when the browser exposes it.
 *      Chrome ships it behind "Experimental Web Platform features". It runs
 *      on-device.
 *   2. A pluggable `FaceModel` slot for a lightweight local model (e.g. a
 *      BlazeFace ONNX graph) when the platform API is unavailable.
 *   3. If neither is present, `detect()` returns `[]` and `isSupported()` is
 *      false — callers decide whether the absence of face detection is
 *      acceptable for their risk level (fail-closed is applied one layer up).
 */

import {
  PrivacyFinding,
  PrivacyType,
  DetectionSource,
  DEFAULT_STRATEGY,
  BoundingBox,
} from './types';

export interface DetectedFaceRegion {
  bbox: BoundingBox;
  confidence: number;
}

/**
 * Optional local model backend. An implementation must not expose identity or
 * embeddings — only boxes + a detection score.
 */
export interface FaceModel {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  detect(source: CanvasImageSource): Promise<DetectedFaceRegion[]>;
}

type FaceDetectorCtor = new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
  detect(image: CanvasImageSource): Promise<
    Array<{ boundingBox: DOMRectReadOnly }>
  >;
};

export class FaceDetectionService {
  private model: FaceModel | null = null;
  private runs = 0;
  private totalMs = 0;

  /** Register a local ONNX/TF face-detection model as a fallback backend. */
  setModel(model: FaceModel): void {
    this.model = model;
  }

  /**
   * True if *some* detection backend is usable right now.
   */
  async isSupported(): Promise<boolean> {
    if (this.platformDetector()) {
      return true;
    }
    if (this.model) {
      return this.model.isAvailable();
    }
    return false;
  }

  /**
   * Name of the backend that would be used. Useful for the benchmark report
   * and for honest UI ("face detection: unavailable").
   */
  async activeBackend(): Promise<string> {
    if (this.platformDetector()) {
      return 'shape-detection-api';
    }
    if (this.model && (await this.model.isAvailable())) {
      return `model:${this.model.name}`;
    }
    return 'none';
  }

  /**
   * Detect faces in an image source. Returns bounding boxes only.
   */
  async detect(source: CanvasImageSource): Promise<DetectedFaceRegion[]> {
    const started = now();
    let regions: DetectedFaceRegion[] = [];

    const Ctor = this.platformDetector();
    if (Ctor) {
      try {
        const detector = new Ctor({ fastMode: true, maxDetectedFaces: 20 });
        const raw = await detector.detect(source);
        regions = raw.map((r) => ({
          bbox: {
            x: Math.round(r.boundingBox.x),
            y: Math.round(r.boundingBox.y),
            width: Math.round(r.boundingBox.width),
            height: Math.round(r.boundingBox.height),
          },
          // The Shape Detection API does not surface a score; treat a
          // returned box as a confident detection.
          confidence: 0.9,
        }));
      } catch (err) {
        console.warn('[FaceDetection] platform detector failed, falling back:', err);
        regions = [];
      }
    }

    if (regions.length === 0 && this.model && (await this.model.isAvailable())) {
      regions = await this.model.detect(source);
    }

    this.runs++;
    this.totalMs += now() - started;
    return regions;
  }

  /**
   * Detect faces and return them as `PrivacyFinding`s ready for the fusion
   * engine. Strategy is `blur` — we never blackout a face, blur is enough to
   * de-identify while keeping the page understandable.
   */
  async detectFindings(source: CanvasImageSource): Promise<PrivacyFinding[]> {
    const regions = await this.detect(source);
    return regions.map((region) => ({
      type: PrivacyType.FACE,
      source: DetectionSource.FACE_MODEL,
      confidence: region.confidence,
      bbox: region.bbox,
      strategy: DEFAULT_STRATEGY[PrivacyType.FACE],
      detail: 'face-detection (no identity)',
    }));
  }

  getStats(): { runs: number; avgMs: number } {
    return { runs: this.runs, avgMs: this.runs ? round2(this.totalMs / this.runs) : 0 };
  }

  /** Resolve the platform `FaceDetector` constructor if present. */
  private platformDetector(): FaceDetectorCtor | null {
    const g = globalThis as unknown as { FaceDetector?: FaceDetectorCtor };
    return typeof g.FaceDetector === 'function' ? g.FaceDetector : null;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const faceDetectionService = new FaceDetectionService();
