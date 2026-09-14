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

console.log('✓ Post-build cleanup complete');
