#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

// Copy each HTML entry (built under dist/src/<name>/index.html) to dist root.
for (const name of ['popup', 'sidepanel']) {
  const src = path.join(distDir, 'src', name, 'index.html');
  const target = path.join(distDir, `${name}.html`);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, target);
    console.log(`✓ Copied ${name}.html to dist root`);
  }
}

// Clean up unnecessary directories
const srcDir = path.join(distDir, 'src');
if (fs.existsSync(srcDir)) {
  fs.rmSync(srcDir, { recursive: true, force: true });
  console.log('✓ Cleaned up src directory');
}

// onnxruntime-web resolves its wasm binaries as *siblings* of whichever JS
// glue chunk imported them (see the `.wasm` case in vite.config.ts). Rollup
// only auto-emits an asset when it can statically trace a reference to it;
// it does that for the "./webgpu" entry's `ort-wasm-simd-threaded.jsep.wasm`
// but NOT for the plain "./wasm" (CPU-only) entry's `ort-wasm-simd-threaded
// .wasm`/`.mjs` — those never appear in dist at all, so any machine that
// falls back to the wasm execution provider (no WebGPU, or a WebGPU session
// that fails to create) 404s on every provider and the vision model reports
// "unavailable". Copy the full sibling set explicitly so both providers have
// what they need regardless of what Rollup's static analysis found.
const ortDist = path.join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');
const ortAssets = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
];
const jsDir = path.join(distDir, 'js');
for (const name of ortAssets) {
  const src = path.join(ortDist, name);
  const target = path.join(jsDir, name);
  if (fs.existsSync(src) && !fs.existsSync(target)) {
    fs.copyFileSync(src, target);
    console.log(`✓ Copied onnxruntime-web asset ${name} to dist/js`);
  }
}

console.log('✓ Post-build cleanup complete');
