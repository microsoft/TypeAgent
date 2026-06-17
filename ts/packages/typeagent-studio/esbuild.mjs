// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const watch = process.argv.includes("--watch");

/**
 * Copy runtime assets the bundled code reads from disk into `dist/` so they
 * ship in the `.vsix` and resolve next to the bundle at runtime.
 *
 * `action-grammar`'s built-in entity loader (`builtInFileLoader.ts`) reads
 * `builtInEntities.agr` relative to its module dir, checking `<dir>/…` first
 * (the bundled case, where `<dir>` is `dist/`). Compiling any grammar that uses
 * built-in entities (Ordinal/Cardinal — the player grammar does) exercises this
 * path, e.g. in the Impact Report's static-grammar replay. Without the asset the
 * service throws ENOENT, so copy it beside both the extension and service bundles.
 */
function copyRuntimeAssets() {
    fs.mkdirSync("dist", { recursive: true });
    const builtInEntities = path.resolve(
        "../actionGrammar/src/builtInEntities.agr",
    );
    fs.copyFileSync(builtInEntities, "dist/builtInEntities.agr");
}

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
 * The standalone Studio service, bundled INTO the extension so it ships in the
 * `.vsix` (packaged with `--no-dependencies`; `node_modules` is `.vscodeignore`d,
 * so the launcher cannot `require.resolve("studio-service")` at runtime). The
 * launcher spawns `node dist/studio-service.js --workspace <root>` by a path
 * relative to the extension. Same node/CJS + import.meta shim as the extension.
 * @type {import('esbuild').BuildOptions}
 */
const serviceConfig = {
    entryPoints: ["../studio-service/src/main.ts"],
    bundle: true,
    outfile: "dist/studio-service.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: true,
    minify: !watch,
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
    const serviceCtx = await esbuild.context(serviceConfig);
    const webviewCtx = await esbuild.context(webviewConfig);
    await ctx.watch();
    await serviceCtx.watch();
    await webviewCtx.watch();
    copyRuntimeAssets();
    console.log("typeagent-studio: watching…");
} else {
    await esbuild.build(extensionConfig);
    await esbuild.build(serviceConfig);
    await esbuild.build(webviewConfig);
    copyRuntimeAssets();
}
