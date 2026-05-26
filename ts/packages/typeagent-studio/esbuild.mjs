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
};

if (watch) {
    const ctx = await esbuild.context(extensionConfig);
    await ctx.watch();
    console.log("typeagent-studio: watching…");
} else {
    await esbuild.build(extensionConfig);
}
