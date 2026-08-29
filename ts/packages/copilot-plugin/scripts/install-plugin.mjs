#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Install this plugin globally through a local Copilot marketplace.
 *
 * The workspace package cannot be used as the marketplace source directly:
 * its pnpm node_modules contains Windows junctions that Copilot tries to copy,
 * which fails with access denied. Stage only the self-contained runtime files,
 * then use the same registration implementation as the TypeAgent installer.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stageCopilotPlugin } from "../../../tools/scripts/stageCopilotPlugin.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(pluginRoot, "..", "..");
const marketplaceName = "typeagent-local";
const pluginName = "typeagent";
const copilotHome = path.resolve(
    process.env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot"),
);
const stagingRoot = path.join(
    os.homedir(),
    ".typeagent-copilot",
    "plugin-stage",
);
const marketplaceRoot = path.join(copilotHome, "marketplaces", marketplaceName);
const installedMarketplaceRoot = path.join(
    copilotHome,
    "installed-plugins",
    marketplaceName,
);
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

function quoteCmdArgument(value) {
    return `"${value.replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

function run(command, args) {
    if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
        const commandLine = [
            "call",
            quoteCmdArgument(command),
            ...args.map(quoteCmdArgument),
        ].join(" ");
        return spawnSync(
            process.env.ComSpec ?? "cmd.exe",
            ["/d", "/s", "/c", commandLine],
            {
                encoding: "utf8",
                shell: false,
                windowsVerbatimArguments: true,
            },
        );
    }
    return spawnSync(command, args, {
        encoding: "utf8",
        shell: false,
    });
}

function printResult(result) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
}

function findCopilotCli() {
    const command = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(command, ["copilot"], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout.trim()) return undefined;
    return result.stdout.split(/\r?\n/)[0].trim();
}

function hasListedEntry(output, identifier) {
    return output.split(/\r?\n/).some((line) => {
        const entry = line.trim().replace(/^[^A-Za-z0-9_.@-]+/, "");
        return entry.split(/\s+/, 1)[0] === identifier;
    });
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

// Migrate registrations created by the old script, which pointed directly at
// the pnpm workspace and caused Copilot to traverse package junctions.
const marketplaces = run(copilotPath, ["plugin", "marketplace", "list"]);
const marketplaceOutput = `${marketplaces.stdout || ""}\n${
    marketplaces.stderr || ""
}`;
if (
    hasListedEntry(marketplaceOutput, marketplaceName) &&
    !marketplaceOutput.toLowerCase().includes(marketplaceRoot.toLowerCase())
) {
    log("Replacing the legacy workspace-backed marketplace registration.");
    const plugins = run(copilotPath, ["plugin", "list"]);
    if (
        hasListedEntry(
            `${plugins.stdout || ""}\n${plugins.stderr || ""}`,
            `${pluginName}@${marketplaceName}`,
        )
    ) {
        printResult(run(copilotPath, ["plugin", "uninstall", pluginName]));
    }
    const remove = run(copilotPath, [
        "plugin",
        "marketplace",
        "remove",
        marketplaceName,
    ]);
    printResult(remove);
    if (remove.status !== 0) {
        warn("Failed to remove the legacy marketplace registration.");
        process.exit(1);
    }
}

// Clean up partial directories left by the old workspace-backed installation.
if (existsSync(installedMarketplaceRoot)) {
    for (const entry of readdirSync(installedMarketplaceRoot)) {
        if (entry.startsWith(`.${pluginName}.tmp-`)) {
            log(`Removing stale failed-install artifact ${entry}.`);
            rmSync(path.join(installedMarketplaceRoot, entry), {
                recursive: true,
                force: true,
            });
        }
    }
}

const registration = run(process.execPath, [
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
    pluginName,
    "--copilot-path",
    copilotPath,
]);
printResult(registration);

if (registration.status !== 0) {
    warn(`Plugin registration failed with exit code ${registration.status}.`);
    process.exit(registration.status ?? 1);
}

const verification = run(copilotPath, ["plugin", "list"]);
const verificationOutput = `${verification.stdout || ""}\n${
    verification.stderr || ""
}`;
if (!hasListedEntry(verificationOutput, `${pluginName}@${marketplaceName}`)) {
    printResult(verification);
    warn(
        "Plugin registration returned success, but the plugin is not installed.",
    );
    process.exit(1);
}

log("Done. The plugin is available in every `copilot` session.");
