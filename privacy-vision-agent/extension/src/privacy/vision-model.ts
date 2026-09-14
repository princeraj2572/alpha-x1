/**
 * Local visual object detection via ONNX Runtime Web.
 *
 * Role in the privacy pipeline: detect visual regions that the DOM and regex
 * layers cannot represent — a person in a photo, an ID-card-shaped document,
 * a signature block — so the redactor can blur/blackout them.
 *
 * This is NOT the reasoning model and it is NOT a browser-UI detector. Stock
 * YOLO11n is trained on COCO; it knows `person`, `laptop`, `book`, `cell
 * phone`, etc. We only surface classes that carry a privacy meaning, and we
 * label every finding with the model + class so nothing is over-claimed.
 *
 * Execution:
 *   - WebGPU execution provider when `navigator.gpu` is present and a session
 *     can be created on it.
 *   - WASM (CPU, SIMD+threads where available) fallback otherwise.
 *   - The actual provider in use is reported via `getExecutionProvider()`.
 *
 * The model file is NOT bundled. Point `init()` at a local `model.onnx`
 * (packaged as a web-accessible resource or fetched from the extension origin).
 * Everything runs on-device; there is no inference API call.
 */

import {
  PrivacyFinding,
  PrivacyType,
  DetectionSource,
  BoundingBox,
} from './types';
import { ImageLike } from './redactor';
import { loadOrtModule } from './ort-loader';

/** Minimal structural types so this file type-checks without ORT loaded. */
interface OrtTensor {
  data: Float32Array | Uint8Array | number[];
  dims: readonly number[];
}
interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  inputNames: readonly string[];
  outputNames: readonly string[];
}
interface OrtModule {
  InferenceSession: {
    create(
      model: ArrayBuffer | Uint8Array | string,
      options?: Record<string, unknown>
    ): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor;
  env: { wasm: { numThreads?: number; simd?: boolean; wasmPaths?: string } };
}

export type ExecutionProvider = 'webgpu' | 'wasm' | 'none';

export interface VisionDetection {
  classId: number;
  className: string;
  score: number;
  bbox: BoundingBox;
}

export interface VisionModelConfig {
  /** URL/path to the .onnx file (extension-origin recommended). */
  modelUrl: string;
  /** Square input size the model expects. YOLO11n default is 640. */
  inputSize?: number;
  /** Score threshold for keeping a detection. */
  scoreThreshold?: number;
  /** IoU threshold for non-max suppression. */
  iouThreshold?: number;
  /** Optional override for wasm asset location. */
  wasmPaths?: string;
  /** COCO-style class names indexed by class id. */
  classNames?: string[];
}

/**
 * Which detected classes are privacy-relevant and how to treat them.
 * Anything not listed here is detected but not emitted as a finding.
 */
const PRIVACY_CLASS_MAP: Record<string, { type: PrivacyType; strategy: 'blur' | 'blackout'; confidenceScale: number }> = {
  person: { type: PrivacyType.FACE, strategy: 'blur', confidenceScale: 0.7 },
  book: { type: PrivacyType.DOCUMENT, strategy: 'blackout', confidenceScale: 0.5 },
  'cell phone': { type: PrivacyType.DOCUMENT, strategy: 'blackout', confidenceScale: 0.4 },
  laptop: { type: PrivacyType.DOCUMENT, strategy: 'blackout', confidenceScale: 0.3 },
};

const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
  'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator',
  'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush',
];

export class VisionModel {
  private ort: OrtModule | null = null;
  private session: OrtSession | null = null;
  private provider: ExecutionProvider = 'none';
  private config: Required<VisionModelConfig> | null = null;
  private runs = 0;
  private totalMs = 0;

  /**
   * Load ORT + the model. Safe to call once; subsequent calls are no-ops.
   * Throws only if a model URL is given and cannot be loaded on ANY provider.
   */
  async init(config: VisionModelConfig): Promise<void> {
    if (this.session) {
      return;
    }
    this.config = {
      inputSize: 640,
      scoreThreshold: 0.35,
      iouThreshold: 0.45,
      wasmPaths: '',
      classNames: COCO_CLASSES,
      ...config,
    };

    this.ort = await this.loadOrt();
    if (this.config.wasmPaths) {
      this.ort.env.wasm.wasmPaths = this.config.wasmPaths;
    }
    this.ort.env.wasm.simd = true;

    const modelBytes = await this.fetchModel(this.config.modelUrl);

    // Try WebGPU first, then WASM.
    for (const ep of this.candidateProviders()) {
      try {
        this.session = await this.ort.InferenceSession.create(modelBytes, {
          executionProviders: [ep],
          graphOptimizationLevel: 'all',
        });
        this.provider = ep;
        console.log(`[VisionModel] session ready on "${ep}"`);
        return;
      } catch (err) {
        console.warn(`[VisionModel] provider "${ep}" unavailable:`, err);
      }
    }
    throw new Error('VisionModel: could not create a session on any execution provider');
  }

  isReady(): boolean {
    return this.session !== null;
  }

  getExecutionProvider(): ExecutionProvider {
    return this.provider;
  }

  /**
   * Run detection on an already-prepared Float32 CHW tensor in [0,1].
   * Most callers should use `detectFromImageData` instead.
   */
  async detect(input: Float32Array, width: number, height: number): Promise<VisionDetection[]> {
    if (!this.session || !this.ort || !this.config) {
      throw new Error('VisionModel not initialized');
    }
    const started = now();
    const size = this.config.inputSize;
    const tensor = new this.ort.Tensor('float32', input, [1, 3, size, size]);
    const feeds: Record<string, OrtTensor> = { [this.session.inputNames[0]]: tensor };
    const output = await this.session.run(feeds);
    const raw = output[this.session.outputNames[0]];
    const dets = this.postprocess(raw, width, height);
    this.runs++;
    this.totalMs += now() - started;
    return dets;
  }

  /**
   * Full path: ImageData -> letterboxed CHW tensor -> inference -> NMS ->
   * privacy findings (only for privacy-relevant classes).
   */
  async detectFindings(image: ImageLike): Promise<PrivacyFinding[]> {
    if (!this.config) {
      return [];
    }
    const { tensor } = this.preprocess(image, this.config.inputSize);
    const detections = await this.detect(tensor, image.width, image.height);
    const findings: PrivacyFinding[] = [];
    for (const d of detections) {
      const rule = PRIVACY_CLASS_MAP[d.className];
      if (!rule) {
        continue;
      }
      findings.push({
        type: rule.type,
        source: DetectionSource.VISION_MODEL,
        confidence: round2(d.score * rule.confidenceScale),
        bbox: d.bbox,
        strategy: rule.strategy,
        detail: `vision:yolo11n class="${d.className}" (generic COCO)`,
      });
    }
    return findings;
  }

  getStats(): { runs: number; avgMs: number; provider: ExecutionProvider } {
    return {
      runs: this.runs,
      avgMs: this.runs ? round2(this.totalMs / this.runs) : 0,
      provider: this.provider,
    };
  }

  // --- internals -----------------------------------------------------------

  private candidateProviders(): ExecutionProvider[] {
    const list: ExecutionProvider[] = [];
    const nav = globalThis.navigator as unknown as { gpu?: unknown };
    if (nav && nav.gpu) {
      list.push('webgpu');
    }
    list.push('wasm');
    return list;
  }

  private async loadOrt(): Promise<OrtModule> {
    const nav = globalThis.navigator as unknown as { gpu?: unknown };
    const mod = await loadOrtModule(Boolean(nav && nav.gpu));
    return mod as unknown as OrtModule;
  }

  private async fetchModel(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`VisionModel: model fetch failed ${res.status} for ${url}`);
    }
    return res.arrayBuffer();
  }

  /**
   * Letterbox `image` to a square `size` canvas and produce a normalized
   * CHW Float32Array. Returns the scale/pad so boxes can be mapped back.
   */
  preprocess(image: ImageLike, size: number): { tensor: Float32Array; scale: number; padX: number; padY: number } {
    const scale = Math.min(size / image.width, size / image.height);
    const newW = Math.round(image.width * scale);
    const newH = Math.round(image.height * scale);
    const padX = Math.floor((size - newW) / 2);
    const padY = Math.floor((size - newH) / 2);

    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#727272';
    ctx.fillRect(0, 0, size, size);
    const src = makeCanvas(image.width, image.height);
    (src.getContext('2d') as CanvasRenderingContext2D).putImageData(image as unknown as ImageData, 0, 0);
    ctx.drawImage(src as unknown as CanvasImageSource, 0, 0, image.width, image.height, padX, padY, newW, newH);

    const { data } = ctx.getImageData(0, 0, size, size);
    const tensor = new Float32Array(3 * size * size);
    const area = size * size;
    for (let i = 0; i < area; i++) {
      tensor[i] = data[i * 4] / 255; // R
      tensor[area + i] = data[i * 4 + 1] / 255; // G
      tensor[2 * area + i] = data[i * 4 + 2] / 255; // B
    }
    return { tensor, scale, padX, padY };
  }

  /**
   * Decode a YOLO11 output tensor `[1, 4+nc, n]` and run class-wise NMS.
   */
  private postprocess(raw: OrtTensor, origW: number, origH: number): VisionDetection[] {
    if (!this.config) {
      return [];
    }
    const size = this.config.inputSize;
    const scale = Math.min(size / origW, size / origH);
    const padX = Math.floor((size - Math.round(origW * scale)) / 2);
    const padY = Math.floor((size - Math.round(origH * scale)) / 2);

    const dims = raw.dims;
    const data = raw.data as Float32Array;
    // Expect [1, 4+nc, n]
    const channels = dims[1];
    const anchors = dims[2];
    const numClasses = channels - 4;
    const names = this.config.classNames;

    const boxes: VisionDetection[] = [];
    for (let a = 0; a < anchors; a++) {
      let bestScore = 0;
      let bestClass = -1;
      for (let c = 0; c < numClasses; c++) {
        const score = data[(4 + c) * anchors + a];
        if (score > bestScore) {
          bestScore = score;
          bestClass = c;
        }
      }
      if (bestScore < this.config.scoreThreshold) {
        continue;
      }
      const cx = data[0 * anchors + a];
      const cy = data[1 * anchors + a];
      const w = data[2 * anchors + a];
      const h = data[3 * anchors + a];
      // Map from letterboxed space back to original pixels.
      const x = (cx - w / 2 - padX) / scale;
      const y = (cy - h / 2 - padY) / scale;
      boxes.push({
        classId: bestClass,
        className: names[bestClass] ?? `class_${bestClass}`,
        score: bestScore,
        bbox: {
          x: Math.max(0, Math.round(x)),
          y: Math.max(0, Math.round(y)),
          width: Math.round(w / scale),
          height: Math.round(h / scale),
        },
      });
    }
    return nms(boxes, this.config.iouThreshold);
  }
}

// --- shared helpers -------------------------------------------------------

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function iou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Class-wise non-max suppression. Exported for tests. */
export function nms(dets: VisionDetection[], iouThreshold: number): VisionDetection[] {
  const byClass = new Map<number, VisionDetection[]>();
  for (const d of dets) {
    const arr = byClass.get(d.classId) ?? [];
    arr.push(d);
    byClass.set(d.classId, arr);
  }
  const kept: VisionDetection[] = [];
  for (const arr of byClass.values()) {
    arr.sort((x, y) => y.score - x.score);
    while (arr.length) {
      const best = arr.shift()!;
      kept.push(best);
      for (let i = arr.length - 1; i >= 0; i--) {
        if (iou(best.bbox, arr[i].bbox) > iouThreshold) {
          arr.splice(i, 1);
        }
      }
    }
  }
  return kept;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const visionModel = new VisionModel();
