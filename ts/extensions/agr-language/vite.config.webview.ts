// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    build: {
        outDir: "webview-dist",
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            input: {
                debugPanel: resolve(__dirname, "webview/debugPanelEntry.ts"),
            },
            output: {
                entryFileNames: "[name].js",
                format: "es",
            },
        },
    },
    resolve: {
        alias: {
            // Resolve workspace packages to their TypeScript source so Vite
            // bundles them directly. These paths mirror the workspace layout
            // defined in pnpm-workspace.yaml; update if packages move.
            "grammar-tools-ui": resolve(
                __dirname,
                "../../packages/grammarTools/ui/src/index.ts",
            ),
            "grammar-tools-core": resolve(
                __dirname,
                "../../packages/grammarTools/core/src/index.ts",
            ),
        },
    },
});
