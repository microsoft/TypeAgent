// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.cjs",
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
    loader: {
        ".css": "text",
    },
};

/** @type {import('esbuild').BuildOptions} */
const expandConfig = {
    ...webviewConfig,
    entryPoints: ["src/webview/expand.ts"],
    outfile: "dist/expand.js",
};

async function build() {
    if (watch) {
        const extCtx = await esbuild.context(extensionConfig);
        const webCtx = await esbuild.context(webviewConfig);
        const expandCtx = await esbuild.context(expandConfig);
        await Promise.all([extCtx.watch(), webCtx.watch(), expandCtx.watch()]);
        console.log("Watching for changes...");
    } else {
        await Promise.all([
            esbuild.build(extensionConfig),
            esbuild.build(webviewConfig),
            esbuild.build(expandConfig),
        ]);
        console.log("Build complete");
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
