#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Stage and install this plugin beside the existing TypeAgent Copilot plugin.
 * Uses the same local marketplace so `typeagent` and `typeagent-memory` can
 * both be installed. Staging omits workspace node_modules; the entry points
 * are esbuild bundles.
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(pluginRoot, "..", "..");
const marketplaceName = "typeagent-local";
const pluginName = "typeagent-memory";
const copilotHome = path.resolve(
    process.env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot"),
);
const stagingRoot = path.join(
    os.homedir(),
    ".typeagent-copilot",
    "memory-plugin-stage",
);
const marketplaceRoot = path.join(copilotHome, "marketplaces", marketplaceName);
const registerScript = path.join(
    workspaceRoot,
    "tools",
    "installers",
    "common",
    "register-plugin.mjs",
);
const bundleRoot = path.join(pluginRoot, "dist", "bundle");
const bundleMcpEntry = path.join(bundleRoot, "mcp", "server.js");

const runtimeFiles = [
    ".mcp.json",
    "hooks.json",
    "plugin.json",
    "scripts/launch.mjs",
];
const bundledEntries = [
    ["dist/bundle/hooks/hook-router.js", "dist/bundle/hooks/hook-router.js"],
    ["dist/bundle/hooks/stop-router.js", "dist/bundle/hooks/stop-router.js"],
    ["dist/bundle/mcp/server.js", "dist/bundle/mcp/server.js"],
];

function log(message) {
    process.stdout.write(`[copilot-memory-plugin] ${message}\n`);
}

function warn(message) {
    process.stderr.write(`[copilot-memory-plugin] ${message}\n`);
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

function stage() {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    for (const relative of runtimeFiles) {
        const source = path.join(pluginRoot, relative);
        if (!existsSync(source)) {
            throw new Error(`Missing runtime file: ${source}`);
        }
        const target = path.join(stagingRoot, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
    }
    for (const [sourceRelative, targetRelative] of bundledEntries) {
        const source = path.join(pluginRoot, sourceRelative);
        if (!existsSync(source)) {
            throw new Error(`Missing bundled entry: ${source}`);
        }
        const target = path.join(stagingRoot, targetRelative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        const sourceDir = path.dirname(source);
        const targetDir = path.dirname(target);
        for (const name of fs.readdirSync(sourceDir)) {
            if (!name.endsWith(".ts")) continue;
            fs.copyFileSync(
                path.join(sourceDir, name),
                path.join(targetDir, name),
            );
        }
    }

    fs.cpSync(
        path.join(pluginRoot, "skills"),
        path.join(stagingRoot, "skills"),
        {
            recursive: true,
        },
    );
    const runtime = {
        configDir: workspaceRoot,
        nodePath: path.join(workspaceRoot, "node_modules"),
    };
    fs.writeFileSync(
        path.join(stagingRoot, "runtime.json"),
        JSON.stringify(runtime, null, 2) + "\n",
    );
    const modulesLink = path.join(stagingRoot, "node_modules");
    fs.rmSync(modulesLink, { recursive: true, force: true });
    fs.mkdirSync(path.join(modulesLink, "@huggingface"), { recursive: true });
    const require = createRequire(
        path.join(workspaceRoot, "packages/aiclient/package.json"),
    );
    function packageDir(name) {
        let dir = path.dirname(require.resolve(name));
        while (dir !== path.dirname(dir)) {
            const manifest = path.join(dir, "package.json");
            if (fs.existsSync(manifest)) {
                const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
                if (parsed.name === name) return dir;
            }
            dir = path.dirname(dir);
        }
        throw new Error(`Could not locate package ${name}`);
    }
    const transformersDir = packageDir("@huggingface/transformers");
    const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(
        transformersDir,
        path.join(modulesLink, "@huggingface/transformers"),
        directoryLinkType,
    );
    const onnxDir = path.join(
        path.dirname(path.dirname(transformersDir)),
        "onnxruntime-node",
    );
    if (!fs.existsSync(onnxDir)) {
        throw new Error(
            `Could not locate onnxruntime-node next to ${transformersDir}`,
        );
    }
    fs.symlinkSync(
        onnxDir,
        path.join(modulesLink, "onnxruntime-node"),
        directoryLinkType,
    );
}

if (
    process.argv.includes("--skip-install") ||
    process.env.TYPEAGENT_SKIP_PLUGIN_INSTALL === "1"
) {
    log("Skipping plugin install (opt-out flag set).");
    process.exit(0);
}

const distHook = path.join(bundleRoot, "hooks", "hook-router.js");
const distStop = path.join(bundleRoot, "hooks", "stop-router.js");
if (
    !existsSync(distHook) ||
    !existsSync(distStop) ||
    !existsSync(bundleMcpEntry)
) {
    warn(
        `Built plugin bundle not found under ${bundleRoot}. Run \`pnpm run build @typeagent/copilot-memory-plugin\` from ts/ first.`,
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
stage();
log("Staged runtime files without workspace node_modules.");

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
        pluginName,
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

log("Done. typeagent-memory is available in every `copilot` session.");
