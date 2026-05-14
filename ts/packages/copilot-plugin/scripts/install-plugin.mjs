#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Postbuild step: register the built plugin with GitHub Copilot CLI.
 *
 * Behavior:
 *  - When invoked inside the TypeAgent repo, the `.github/plugin/plugin.json`
 *    discovery manifest will be picked up automatically — global registration
 *    is only needed if the user launches `copilot` from a different directory.
 *  - This script runs `copilot plugin install <abs-path>` using the package
 *    directory as the canonical self-contained plugin location.
 *  - If `copilot` is not on PATH, we warn and exit 0 (don't fail the build).
 *  - Pass `--skip-install` (or set `TYPEAGENT_SKIP_PLUGIN_INSTALL=1`) to opt out.
 */

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pluginRoot = resolve(__dirname, "..");

function log(msg) {
    process.stdout.write(`[copilot-plugin] ${msg}\n`);
}

function warn(msg) {
    process.stderr.write(`[copilot-plugin] ${msg}\n`);
}

if (
    process.argv.includes("--skip-install") ||
    process.env.TYPEAGENT_SKIP_PLUGIN_INSTALL === "1"
) {
    log("Skipping plugin install (opt-out flag set).");
    process.exit(0);
}

// Sanity check: built output must exist.
const distHook = resolve(pluginRoot, "dist", "hooks", "hook-router.js");
if (!existsSync(distHook)) {
    warn(
        `Built output not found at ${distHook}. Run \`pnpm run build\` first.`,
    );
    process.exit(1);
}

// Locate copilot CLI. spawnSync with shell:false; resolve via which/where.
function findCopilotCli() {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(cmd, ["copilot"], { encoding: "utf-8" });
    if (result.status === 0 && result.stdout.trim()) {
        return result.stdout.split(/\r?\n/)[0].trim();
    }
    return null;
}

const copilotPath = findCopilotCli();
if (!copilotPath) {
    warn(
        "GitHub Copilot CLI (`copilot`) not found on PATH. " +
            "Skipping global plugin registration. " +
            "Install Copilot CLI and rerun `pnpm run register` if you want " +
            "to use the plugin outside this repo.",
    );
    process.exit(0);
}

log(`Found copilot at ${copilotPath}`);
log(`Registering plugin from ${pluginRoot}`);

const child = spawn("copilot", ["plugin", "install", pluginRoot], {
    stdio: "inherit",
    shell: process.platform === "win32",
});

child.on("exit", (code) => {
    if (code === 0) {
        log("Plugin registered successfully.");
        process.exit(0);
    } else {
        // Most likely already installed — warn but don't fail the build.
        warn(
            `copilot plugin install exited with code ${code}. ` +
                "If the plugin is already installed, this is expected. " +
                "Re-run manually with `pnpm run register` if needed.",
        );
        process.exit(0);
    }
});

child.on("error", (err) => {
    warn(`Failed to spawn copilot: ${err.message}`);
    process.exit(0);
});
