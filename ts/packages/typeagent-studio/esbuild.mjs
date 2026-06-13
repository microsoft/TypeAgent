// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    external: ["vscode", "studio-service"],
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: true,
    minify: !watch,
    // `action-grammar` (pulled in by the grammar collision scanner) references
    // `import.meta.url` at module top level for locating bundled assets. Under
    // the CJS output format esbuild would replace it with an empty string,
    // which throws in `fileURLToPath` at load time. Map it to the bundle's own
    // file URL so those modules load; the lazy file-IO paths they guard are not
    // exercised by NFA-based collision scanning.
    define: {
        "import.meta.url": "__importMetaUrl",
    },
    banner: {
        js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;",
    },
};

/**
 * The Impact Report webview client bundle. Runs inside the webview iframe, so
 * it targets the browser and must NOT pull in `vscode`, `ws`, or node built-ins
 * (the bundle smoke test asserts this).
 * @type {import('esbuild').BuildOptions}
 */
const webviewConfig = {
    entryPoints: ["src/webviewKit/client/impactReport.ts"],
    bundle: true,
    outfile: "dist/webview/impactReport.js",
    format: "iife",
    platform: "browser",
    target: "es2020",
    sourcemap: true,
    minify: !watch,
};

if (watch) {
    const ctx = await esbuild.context(extensionConfig);
    const webviewCtx = await esbuild.context(webviewConfig);
    await ctx.watch();
    await webviewCtx.watch();
    console.log("typeagent-studio: watching…");
} else {
    await esbuild.build(extensionConfig);
    await esbuild.build(webviewConfig);
}
