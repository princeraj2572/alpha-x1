/**
 * Local face-detection backend for `FaceDetectionService`'s pluggable
 * `FaceModel` slot — see `face-detector.ts`.
 *
 * Model: YuNet (`face_detection_yunet_2023mar.onnx`), from OpenCV's
 * opencv_zoo (MIT licensed). Fixed 640x640 input, three anchor-free
 * detection heads at strides 8/16/32 (cls/obj/bbox/kps per stride).
 * We only need boxes + a confidence score — landmarks (`kps_*`) are decoded
 * by nobody here and never leave this file.
 *
 * Decode matches OpenCV's own `FaceDetectorYN` C++ implementation
 * (modules/objdetect/src/face_detect.cpp):
 *   - input blob: `blobFromImage` defaults — raw [0,255] float32, BGR,
 *     NCHW, no mean subtraction, no scale factor.
 *   - per stride s, grid cell (r, c): score = sqrt(clamp(cls) * clamp(obj));
 *     cx = (c + bbox[0]) * s, cy = (r + bbox[1]) * s,
 *     w = exp(bbox[2]) * s, h = exp(bbox[3]) * s.
 */

import { FaceModel, DetectedFaceRegion } from './face-detector';
import { loadOrtModule } from './ort-loader';

interface OrtTensor {
  data: Float32Array;
  dims: readonly number[];
}
interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  inputNames: readonly string[];
}
interface OrtModule {
  InferenceSession: {
    create(model: ArrayBuffer, options?: Record<string, unknown>): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor;
  env: { wasm: { simd?: boolean; wasmPaths?: string } };
}

const INPUT_SIZE = 640;
const STRIDES = [8, 16, 32] as const;

export interface YuNetConfig {
  /** URL/path to the .onnx file (extension-origin recommended). */
  modelUrl: string;
  scoreThreshold?: number;
  nmsThreshold?: number;
  wasmPaths?: string;
}

interface Candidate {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

export class YuNetFaceModel implements FaceModel {
  readonly name = 'yunet';

  private session: OrtSession | null = null;
  private ort: OrtModule | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly config: Required<YuNetConfig>;

  constructor(config: YuNetConfig) {
    this.config = {
      scoreThreshold: 0.6,
      nmsThreshold: 0.3,
      wasmPaths: '',
      ...config,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureInit();
      return this.session !== null;
    } catch (err) {
      console.warn('[YuNetFaceModel] unavailable:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  async detect(source: CanvasImageSource): Promise<DetectedFaceRegion[]> {
    await this.ensureInit();
    if (!this.session || !this.ort) {
      return [];
    }

    const { width, height } = sizeOf(source);
    if (!width || !height) {
      return [];
    }

    const canvas = makeCanvas(INPUT_SIZE, INPUT_SIZE);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(source, 0, 0, width, height, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

    const area = INPUT_SIZE * INPUT_SIZE;
    const tensorData = new Float32Array(3 * area);
    for (let i = 0; i < area; i++) {
      // BGR order, raw 0-255 — matches OpenCV's blobFromImage(image) defaults
      // (scalefactor=1, mean=0, swapRB=false).
      tensorData[i] = data[i * 4 + 2]; // B
      tensorData[area + i] = data[i * 4 + 1]; // G
      tensorData[2 * area + i] = data[i * 4 + 0]; // R
    }

    const tensor = new this.ort.Tensor('float32', tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const inputName = this.session.inputNames[0];
    const output = await this.session.run({ [inputName]: tensor });

    const scaleX = width / INPUT_SIZE;
    const scaleY = height / INPUT_SIZE;
    const candidates: Candidate[] = [];

    for (const stride of STRIDES) {
      const cls = output[`cls_${stride}`]?.data;
      const obj = output[`obj_${stride}`]?.data;
      const bbox = output[`bbox_${stride}`]?.data;
      if (!cls || !obj || !bbox) {
        continue;
      }
      const grid = INPUT_SIZE / stride;
      for (let r = 0; r < grid; r++) {
        for (let c = 0; c < grid; c++) {
          const idx = r * grid + c;
          const score = Math.sqrt(clamp01(cls[idx]) * clamp01(obj[idx]));
          if (score < this.config.scoreThreshold) {
            continue;
          }
          const cx = (c + bbox[idx * 4]) * stride;
          const cy = (r + bbox[idx * 4 + 1]) * stride;
          const w = Math.exp(bbox[idx * 4 + 2]) * stride;
          const h = Math.exp(bbox[idx * 4 + 3]) * stride;
          candidates.push({
            x: (cx - w / 2) * scaleX,
            y: (cy - h / 2) * scaleY,
            w: w * scaleX,
            h: h * scaleY,
            score,
          });
        }
      }
    }

    return nms(candidates, this.config.nmsThreshold).map((cand) => ({
      bbox: {
        x: Math.max(0, Math.round(cand.x)),
        y: Math.max(0, Math.round(cand.y)),
        width: Math.round(cand.w),
        height: Math.round(cand.h),
      },
      confidence: round2(cand.score),
    }));
  }

  private async ensureInit(): Promise<void> {
    if (this.session) {
      return;
    }
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const nav = globalThis.navigator as unknown as { gpu?: unknown };
    const preferWebGpu = Boolean(nav && nav.gpu);
    this.ort = (await loadOrtModule(preferWebGpu)) as unknown as OrtModule;
    if (this.config.wasmPaths) {
      this.ort.env.wasm.wasmPaths = this.config.wasmPaths;
    }
    this.ort.env.wasm.simd = true;

    const res = await fetch(this.config.modelUrl);
    if (!res.ok) {
      throw new Error(`YuNetFaceModel: model fetch failed ${res.status} for ${this.config.modelUrl}`);
    }
    const modelBytes = await res.arrayBuffer();

    const providers = preferWebGpu ? ['webgpu', 'wasm'] : ['wasm'];
    for (const ep of providers) {
      try {
        this.session = await this.ort.InferenceSession.create(modelBytes, {
          executionProviders: [ep],
          graphOptimizationLevel: 'all',
        });
        console.log(`[YuNetFaceModel] session ready on "${ep}"`);
        return;
      } catch (err) {
        console.warn(`[YuNetFaceModel] provider "${ep}" unavailable:`, err);
      }
    }
    throw new Error('YuNetFaceModel: could not create a session on any execution provider');
  }
}

// --- helpers ---------------------------------------------------------------

function sizeOf(source: CanvasImageSource): { width: number; height: number } {
  const s = source as unknown as { width?: number; height?: number };
  return { width: s.width ?? 0, height: s.height ?? 0 };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function iou(a: Candidate, b: Candidate): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Single-class greedy NMS (YuNet only detects faces). Exported for tests. */
export function nms(dets: Candidate[], iouThreshold: number): Candidate[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  while (sorted.length) {
    const best = sorted.shift()!;
    kept.push(best);
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (iou(best, sorted[i]) > iouThreshold) {
        sorted.splice(i, 1);
      }
    }
  }
  return kept;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
