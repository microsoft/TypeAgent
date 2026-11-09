#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Bundle the plugin's hook + MCP entry points into self-contained files.
 *
 * Why: this is a pnpm workspace, so the plugin's runtime deps (incl. the
 * `workspace:*` packages and the MCP SDK) live as symlinks/junctions into the
 * central `.pnpm` store. When Copilot CLI installs the plugin it COPIES the
 * package directory into ~/.copilot/installed-plugins/, which breaks those
 * symlinks — `node dist/.../*.js` then fails with ERR_MODULE_NOT_FOUND.
 *
 * Bundling inlines every dependency into each entry point so the copied `dist/`
 * needs no node_modules at runtime. The bundles are written over the same
 * dist paths that hooks.json and .mcp.json already reference (${PLUGIN_ROOT}/
 * dist/...), so no manifest changes are needed.
 *
 * Runs after `tsc -b` (which still produces .d.ts and type-checks).
 */

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "..");
const dist = resolve(pluginRoot, "dist");
const runtimeRoot = join(dist, "recipe-runtime");
const require = createRequire(import.meta.url);
const macrosRoot = resolve(
    dirname(require.resolve("@typeagent/copilot-macros/recipeCompiler")),
    "..",
);
const macroRequire = createRequire(join(macrosRoot, "package.json"));
const assetManifest = [];

await rm(runtimeRoot, { recursive: true, force: true });

async function copyAsset(source, destination) {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await recordAsset(destination);
}

async function recordAsset(destination) {
    const content = await readFile(destination);
    assetManifest.push({
        path: relative(dist, destination).replaceAll("\\", "/"),
        bytes: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
    });
}

// Keep the compiler's real library dependency closure, not a reduced virtual
// substitute. Missing standard declarations must remain compiler errors.
const typescriptRoot = dirname(macroRequire.resolve("typescript"));
const libraries = new Set();
async function copyLibrary(name) {
    if (libraries.has(name)) return;
    libraries.add(name);
    const source = join(typescriptRoot, name);
    const text = await readFile(source, "utf8");
    await copyAsset(source, join(runtimeRoot, "typescript", name));
    for (const match of text.matchAll(/<reference lib="([^"]+)"/g))
        await copyLibrary(`lib.${match[1]}.d.ts`);
}
await copyLibrary("lib.es2021.d.ts");
for (const name of ["LICENSE.txt", "ThirdPartyNoticeText.txt"])
    await copyAsset(
        join(typescriptRoot, "..", name),
        join(runtimeRoot, "typescript", name),
    );

// Preserve QuickJS's CommonJS module layout, including its Emscripten loader
// with the real release WASM embedded as shipped by the pinned dependency.
const quickjsEntry = macroRequire.resolve("@tootallnate/quickjs-emscripten");
const quickjsRoot = dirname(quickjsEntry);
const quickjsModules = new Set();
async function copyQuickjsModule(source) {
    if (quickjsModules.has(source)) return;
    quickjsModules.add(source);
    const text = await readFile(source, "utf8");
    await copyAsset(
        source,
        join(runtimeRoot, "quickjs", relative(quickjsRoot, source)),
    );
    for (const match of text.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
        const dependency = createRequire(source).resolve(match[1]);
        if (
            !dependency.startsWith(quickjsRoot + "\\") &&
            !dependency.startsWith(quickjsRoot + "/")
        )
            throw new Error(
                `QuickJS dependency escapes its asset root: ${dependency}`,
            );
        await copyQuickjsModule(dependency);
    }
}
await copyQuickjsModule(quickjsEntry);
const quickjsLoaderPath = join(
    runtimeRoot,
    "quickjs",
    "generated",
    "emscripten-module.WASM_RELEASE_SYNC.js",
);
const quickjsLoader = await readFile(quickjsLoaderPath, "utf8");
const embeddedWasm = quickjsLoader.match(
    /["']data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)["']/,
);
if (!embeddedWasm)
    throw new Error(
        "The pinned QuickJS loader must contain its release WASM asset.",
    );
const wasm = Buffer.from(embeddedWasm[1], "base64");
if (!wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])))
    throw new Error("QuickJS embedded asset is not a WebAssembly module.");
await copyAsset(
    join(quickjsRoot, "..", "LICENSE"),
    join(runtimeRoot, "quickjs", "LICENSE"),
);
await writeFile(
    join(runtimeRoot, "quickjs", "package.json"),
    JSON.stringify({ type: "commonjs" }) + "\n",
);
await recordAsset(join(runtimeRoot, "quickjs", "package.json"));

function recipeAssetsPlugin(assetRelative, entryPaths = []) {
    return {
        name: "typeagent-recipe-assets",
        setup(build) {
            build.onResolve({ filter: /^typeagent:recipe-assets$/ }, () => ({
                path: "setup",
                namespace: "recipe-assets",
            }));
            build.onLoad({ filter: /.*/, namespace: "recipe-assets" }, () => ({
                contents: `
import { fileURLToPath } from "node:url";
import { configureRecipeCompilerAssets } from "@typeagent/copilot-macros/recipeCompiler";
import { configureRecipeExecutorAssets } from "@typeagent/copilot-macros/recipeExecutor";
const root = new URL(${JSON.stringify(assetRelative)}, import.meta.url);
configureRecipeCompilerAssets({ libraryDirectory: fileURLToPath(new URL("typescript/", root)) });
configureRecipeExecutorAssets({
    workerUrl: new URL("recipeExecutorWorker.mjs", root),
    quickjsModulePath: fileURLToPath(new URL("quickjs/index.js", root))
});
`,
                resolveDir: pluginRoot,
                loader: "js",
            }));
            build.onLoad({ filter: /\.[cm]?[jt]s$/ }, async (args) => {
                if (!entryPaths.includes(args.path)) return;
                return {
                    contents:
                        'import "typeagent:recipe-assets";\n' +
                        (await readFile(args.path, "utf8")),
                    resolveDir: dirname(args.path),
                    loader: "ts",
                };
            });
        },
    };
}

const common = {
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: true,
    // Grammar model generation has a lazy backend-only branch. Portable
    // authoring supplies queries and must not ship its native inference stack.
    external: ["@typeagent/aiclient"],
    banner: {
        js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
    },
    logLevel: "warning",
};

await build({
    ...common,
    entryPoints: [join(macrosRoot, "dist", "recipeExecutorWorker.js")],
    outfile: join(runtimeRoot, "recipeExecutorWorker.mjs"),
});
await recordAsset(join(runtimeRoot, "recipeExecutorWorker.mjs"));

// A supported standalone program API also lets embedders supply their own
// RecipeHost without importing a native SDK or connecting an agent server.
await build({
    ...common,
    stdin: {
        contents: `
import "typeagent:recipe-assets";
export * from "@typeagent/copilot-macros/recipeCompiler";
export * from "@typeagent/copilot-macros/recipeExecutor";
export * from "@typeagent/copilot-macros/recipeCore";
export * from "@typeagent/copilot-macros/recipeTesting";
export { MacroManager } from "@typeagent/copilot-macros";
export { createMacroLearningRuntime } from "@typeagent/copilot-macros/macroAuthoringRuntime";
export { createMacroProgramAuthor } from "@typeagent/copilot-macros/macroProgramAuthoring";
`,
        resolveDir: pluginRoot,
        sourcefile: "standalone-recipe-api.mjs",
    },
    outfile: join(runtimeRoot, "index.mjs"),
    plugins: [recipeAssetsPlugin("./")],
});

// Entry points keyed by their output path (relative to dist, no extension), so
// esbuild writes exactly the files referenced by hooks.json / .mcp.json.
const entryPoints = {
    "hooks/hook-router": resolve(pluginRoot, "src/hooks/hook-router.ts"),
    "mcp/server": resolve(pluginRoot, "src/mcp/server.ts"),
};

await build({
    ...common,
    entryPoints,
    outdir: dist,
    plugins: [
        recipeAssetsPlugin("../recipe-runtime/", Object.values(entryPoints)),
    ],
    // Some transitive deps (e.g. ws) optionally require native addons inside a
    // try/catch; leave them external so the bundle doesn't fail to resolve them
    // (they remain optional at runtime).
    external: [...common.external, "bufferutil", "utf-8-validate"],
});

const extensionEntry = resolve(pluginRoot, "src/extension/extension.ts");
await build({
    ...common,
    entryPoints: {
        extension: extensionEntry,
    },
    outdir: resolve(pluginRoot, "dist/extensions/typeagent"),
    outExtension: { ".js": ".mjs" },
    plugins: [recipeAssetsPlugin("../../recipe-runtime/", [extensionEntry])],
    external: [
        ...common.external,
        "@github/copilot-sdk",
        "@github/copilot-sdk/*",
        "bufferutil",
        "utf-8-validate",
    ],
});

await writeFile(
    join(runtimeRoot, "assets.json"),
    JSON.stringify(
        {
            schemaVersion: 1,
            typescript: macroRequire("typescript").version,
            quickjs: {
                version: macroRequire(
                    "@tootallnate/quickjs-emscripten/package.json",
                ).version,
                wasm: {
                    encoding: "embedded-base64",
                    path: relative(dist, quickjsLoaderPath).replaceAll(
                        "\\",
                        "/",
                    ),
                    bytes: wasm.length,
                    sha256: createHash("sha256").update(wasm).digest("hex"),
                },
            },
            assets: assetManifest.sort((a, b) => a.path.localeCompare(b.path)),
        },
        null,
        2,
    ) + "\n",
);

process.stdout.write("[copilot-plugin] Bundled entry points into dist/.\n");
