// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
    logLevel: "warn",
    root: "src/view/site",
    build: {
        outDir: "../../../dist/view/site",
        emptyOutDir: true,
        reportCompressedSize: false,
        chunkSizeWarningLimit: 2500,
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, "src/view/site/index.html"),
            },
        },
    },
    server: {
        port: parseInt(process.env.VITE_FRONTEND_PORT) || 5173,
        host: true,
        proxy: {
            // Proxy API requests to the backend during development
            // Backend port can be overridden via VITE_BACKEND_PORT env var
            "/document": {
                target: `http://localhost:${process.env.VITE_BACKEND_PORT || 3000}`,
                changeOrigin: true,
            },
            "/preview": {
                target: `http://localhost:${process.env.VITE_BACKEND_PORT || 3000}`,
                changeOrigin: true,
            },
            "/events": {
                target: `http://localhost:${process.env.VITE_BACKEND_PORT || 3000}`,
                changeOrigin: true,
            },
            "/agent": {
                target: `http://localhost:${process.env.VITE_BACKEND_PORT || 3000}`,
                changeOrigin: true,
            },
        },
    },
    css: {
        modules: false,
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src/view/site"),
        },
    },

    optimizeDeps: {
        include: [
            "@milkdown/core",
            "@milkdown/crepe",
            "@milkdown/preset-commonmark",
            "@milkdown/preset-gfm",
            "@milkdown/plugin-history",
            "@milkdown/plugin-math",
            "@milkdown/theme-nord",
            "@milkdown/utils",
        ],
    },
});
