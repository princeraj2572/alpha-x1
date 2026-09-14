import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    minify: 'terser',
    target: 'esnext',
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/popup/index.html'),
        sidepanel: path.resolve(__dirname, 'src/sidepanel/index.html'),
        background: path.resolve(__dirname, 'src/background/index.ts'),
        // content/index.ts is intentionally NOT built here. Chrome loads
        // `content_scripts` as a classic (non-module) script — it cannot
        // contain a top-level `import`. This build shares chunks between
        // popup/sidepanel/background (all real ES modules), which would leak
        // `import` statements into content.js if it were built alongside
        // them. It has its own single-file IIFE build — see
        // vite.content.config.ts and the `build` script in package.json.
      },
      output: {
        entryFileNames: () => {
          return 'js/[name].js';
        },
        chunkFileNames: 'js/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.includes('popup')) {
            return 'popup.html';
          }
          if (assetInfo.name?.includes('sidepanel')) {
            return 'sidepanel.html';
          }
          if (assetInfo.name?.endsWith('.wasm')) {
            // onnxruntime-web's JS glue (built to js/[name].js) resolves this
            // binary relative to its OWN import.meta.url at runtime, i.e. it
            // requests "js/<name>.wasm" as a sibling of itself — not the dist
            // root, which is where the default `[name].[ext]` pattern put it,
            // 404ing (and being outside web_accessible_resources besides) for
            // every execution provider.
            return 'js/[name].[ext]';
          }
          return '[name].[ext]';
        },
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'copy-manifest',
      generateBundle() {
        const manifest = JSON.parse(
          fs.readFileSync(path.resolve(__dirname, 'public/manifest.json'), 'utf-8')
        );
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: JSON.stringify(manifest, null, 2),
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
