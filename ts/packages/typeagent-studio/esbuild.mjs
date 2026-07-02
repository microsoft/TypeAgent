// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const watch = process.argv.includes("--watch");

/**
 * Studio imports the `@typeagent/telemetry` barrel for logging/profiling
 * symbols, but never creates the MongoDB logger sink. The barrel still pulls
 * the full `mongodb` driver into the node bundles (its client-side-encryption
 * crypto callbacks embed PEM `-----BEGIN/END PRIVATE KEY-----` delimiters that
 * trip vsce's secret scanner). Alias `mongodb` to an inert stub so the real
 * driver never ships, keeping the package secret-free and much smaller.
 */
const nodeBundleAlias = {
    mongodb: path.resolve("src/stubs/mongodbStub.cjs"),
};

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
    copyCodiconFont();
}

/**
 * Copy the codicon icon font next to the webview stylesheet so the Impact Report
 * can render VS Code's native icon set. `media/` is a `localResourceRoot`, so the
 * webview can load the font under the existing `font-src ${cspSource}` policy; the
 * stylesheet `@font-face`s it by the relative `codicon.ttf` path. The `.ttf` is
 * generated (gitignored) and shipped in the `.vsix` from disk by vsce.
 */
function copyCodiconFont() {
    const candidates = [
        path.resolve("node_modules/@vscode/codicons/dist/codicon.ttf"),
        path.resolve("../../node_modules/@vscode/codicons/dist/codicon.ttf"),
    ];
    const src = candidates.find((p) => fs.existsSync(p));
    if (src) {
        fs.mkdirSync("media", { recursive: true });
        fs.copyFileSync(src, "media/codicon.ttf");
    } else {
        console.warn(
            "typeagent-studio: codicon.ttf not found; icons will fall back to text.",
        );
    }
}

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    external: ["vscode"],
    alias: nodeBundleAlias,
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
    alias: nodeBundleAlias,
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
