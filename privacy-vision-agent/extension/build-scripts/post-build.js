#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const srcPopupHtml = path.join(distDir, 'src', 'popup', 'index.html');
const targetPopupHtml = path.join(distDir, 'popup.html');

// Copy popup.html to root if it exists
if (fs.existsSync(srcPopupHtml)) {
  fs.copyFileSync(srcPopupHtml, targetPopupHtml);
  console.log('✓ Copied popup.html to dist root');
}

// Clean up unnecessary directories
const srcDir = path.join(distDir, 'src');
if (fs.existsSync(srcDir)) {
  fs.rmSync(srcDir, { recursive: true, force: true });
  console.log('✓ Cleaned up src directory');
}

console.log('✓ Post-build cleanup complete');
