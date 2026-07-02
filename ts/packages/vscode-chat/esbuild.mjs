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

async function build() {
    if (watch) {
        const ctx = await esbuild.context(extensionConfig);
        await ctx.watch();
        console.log("Watching for changes...");
    } else {
        await esbuild.build(extensionConfig);
        console.log("Build complete");
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
