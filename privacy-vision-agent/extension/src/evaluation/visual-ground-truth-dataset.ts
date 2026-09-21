/**
 * Labeled ground truth for the visual object/face detectors — the piece
 * DECISION-031's VisualEvaluator follow-up named as still missing: a real
 * precision/recall number needs known object positions, which no synthetic
 * canvas-drawn shape can provide (YOLOv8n and the face model are trained on
 * real photographs; they don't reliably fire on drawn placeholders the way
 * the regex detector fires on a synthetic string).
 *
 * Provenance: 7 images from COCO train2017 (also distributed by Ultralytics
 * as "coco128", specifically for pipeline-testing purposes like this one).
 * The boxes below are COCO's own official annotations (via coco128's
 * YOLO-format labels), filtered to the five COCO classes this system treats
 * as privacy-relevant (`person`, `book`, `laptop`, `cell phone`, `tv` — see
 * `PRIVACY_CLASS_MAP` in `vision-model.ts`) and converted from normalized
 * to pixel coordinates. This file is pure data (filenames + numbers) and
 * contains no image bytes.
 *
 * Deliberately NOT bundled: the actual JPEGs. Two independent reasons, both
 * already established elsewhere in this project:
 *   1. Licensing (DECISION-018's exact reasoning for the .onnx model file):
 *      COCO images are Flickr-sourced and individually licensed by their
 *      photographers — COCO's own redistribution grant covers the
 *      annotations, not the pixels.
 *   2. These specific images are real photographs of real, identifiable
 *      people (COCO's `person` class) — bundling them into a *privacy*
 *      protection tool's committed test fixtures would be the wrong kind of
 *      irony.
 * `npm run fetch:visual-fixtures` downloads them on demand into
 * `public/visual-fixtures/` (gitignored), exactly the same pattern
 * OPERATIONS §8.2 already uses for the model file itself.
 */

import { PrivacyType } from '@/privacy/types';

export interface GroundTruthBox {
  type: PrivacyType.FACE | PrivacyType.DOCUMENT;
  /** Original COCO class name, kept for human context only — not compared against. */
  cocoClass: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualGroundTruthEntry {
  id: string;
  /** Filename `fetch-visual-fixtures.mjs` writes under `public/visual-fixtures/`. */
  filename: string;
  width: number;
  height: number;
  boxes: GroundTruthBox[];
  note?: string;
}

const FACE = PrivacyType.FACE;
const DOCUMENT = PrivacyType.DOCUMENT;

export const VISUAL_GROUND_TRUTH: VisualGroundTruthEntry[] = [
  {
    id: '000000000036',
    filename: '000000000036.jpg',
    width: 481,
    height: 640,
    note: 'single person, simple case',
    boxes: [{ type: FACE, cocoClass: 'person', x: 168, y: 163, width: 311, height: 465 }],
  },
  {
    id: '000000000127',
    filename: '000000000127.jpg',
    width: 640,
    height: 481,
    note: 'one small/distant person + one book',
    boxes: [
      { type: DOCUMENT, cocoClass: 'book', x: 257, y: 194, width: 129, height: 93 },
      { type: FACE, cocoClass: 'person', x: 444, y: 9, width: 23, height: 36 },
    ],
  },
  {
    id: '000000000384',
    filename: '000000000384.jpg',
    width: 446,
    height: 640,
    note: 'coffee table with several small books and a laptop — small/cluttered boxes',
    boxes: [
      { type: DOCUMENT, cocoClass: 'book', x: 155, y: 542, width: 42, height: 18 },
      { type: DOCUMENT, cocoClass: 'book', x: 108, y: 537, width: 41, height: 24 },
      { type: DOCUMENT, cocoClass: 'book', x: 116, y: 522, width: 45, height: 21 },
      { type: DOCUMENT, cocoClass: 'book', x: 160, y: 510, width: 32, height: 17 },
      { type: DOCUMENT, cocoClass: 'laptop', x: 123, y: 469, width: 39, height: 19 },
    ],
  },
  {
    id: '000000000328',
    filename: '000000000328.jpg',
    width: 640,
    height: 491,
    note: 'three people, one holding a cell phone, one book visible',
    boxes: [
      { type: DOCUMENT, cocoClass: 'cell phone', x: 435, y: 283, width: 35, height: 19 },
      { type: FACE, cocoClass: 'person', x: 45, y: 68, width: 224, height: 357 },
      { type: FACE, cocoClass: 'person', x: 198, y: 91, width: 205, height: 389 },
      { type: FACE, cocoClass: 'person', x: 337, y: 58, width: 250, height: 426 },
      { type: DOCUMENT, cocoClass: 'book', x: 246, y: 221, width: 86, height: 37 },
    ],
  },
  {
    id: '000000000595',
    filename: '000000000595.jpg',
    width: 640,
    height: 480,
    note: 'a single tv (discarded in a stream) — no people at all',
    boxes: [{ type: DOCUMENT, cocoClass: 'tv', x: 368, y: 297, width: 141, height: 112 }],
  },
  {
    id: '000000000536',
    filename: '000000000536.jpg',
    width: 448,
    height: 336,
    note: 'three people posing, multiple small cell phones',
    boxes: [
      { type: FACE, cocoClass: 'person', x: 293, y: 134, width: 155, height: 198 },
      { type: FACE, cocoClass: 'person', x: 169, y: 80, width: 108, height: 256 },
      { type: FACE, cocoClass: 'person', x: 88, y: 69, width: 98, height: 264 },
      { type: DOCUMENT, cocoClass: 'cell phone', x: 206, y: 107, width: 14, height: 21 },
      { type: DOCUMENT, cocoClass: 'cell phone', x: 99, y: 88, width: 29, height: 39 },
      { type: DOCUMENT, cocoClass: 'cell phone', x: 361, y: 225, width: 8, height: 12 },
    ],
  },
  {
    id: '000000000009',
    filename: '000000000009.jpg',
    width: 640,
    height: 480,
    note: 'true negative — a food photo (bowl/orange/broccoli), zero privacy-relevant classes',
    boxes: [],
  },
];
