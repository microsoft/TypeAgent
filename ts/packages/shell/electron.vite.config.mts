// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync } from "fs";

// Plugin to copy schema files to output directory
function copySchemaPlugin() {
    return {
        name: "copy-schema-files",
        closeBundle() {
            const srcDir = resolve(__dirname, "src/main");
            const outDir = resolve(__dirname, "out/main");
            mkdirSync(outDir, { recursive: true });
            copyFileSync(
                resolve(srcDir, "speechProcessingSchema.ts"),
                resolve(outDir, "speechProcessingSchema.ts"),
            );
        },
    };
}

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin(), copySchemaPlugin()],
        build: {
            sourcemap: true,
        },
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            sourcemap: true,
            rollupOptions: {
                input: {
                    chatView: resolve(__dirname, "src/preload/chatView.ts"),
                    expose: resolve(__dirname, "./src/preload/expose.ts"),
                },
            },
        },
    },
    renderer: {
        build: {
            sourcemap: true,
            rollupOptions: {
                input: {
                    chatView: resolve(__dirname, "src/renderer/chatView.html"),
                    viewHost: resolve(__dirname, "src/renderer/viewHost.html"),
                    searchMenuView: resolve(
                        __dirname,
                        "src/renderer/searchMenuView.html",
                    ),
                    newTab: resolve(__dirname, "src/renderer/newTab.html"),
                    readOnlyChatView: resolve(
                        __dirname,
                        "src/renderer/readOnlyChatView.html",
                    ),
                },
            },
        },
        server: {
            cors: true,
        },
    },
});
