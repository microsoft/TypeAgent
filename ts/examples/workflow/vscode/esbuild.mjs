// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as esbuild from "esbuild";
import { createRequire } from "node:module";

const watch = process.argv.includes("--watch");
const require = createRequire(import.meta.url);

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: true,
    minify: !watch,
};

// Bundle the LSP server alongside the extension so users don't have to
// install workflow-lsp separately. The extension launches dist/server.js
// (see src/extension.ts).
/** @type {import('esbuild').BuildOptions} */
const serverConfig = {
    entryPoints: [require.resolve("workflow-lsp")],
    bundle: true,
    outfile: "dist/server.js",
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: true,
    minify: !watch,
};

async function build() {
    if (watch) {
        const extCtx = await esbuild.context(extensionConfig);
        const srvCtx = await esbuild.context(serverConfig);
        await Promise.all([extCtx.watch(), srvCtx.watch()]);
        console.log("Watching for changes...");
    } else {
        await Promise.all([
            esbuild.build(extensionConfig),
            esbuild.build(serverConfig),
        ]);
        console.log("Build complete");
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
