// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    root: ".",
    build: {
        outDir: "dist",
        emptyOutDir: true,
        // Inline the chat-ui CSS rather than emitting a separate file so the
        // VSIX only needs to ship index.html + the bundled JS.
        cssCodeSplit: false,
        rollupOptions: {
            input: {
                index: resolve(__dirname, "index.html"),
            },
        },
        // The VSIX's WebView2 navigates to https://typeagent.local/index.html
        // (a virtual host mapping). Relative asset paths are required.
        assetsDir: "assets",
    },
    base: "./",
});
