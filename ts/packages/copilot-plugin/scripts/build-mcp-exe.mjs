#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Build the TypeAgent MCP server as a single-file executable (`typeagent-mcp`
 * / `typeagent-mcp.exe`) via Node's Single Executable Application (SEA) feature.
 *
 * Why an exe (vs the dist/mcp/server.js used for local dev): the target plugin
 * marketplace only allows `.mcp.json` commands from an allowlist, not bare
 * `node`. So the plugin launches the MCP server via an allowlisted artifact-exec
 * launcher that resolves the `--` command to a binary *inside* the downloaded
 * artifact. This produces that binary. The MCP server is a thin stdio client
 * (lazy WebSocket connect to the daemon), so single-file bundling is safe —
 * unlike the agent-server daemon.
 *
 * Per-platform: SEA injects into the running platform's `node` binary, so the
 * publish pipeline runs this on each OS image to produce each RID's exe.
 *
 * Steps: esbuild → CJS bundle → SEA blob → copy node → (strip signature) →
 * postject-inject the blob → (re-sign on macOS).
 */

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "..");
const outDir = resolve(pluginRoot, "dist-exe");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const cjsBundle = join(outDir, "typeagent-mcp.cjs");
const seaConfig = join(outDir, "sea-config.json");
const blob = join(outDir, "typeagent-mcp.blob");
const exeName = isWin ? "typeagent-mcp.exe" : "typeagent-mcp";
const exePath = join(outDir, exeName);

// 1. Bundle the MCP server as a single CommonJS file (SEA requires a CJS main).
console.log("[build-mcp-exe] bundling (cjs) ...");
await build({
    entryPoints: [resolve(pluginRoot, "src/mcp/server.ts")],
    outfile: cjsBundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    // ws's optional native acceleration — leave external; ws requires them in a
    // try/catch, so a missing module degrades gracefully inside the SEA.
    external: ["bufferutil", "utf-8-validate"],
    logLevel: "warning",
});

// 2. Generate the SEA preparation blob.
console.log("[build-mcp-exe] generating SEA blob ...");
fs.writeFileSync(
    seaConfig,
    JSON.stringify(
        { main: cjsBundle, output: blob, disableExperimentalSEAWarning: true },
        null,
        2,
    ),
);
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], {
    stdio: "inherit",
});

// 3. Copy the node binary to the target exe.
console.log(`[build-mcp-exe] copying node -> ${exeName}`);
fs.copyFileSync(process.execPath, exePath);
if (!isWin) fs.chmodSync(exePath, 0o755);

// 4. Strip the existing code signature so injection doesn't corrupt it
//    (Windows signing is handled by the release pipeline; macOS re-signed below).
if (isMac) {
    try {
        execFileSync("codesign", ["--remove-signature", exePath], {
            stdio: "inherit",
        });
    } catch {
        /* unsigned already / codesign unavailable */
    }
}

// 5. Inject the blob with postject. Use its programmatic API (postject is a
//    devDependency, installed during the authenticated `pnpm install`) rather
//    than `npx postject`, which fetches the package at build time and fails with
//    E401 against the authenticated feed registry in CI.
console.log("[build-mcp-exe] injecting blob (postject) ...");
const fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const { inject } = require("postject");
await inject(exePath, "NODE_SEA_BLOB", fs.readFileSync(blob), {
    sentinelFuse: fuse,
    ...(isMac ? { machoSegmentName: "NODE_SEA" } : {}),
});

// 6. Re-sign on macOS (ad-hoc) so the OS will run the modified binary.
if (isMac) {
    try {
        execFileSync("codesign", ["--sign", "-", exePath], {
            stdio: "inherit",
        });
    } catch {
        /* best-effort; CI signs for release */
    }
}

console.log(`[build-mcp-exe] done -> ${exePath}`);
