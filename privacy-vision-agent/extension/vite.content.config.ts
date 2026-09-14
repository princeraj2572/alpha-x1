import { defineConfig } from 'vite';
import path from 'path';

/**
 * Separate build for the content script.
 *
 * Chrome loads `content_scripts` entries as CLASSIC (non-module) scripts —
 * there is no `"type": "module"` option for them (unlike the background
 * service worker). A file with a top-level `import`/`export` statement fails
 * to execute at all in that context (SyntaxError, silent in the extension's
 * own logs — it only shows in the target page's console), which means
 * `chrome.runtime.onMessage` never registers and every message to that tab
 * fails with "Could not establish connection" regardless of reloading.
 *
 * Building content/index.ts here, alone, with `format: 'iife'` and
 * `inlineDynamicImports: true` guarantees a single self-contained file with
 * no import/export syntax, no matter what the main build (popup/sidepanel/
 * background, real ES modules that legitimately share chunks) does.
 *
 * `onnxruntime-web` is marked external: the content script's privacy pipeline
 * always runs with `enableVision: false` (vision needs a screenshot, which
 * only the Side Panel has), so the code path that would dynamically import it
 * is dead here — externalizing avoids pulling ~350 KB of unused runtime into
 * every page's content script.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    minify: 'terser',
    target: 'esnext',
    emptyOutDir: false, // don't wipe what the main `vite build` just produced
    rollupOptions: {
      input: {
        content: path.resolve(__dirname, 'src/content/index.ts'),
      },
      external: [/^onnxruntime-web/],
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'js/[name].js',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
