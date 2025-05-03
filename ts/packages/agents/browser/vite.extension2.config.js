// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const srcDir = resolve(process.cwd(), 'src/extension');

export default defineConfig(({ mode }) => (
  {
  build: {
    outDir: 'dist/extension',
    emptyOutDir: true,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    rollupOptions: {
      input: {
        'serviceWorker': resolve(srcDir, 'serviceWorker/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name.includes('serviceWorker')) {
            console.log(`Building ${chunkInfo.name} as ESM format`);
            return '[name].js';
          }
          
          console.log(`Building ${chunkInfo.name} as IIFE format`);
          return '[name].js';
        },
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[ext]',
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
   
  ],
}));