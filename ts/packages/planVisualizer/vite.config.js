// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig } from "vite";
import typescript from "@rollup/plugin-typescript";
import { resolve } from "path";

export default defineConfig({
    root: resolve(__dirname, 'src/view/client'),
    plugins: [
        typescript({
            tsconfig: "./src/client/tsconfig.json",
        }),
    ],
    build: {
        outDir: resolve(__dirname, 'dist/view/public'),
        sourcemap: true,
        rollupOptions: {
            output: {
                entryFileNames: "js/[name].js",
            },
        },
    },
    logLevel: "error",
    server: { 
        hmr: true,
        proxy: {
            // Forward API requests to your Express server
            "/api": {
                target: "http://localhost:9052",
                changeOrigin: true,
            },
        },
        fs: {
            allow: [resolve(__dirname, 'src')]
          }
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
          '@': resolve(__dirname, 'src/view/client'), // Alias relative to the new root
        },
      },
});
