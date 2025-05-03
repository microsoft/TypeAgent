// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const srcDir = resolve(__dirname, 'src/extension');
const electronSrcDir = resolve(__dirname, 'src/electron');

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist/electron',
    emptyOutDir: true,
    sourcemap: mode === 'development',
    rollupOptions: {
      input: {
        'contentScript': resolve(srcDir, 'contentScript/index.ts'),
        'agentActivation': resolve(electronSrcDir, 'agentActivation.ts'),
        'webTypeAgentMain': resolve(srcDir, 'webTypeAgentMain.ts'),
        'uiEventsDispatcher': resolve(srcDir, 'uiEventsDispatcher.ts'),
        'sites/paleobiodb': resolve(srcDir, 'sites/paleobiodb.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      }
    },
  },

  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'src/electron/manifest.json',
          dest: './'
        },
        {
          src: 'src/extension/sites/paleobiodbSchema.mts',
          dest: 'sites'
        },
      ],
    }),
  ],
}));