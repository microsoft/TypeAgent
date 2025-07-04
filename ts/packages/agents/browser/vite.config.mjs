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
                // Plans app
                plans: resolve(__dirname, "src/views/client/plans/index.html"),
                // PDF app
                pdf: resolve(__dirname, "src/views/client/pdf/index.html"),
            },
            output: {
                entryFileNames: (chunkInfo) => {
                    // Route JS files to appropriate subdirectories
                    if (chunkInfo.name === "plans") {
                        return "plans/js/index.js";
                    } else if (chunkInfo.name === "pdf") {
                        return "pdf/js/index.js";
                    }
                    return "js/[name].js";
                },
                chunkFileNames: (chunkInfo) => {
                    // Determine which app this chunk belongs to based on facadeModuleId
                    const facadeModuleId = chunkInfo.facadeModuleId || "";
                    if (
                        facadeModuleId.includes("/plans/") ||
                        chunkInfo.name?.includes("plans")
                    ) {
                        return "plans/js/[name]-[hash].js";
                    } else if (
                        facadeModuleId.includes("/pdf/") ||
                        chunkInfo.name?.includes("pdf")
                    ) {
                        return "pdf/js/[name]-[hash].js";
                    }
                    return "js/[name]-[hash].js";
                },
                assetFileNames: (assetInfo) => {
                    const name = assetInfo.name || "";
                    // Handle PDF.js worker files specifically
                    if (name.includes("pdf.worker")) {
                        return "pdf/js/[name][extname]";
                    }
                    // Route other assets based on source
                    if (
                        assetInfo.source &&
                        typeof assetInfo.source === "string"
                    ) {
                        if (assetInfo.source.includes("/plans/")) {
                            return "plans/assets/[name]-[hash][extname]";
                        } else if (assetInfo.source.includes("/pdf/")) {
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
    optimizeDeps: {
        include: ["pdfjs-dist", "pdfjs-dist/web/pdf_viewer.mjs"],
    },
});
