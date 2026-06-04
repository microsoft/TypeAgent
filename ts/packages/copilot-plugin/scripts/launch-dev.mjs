#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Launch the *locally-built* GitHub Copilot CLI (copilot-agent-runtime) with
 * this plugin loaded via --plugin-dir. Mirrors `launch.mjs` but runs the dev
 * build instead of the copilot binary on PATH.
 *
 * Usage (from anywhere in the workspace):
 *   pnpm copilot:dev                 # interactive session
 *   pnpm copilot:dev -- -p "prompt"  # non-interactive
 *
 * The runtime repo is resolved in this order:
 *   1. $COPILOT_DEV_DIR if set
 *   2. ../copilot-agent-runtime relative to the TypeAgent root
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pluginRoot = resolve(__dirname, "..");
const distHook = resolve(pluginRoot, "dist", "hooks", "hook-router.js");
// TypeAgent root: .../TypeAgent/ts/packages/copilot-plugin/scripts -> up 4
const typeAgentRoot = resolve(__dirname, "..", "..", "..", "..");

if (!existsSync(distHook)) {
    process.stderr.write(
        `[copilot-plugin] Built output not found at ${distHook}.\n` +
            `Run \`pnpm --filter @typeagent/copilot-plugin build\` first.\n`,
    );
    process.exit(1);
}

function resolveRuntimeDir() {
    if (process.env.COPILOT_DEV_DIR) {
        return resolve(process.env.COPILOT_DEV_DIR);
    }
    return resolve(typeAgentRoot, "..", "copilot-agent-runtime");
}

const runtimeDir = resolveRuntimeDir();
const runtimeEntry = resolve(runtimeDir, "dist-cli", "index.js");

if (!existsSync(runtimeEntry)) {
    process.stderr.write(
        `[copilot-plugin] Dev copilot CLI not found at ${runtimeEntry}.\n` +
            `Set $COPILOT_DEV_DIR to the copilot-agent-runtime checkout, or place it next to TypeAgent.\n` +
            `Then run \`npm run build\` in that repo.\n`,
    );
    process.exit(1);
}

const userCwd = process.env.INIT_CWD || process.cwd();

const userArgs = process.argv.slice(2);
if (userArgs[0] === "--") {
    userArgs.shift();
}

const args = [
    "--enable-source-maps",
    "--report-on-fatalerror",
    runtimeEntry,
    "--plugin-dir",
    pluginRoot,
    ...userArgs,
];

const child = spawn(process.execPath, args, {
    stdio: "inherit",
    cwd: userCwd,
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
    } else {
        process.exit(code ?? 0);
    }
});

child.on("error", (err) => {
    process.stderr.write(
        `[copilot-plugin] Failed to launch dev copilot: ${err.message}\n`,
    );
    process.exit(1);
});
