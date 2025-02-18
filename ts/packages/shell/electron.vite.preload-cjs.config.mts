// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";

export default defineConfig({
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            sourcemap: true,
            rollupOptions: {
                input: {
                    webview: resolve(__dirname, "./src/preload/webView.ts"),
                },
                output: {
                    // For the CJS preload
                    format: "cjs",
                    entryFileNames: "[name].cjs",
                    dir: "out/preload-cjs",
                    preserveModules: true, // Ensure each module is preserved in the output
                },
            },
        },
    },
});
