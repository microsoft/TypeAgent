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
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "..");

// Entry points keyed by their output path (relative to dist, no extension), so
// esbuild writes exactly the files referenced by hooks.json / .mcp.json.
const entryPoints = {
    "hooks/hook-router": resolve(pluginRoot, "src/hooks/hook-router.ts"),
    "hooks/hook-agent-stop": resolve(
        pluginRoot,
        "src/hooks/hook-agent-stop.ts",
    ),
    "hooks/hook-post-tool": resolve(pluginRoot, "src/hooks/hook-post-tool.ts"),
    "hooks/hook-powershell": resolve(
        pluginRoot,
        "src/hooks/hook-powershell.ts",
    ),
    "mcp/server": resolve(pluginRoot, "src/mcp/server.ts"),
};

await build({
    entryPoints,
    outdir: resolve(pluginRoot, "dist"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: true,
    // Some transitive deps (e.g. ws) optionally require native addons inside a
    // try/catch; leave them external so the bundle doesn't fail to resolve them
    // (they remain optional at runtime).
    external: ["bufferutil", "utf-8-validate"],
    // A few CJS deps call require() at runtime; provide one in the ESM output.
    banner: {
        js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
    },
    logLevel: "warning",
});

process.stdout.write("[copilot-plugin] Bundled entry points into dist/.\n");
