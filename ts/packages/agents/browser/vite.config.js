// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const srcDir = resolve(__dirname, 'src/extension');
const electronSrcDir = resolve(__dirname, 'src/electron');

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        'extension/contentScript': resolve(srcDir, 'contentScript/index.ts'),
        'extension/webTypeAgentMain': resolve(srcDir, 'webTypeAgentMain.ts'),
        'extension/webTypeAgentContentScript': resolve(srcDir, 'webTypeAgentContentScript.ts'),
        'electron/contentScript': resolve(srcDir, 'contentScript/index.ts'),
        'electron/agentActivation': resolve(electronSrcDir, 'agentActivation.ts'),
        'electron/webTypeAgentMain': resolve(srcDir, 'webTypeAgentMain.ts'),
        'extension/options': resolve(srcDir, 'options.ts'),
        // Change this to match exact path expected in manifest.json
        'extension/serviceWorker': resolve(srcDir, 'serviceWorker/index.ts'),
        'extension/sidepanel': resolve(srcDir, 'sidepanel.ts'),
        'extension/uiEventsDispatcher': resolve(srcDir, 'uiEventsDispatcher.ts'),
        'electron/uiEventsDispatcher': resolve(srcDir, 'uiEventsDispatcher.ts'),
        'extension/sites/paleobiodb': resolve(srcDir, 'sites/paleobiodb.ts'),
        'electron/sites/paleobiodb': resolve(srcDir, 'sites/paleobiodb.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        // Make sure format is set to ES for service worker compatibility
        format: 'es'
      },
      // Remove the custom format plugin that's setting IIFE
    },
    sourcemap: mode === 'development',
  },

  resolve: {
    alias: {
      // Add shims here if needed
    },
  },

  plugins: [
    // Add a post-process plugin to add Content-Type header
    {
      name: 'service-worker-content-type',
      writeBundle(options, bundle) {
        // Process service worker specifically
        const swKey = 'extension/serviceWorker.js';
        const sw = bundle[swKey];
        if (sw) {
          // Ensure service worker has correct type
          sw.code = `// Content-Type: text/javascript\n${sw.code}`;
          console.log('Added Content-Type header to service worker');
        } else {
          console.warn('Service worker not found in bundle!');
        }
      }
    },
    viteStaticCopy({
        targets: [
            {
              src: 'src/extension/manifest.json',
              dest: 'extension'
            },
            {
              src: 'src/electron/manifest.json',
              dest: 'electron'
            },
            {
              src: 'src/extension/images/**/*',
              dest: 'extension/images'
            },
            {
              src: 'src/extension/sidepanel.html',
              dest: 'extension'
            },
            {
              src: 'src/extension/options.html',
              dest: 'extension'
            },
            {
              src: 'src/extension/sites/paleobiodbSchema.mts',
              dest: 'extension/sites'
            },
            {
              src: 'node_modules/bootstrap/dist/css/bootstrap.min.css',
              dest: 'extension/vendor/bootstrap'
            },
            {
              src: 'node_modules/bootstrap/dist/js/bootstrap.bundle.min.js',
              dest: 'extension/vendor/bootstrap'
            },
            {
              src: 'node_modules/prismjs/prism.js',
              dest: 'extension/vendor/prism'
            },
            {
              src: 'node_modules/prismjs/themes/prism.css',
              dest: 'extension/vendor/prism'
            },
            {
              src: 'node_modules/prismjs/components/prism-typescript.js',
              dest: 'extension/vendor/prism'
            },
            {
              src: 'node_modules/prismjs/components/prism-json.js',
              dest: 'extension/vendor/prism'
            }
          ],
    }),
  ],
}));