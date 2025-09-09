// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
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
                    main: resolve(__dirname, "./src/preload/main.ts"),
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
                    newTab: resolve(__dirname, "src/renderer/newTab.html"),
                },
            },
        },
    },
});
