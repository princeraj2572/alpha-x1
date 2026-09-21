#!/usr/bin/env node

/**
 * Downloads the real images backing visual-ground-truth-dataset.ts into a
 * gitignored local folder. Not run automatically by `npm run build` — this
 * is dev/eval tooling, not something every install needs (mirrors the
 * .onnx model's own on-demand fetch in OPERATIONS.md §8.2).
 *
 * The dataset file commits only filenames + annotation numbers (pure data);
 * the actual JPEGs are real COCO/Flickr photographs of real people and are
 * fetched here instead of bundled — see visual-ground-truth-dataset.ts's own
 * doc comment for why.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public', 'visual-fixtures');
const datasetPath = path.join(__dirname, '..', 'src', 'evaluation', 'visual-ground-truth-dataset.ts');

// Extracting filenames with a regex instead of importing the .ts module
// directly — this script runs under plain `node` (no TS loader configured
// for build-scripts/, see post-build.js), and duplicating the filename list
// by hand here would drift from the dataset file it's meant to match.
const source = fs.readFileSync(datasetPath, 'utf8');
const filenames = [...source.matchAll(/filename:\s*'([^']+)'/g)].map((m) => m[1]);
if (filenames.length === 0) {
  throw new Error(`No filenames found in ${datasetPath} — did its format change?`);
}

fs.mkdirSync(outDir, { recursive: true });

let downloaded = 0;
let skipped = 0;

for (const filename of filenames) {
  const dest = path.join(outDir, filename);
  if (fs.existsSync(dest)) {
    skipped++;
    continue;
  }
  const url = `https://images.cocodataset.org/train2017/${filename}`;
  process.stdout.write(`Fetching ${filename} ... `);
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`FAILED (${res.status})`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  downloaded++;
  console.log(`ok (${buf.length} bytes)`);
}

console.log(`\nDone: ${downloaded} downloaded, ${skipped} already present, ${outDir}`);
console.log(
  'These are real COCO/Flickr photographs (some of real people) for local visual-accuracy evaluation only — do not redistribute.'
);
