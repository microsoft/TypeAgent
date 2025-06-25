// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    root: resolve(__dirname, "src/views/client/plans"),
    build: {
        outDir: resolve(__dirname, "dist/views/public"),
        sourcemap: true,
        emptyOutDir: false,
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
            // Forward API requests to Express server
            "/api": {
                target: "http://localhost:9052",
                changeOrigin: true,
            },
        },
        fs: {
            allow: [resolve(__dirname, "src")],
        },
    },
    resolve: {
        extensions: [".ts", ".js"],
        alias: {
            "@": resolve(__dirname, "src/views/client"),
        },
    },
});
