// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

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
    // The agentServerClient uses import.meta.url internally for auto-start
    // which we don't use; suppress the warning by defining it away.
    define: {
        "import.meta.url": "undefined",
    },
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
    entryPoints: ["src/webview/main.ts"],
    bundle: true,
    outfile: "dist/webview.js",
    format: "iife",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    minify: !watch,
};

async function build() {
    if (watch) {
        const extCtx = await esbuild.context(extensionConfig);
        const webCtx = await esbuild.context(webviewConfig);
        await Promise.all([extCtx.watch(), webCtx.watch()]);
        console.log("Watching for changes...");
    } else {
        await Promise.all([
            esbuild.build(extensionConfig),
            esbuild.build(webviewConfig),
        ]);
        console.log("Build complete");
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
