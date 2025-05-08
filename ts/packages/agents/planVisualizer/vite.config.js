// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig } from "vite";
import typescript from "@rollup/plugin-typescript";
import { resolve } from "path";

export default defineConfig({
    plugins: [
        typescript({
            tsconfig: "./src/view/client/tsconfig.json",
        }),
    ],
    build: {
        outDir: "dist/view/public",
        sourcemap: true,
        emptyOutDir: false,
        rollupOptions: {
            input: {
                main: resolve(__dirname, "src/view/client/app.ts"),
            },
            output: {
                entryFileNames: "js/[name].js",
            },
        },
    },
    logLevel: "error",
    server: {
        proxy: {
            // Forward API requests to your Express server
            "/api": {
                target: "http://localhost:9015",
                changeOrigin: true,
            },
        },
    },
});
