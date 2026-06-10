#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Install this plugin into GitHub Copilot CLI *globally*, so it loads in every
 * `copilot` session regardless of the directory you launch from (no
 * `--plugin-dir` and no `pnpm copilot` wrapper needed).
 *
 * Mechanism (Copilot CLI >= 1.0):
 *   `copilot plugin install <path>` is NOT supported — the install source must
 *   be a marketplace, a GitHub repo, or a git URL. However,
 *   `copilot plugin marketplace add <path>` DOES accept a local path. So we:
 *     1. Register the `ts` workspace root as a local marketplace
 *        ("typeagent-local"). The CLI discovers the marketplace manifest at
 *        `ts/.github/plugin/marketplace.json`, whose plugin `source` points at
 *        `./packages/copilot-plugin` (relative to the marketplace root).
 *     2. Install (or refresh) the "typeagent" plugin from that marketplace.
 *
 *   Installing COPIES the plugin (including dist/ and node_modules/) into
 *   ~/.copilot/installed-plugins/. It is a snapshot, not a live reference, so
 *   after you rebuild the plugin you must re-run this script (which calls
 *   `copilot plugin update`) to refresh the global copy.
 *
 *  - If `copilot` is not on PATH, we warn and exit 0 (don't fail the build).
 *  - Pass `--skip-install` (or set `TYPEAGENT_SKIP_PLUGIN_INSTALL=1`) to opt out.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pluginRoot = resolve(__dirname, "..");
// The marketplace manifest lives at <workspaceRoot>/.github/plugin/
// marketplace.json, so the marketplace source we register is the `ts`
// workspace root (packages/copilot-plugin -> ../..).
const workspaceRoot = resolve(pluginRoot, "..", "..");

const MARKETPLACE_NAME = "typeagent-local";
const PLUGIN_NAME = "typeagent";

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

// Run a copilot subcommand, returning { status, stdout, stderr }.
function copilot(args) {
    return spawnSync("copilot", args, {
        encoding: "utf-8",
        shell: process.platform === "win32",
    });
}

log(`Found copilot at ${copilotPath}`);

// 1. Register the local marketplace if not already registered.
const mpList = copilot(["plugin", "marketplace", "list"]);
if ((mpList.stdout || "").includes(MARKETPLACE_NAME)) {
    log(`Marketplace "${MARKETPLACE_NAME}" already registered.`);
} else {
    log(`Registering local marketplace from ${workspaceRoot}`);
    const add = copilot(["plugin", "marketplace", "add", workspaceRoot]);
    process.stdout.write(add.stdout || "");
    process.stderr.write(add.stderr || "");
    if (add.status !== 0) {
        warn("Failed to register marketplace. Aborting.");
        process.exit(0);
    }
}

// 2. Install the plugin, or update it if it's already installed (refresh the
//    global snapshot from the freshly built local source).
const pluginList = copilot(["plugin", "list"]);
const alreadyInstalled = (pluginList.stdout || "").includes(
    `${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
);

const op = alreadyInstalled
    ? ["plugin", "update", PLUGIN_NAME]
    : ["plugin", "install", `${PLUGIN_NAME}@${MARKETPLACE_NAME}`];

log(alreadyInstalled ? "Refreshing global plugin copy…" : "Installing plugin…");
const result = copilot(op);
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");

if (result.status === 0) {
    log(
        "Done. The plugin is now available in every `copilot` session. " +
            "After rebuilding, re-run `pnpm run register` to refresh it.",
    );
    process.exit(0);
}

warn(
    `copilot ${op.join(" ")} exited with code ${result.status}. ` +
        "Re-run manually with `pnpm run register` if needed.",
);
process.exit(0);
