import { defineConfig } from 'vite';
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
        background: path.resolve(__dirname, 'src/background/index.ts'),
        content: path.resolve(__dirname, 'src/content/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return 'js/[name].js';
        },
        chunkFileNames: 'js/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.includes('popup')) {
            return 'popup.html';
          }
          return '[name].[ext]';
        },
      },
    },
  },
  plugins: [
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
