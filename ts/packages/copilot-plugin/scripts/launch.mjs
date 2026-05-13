#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Launch GitHub Copilot CLI with this plugin loaded via --plugin-dir.
 *
 * Usage (from anywhere in the workspace):
 *   pnpm copilot                 # interactive session
 *   pnpm copilot -- -p "prompt"  # non-interactive
 *
 * The launched copilot inherits the *user's* cwd (INIT_CWD from pnpm), not
 * the workspace root, so file-access and prompts behave as if `copilot` were
 * invoked directly.
 */

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

/**
 * Resolve copilot to an absolute executable path so we can spawn without
 * `shell: true`. On Windows, `spawn("copilot", args, { shell: true })`
 * concatenates args into a single command line and quoting is unreliable
 * (any arg containing a space gets split by the receiving CLI parser).
 */
function resolveCopilot() {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(cmd, ["copilot"], { encoding: "utf-8" });
    if (result.status !== 0 || !result.stdout.trim()) return null;
    // `where` can return multiple lines; prefer a .exe on Windows.
    const lines = result.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    if (process.platform === "win32") {
        const exe = lines.find((l) => l.toLowerCase().endsWith(".exe"));
        if (exe) return exe;
    }
    return lines[0];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pluginRoot = resolve(__dirname, "..");
const distHook = resolve(pluginRoot, "dist", "hooks", "hook-router.js");

if (!existsSync(distHook)) {
    process.stderr.write(
        `[copilot-plugin] Built output not found at ${distHook}.\n` +
            `Run \`pnpm --filter @typeagent/copilot-plugin build\` first.\n`,
    );
    process.exit(1);
}

// pnpm sets INIT_CWD to the directory where the user invoked pnpm; fall back
// to process.cwd() (which is the workspace root when pnpm is the launcher).
const userCwd = process.env.INIT_CWD || process.cwd();

// pnpm passes `--` literally; strip a single leading `--` so users can write
// `pnpm copilot -- -p "prompt"` to delimit their args.
const userArgs = process.argv.slice(2);
if (userArgs[0] === "--") {
    userArgs.shift();
}

const args = ["--plugin-dir", pluginRoot, ...userArgs];

const copilotPath = resolveCopilot();
if (!copilotPath) {
    process.stderr.write(
        "[copilot-plugin] GitHub Copilot CLI not found on PATH.\n" +
            "Install it from https://docs.github.com/copilot/cli\n",
    );
    process.exit(1);
}

const child = spawn(copilotPath, args, {
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
        `[copilot-plugin] Failed to launch copilot: ${err.message}\n` +
            `Is GitHub Copilot CLI installed? https://docs.github.com/copilot/cli\n`,
    );
    process.exit(1);
});
