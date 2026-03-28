// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    root: resolve(__dirname, "src/views/client"),
    build: {
        outDir: resolve(__dirname, "dist/views/public"),
        sourcemap: true,
        emptyOutDir: false,
        rollupOptions: {
            input: {
                pdf: resolve(__dirname, "src/views/client/pdf/index.html"),
            },
            output: {
                entryFileNames: (chunkInfo) => {
                    if (chunkInfo.name === "pdf") {
                        return "pdf/js/index.js";
                    }
                    return "js/[name].js";
                },
                chunkFileNames: (chunkInfo) => {
                    const facadeModuleId = chunkInfo.facadeModuleId || "";
                    if (
                        facadeModuleId.includes("/pdf/") ||
                        chunkInfo.name?.includes("pdf")
                    ) {
                        return "pdf/js/[name]-[hash].js";
                    }
                    return "js/[name]-[hash].js";
                },
                assetFileNames: (assetInfo) => {
                    const name = assetInfo.name || "";
                    if (name.includes("pdf.worker")) {
                        return "pdf/js/[name][extname]";
                    }
                    if (
                        assetInfo.source &&
                        typeof assetInfo.source === "string"
                    ) {
                        if (assetInfo.source.includes("/pdf/")) {
                            return "pdf/assets/[name]-[hash][extname]";
                        }
                    }
                    return "assets/[name]-[hash][extname]";
                },
            },
            external: [],
        },
    },
    logLevel: "error",
    server: {
        hmr: true,
        proxy: {
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
    optimizeDeps: {
        include: ["pdfjs-dist", "pdfjs-dist/web/pdf_viewer.mjs"],
    },
});
