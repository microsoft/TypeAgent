// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { chromeExtension, simpleReloader } from 'vite-plugin-chrome-extension';
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
        'extension/serviceWorker': resolve(srcDir, 'serviceWorker/index.ts'),
        'extension/sidepanel': resolve(srcDir, 'sidepanel.ts'),
        'extension/uiEventsDispatcher': resolve(srcDir, 'uiEventsDispatcher.ts'),
        'electron/uiEventsDispatcher': resolve(srcDir, 'uiEventsDispatcher.ts'),
        'extension/sites/paleobiodb': resolve(srcDir, 'sites/paleobiodb.ts'),
        'electron/sites/paleobiodb': resolve(srcDir, 'sites/paleobiodb.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
       // Customizing the output format per entry point
       plugins: [
        {
          name: 'adjust-output-format',
          generateBundle(options, bundle) {
            // Change format for specific entry points (like content.js)
            if (bundle['extension/contentScript.js']) {
              bundle['extension/contentScript.js'].format = 'iife'; // Set IIFE format for content scripts
            }
            if (bundle['electron/contentScript.js']) {
              bundle['electron/contentScript.js'].format = 'iife'; // Set IIFE format for content scripts
            }
          }
        }
      ],
      target: 'es2022',
    },
    sourcemap: mode === 'development',
  },

  resolve: {
    alias: {
      // Add shims here if needed
    },
  },

  plugins: [
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
