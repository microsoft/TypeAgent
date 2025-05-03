// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const srcDir = resolve(process.cwd(), 'src/extension');

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist/extension',
    emptyOutDir: true,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    rollupOptions: {
      input: {
        'contentScript': resolve(srcDir, 'contentScript/index.ts'),
        'webTypeAgentMain': resolve(srcDir, 'webTypeAgentMain.ts'),
        'webTypeAgentContentScript': resolve(srcDir, 'webTypeAgentContentScript.ts'),
        'options': resolve(srcDir, 'options.ts'),
        'serviceWorker': resolve(srcDir, 'serviceWorker/index.ts'),
        'sidepanel': resolve(srcDir, 'sidepanel.ts'),
        'uiEventsDispatcher': resolve(srcDir, 'uiEventsDispatcher.ts'),
        'sites/paleobiodb': resolve(srcDir, 'sites/paleobiodb.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[ext]',
        // Set global format for all output files
        format: 'esm'
      },
      // Exclude bootstrap and other vendor files to prevent errors
      external: [
        /vendor\/.*/,
        /bootstrap\.min\.css/,
        /bootstrap\.bundle\.min\.js/,
        /prism(\.|-)/
      ]
    }
  },
  
  plugins: [
    // Custom plugin to ensure service worker is properly formatted
    {
      name: 'service-worker-module',
      generateBundle(options, bundle) {
        // Process service worker if it exists in the bundle
        if (bundle['serviceWorker.js']) {
          const sw = bundle['serviceWorker.js'];
          // Ensure it has correct content type and is an ES module
          sw.code = `// Content-Type: text/javascript\n${sw.code}`;
          console.log('Service worker processed with correct Content-Type');
        }
      }
    },
    
    // Copy static files
    viteStaticCopy({
      targets: [
        // Copy manifest first
        {
          src: resolve(srcDir, 'manifest.json'),
          dest: './'
        },
        // Copy source directory files
        {
          src: resolve(srcDir, 'images/**/*'),
          dest: 'images'
        },
        {
          src: resolve(srcDir, 'sidepanel.html'),
          dest: './'
        },
        {
          src: resolve(srcDir, 'options.html'),
          dest: './'
        },
        {
          src: resolve(srcDir, 'sites/paleobiodbSchema.mts'),
          dest: 'sites'
        },
        // Copy vendor files from node_modules
        {
          src: resolve(process.cwd(), 'node_modules/bootstrap/dist/css/bootstrap.min.css'),
          dest: 'vendor/bootstrap'
        },
        {
          src: resolve(process.cwd(), 'node_modules/bootstrap/dist/js/bootstrap.bundle.min.js'),
          dest: 'vendor/bootstrap'
        },
        {
          src: resolve(process.cwd(), 'node_modules/prismjs/prism.js'),
          dest: 'vendor/prism'
        },
        {
          src: resolve(process.cwd(), 'node_modules/prismjs/themes/prism.css'),
          dest: 'vendor/prism'
        },
        {
          src: resolve(process.cwd(), 'node_modules/prismjs/components/prism-typescript.js'),
          dest: 'vendor/prism'
        },
        {
          src: resolve(process.cwd(), 'node_modules/prismjs/components/prism-json.js'),
          dest: 'vendor/prism'
        }
      ],
    }),
    
    // Plugin to modify the manifest to ensure service worker is correctly configured
    {
      name: 'manifest-service-worker',
      writeBundle: {
        sequential: true,
        order: 'post',
        handler() {
          const fs = require('fs');
          const path = require('path');
          const manifestPath = path.resolve(process.cwd(), 'dist/extension/manifest.json');
          
          if (fs.existsSync(manifestPath)) {
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              
              // Ensure service worker has module type
              if (manifest.background && manifest.background.service_worker) {
                manifest.background.type = 'module';
                fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
                console.log('Updated manifest.json: set service_worker type to module');
              }
            } catch (err) {
              console.error('Error updating manifest.json:', err);
            }
          }
        }
      }
    }
  ],
}));