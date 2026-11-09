#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Stage and install this plugin through the shared TypeAgent registrar.
 *
 * The workspace package cannot be used as the marketplace source directly:
 * its pnpm node_modules contains Windows junctions that Copilot tries to copy,
 * which fails with access denied.
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stageCopilotPlugin } from "../../../tools/scripts/stageCopilotPlugin.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(pluginRoot, "..", "..");
const marketplaceName = "typeagent-local";
const copilotHome = path.resolve(
    process.env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot"),
);
const stagingRoot = path.join(
    os.homedir(),
    ".typeagent-copilot",
    "plugin-stage",
);
const marketplaceRoot = path.join(copilotHome, "marketplaces", marketplaceName);
const registerScript = path.join(
    workspaceRoot,
    "tools",
    "installers",
    "common",
    "register-plugin.mjs",
);

function log(message) {
    process.stdout.write(`[copilot-plugin] ${message}\n`);
}

function warn(message) {
    process.stderr.write(`[copilot-plugin] ${message}\n`);
}

function findCopilotCli() {
    if (process.env.COPILOT_CLI_PATH) {
        return process.env.COPILOT_CLI_PATH;
    }
    const command = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(command, ["copilot"], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout.trim()) return undefined;
    return result.stdout.split(/\r?\n/)[0].trim();
}

if (
    process.argv.includes("--skip-install") ||
    process.env.TYPEAGENT_SKIP_PLUGIN_INSTALL === "1"
) {
    log("Skipping plugin install (opt-out flag set).");
    process.exit(0);
}

const distHook = path.join(pluginRoot, "dist", "hooks", "hook-router.js");
if (!existsSync(distHook)) {
    warn(
        `Built output not found at ${distHook}. Run \`pnpm run build\` first.`,
    );
    process.exit(1);
}

const copilotPath = findCopilotCli();
if (!copilotPath) {
    warn(
        "GitHub Copilot CLI (`copilot`) not found on PATH. " +
            "Skipping global plugin registration.",
    );
    process.exit(0);
}

log(`Found copilot at ${copilotPath}`);
const metrics = stageCopilotPlugin(stagingRoot);
log(`Staged ${metrics.files} runtime files without workspace node_modules.`);

const registration = spawnSync(
    process.execPath,
    [
        registerScript,
        "--install-dir",
        workspaceRoot,
        "--plugin-source-dir",
        stagingRoot,
        "--marketplace-name",
        marketplaceName,
        "--marketplace-root",
        marketplaceRoot,
        "--plugin-name",
        "typeagent",
        "--copilot-path",
        copilotPath,
    ],
    { encoding: "utf8", shell: false },
);
process.stdout.write(registration.stdout || "");
process.stderr.write(registration.stderr || "");

if (registration.error) {
    warn(`Plugin registration could not start: ${registration.error.message}`);
    process.exit(1);
}
if (registration.status !== 0) {
    warn(`Plugin registration failed with exit code ${registration.status}.`);
    process.exit(registration.status ?? 1);
}

log("Done. The plugin is available in every `copilot` session.");
