// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig } from "vite";
import typescript from "@rollup/plugin-typescript";
import { resolve } from "path";

export default defineConfig({
    root: resolve(__dirname, "src/view/client"),
    plugins: [
        typescript({
            tsconfig: "./src/view/client/tsconfig.json",
        }),
    ],
    build: {
        outDir: resolve(__dirname, "dist/view/public"),
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
            "@": resolve(__dirname, "src/view/client"),
        },
    },
});
