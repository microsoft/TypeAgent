#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const tsRoot = path.resolve(scriptsDir, "..", "..");
const upgradeCode = "{12345678-1234-1234-1234-123456789012}";

function getInstalledVersion() {
    if (process.platform !== "win32") {
        return undefined;
    }

    const script = [
        "$ErrorActionPreference = 'Stop'",
        "$installer = New-Object -ComObject WindowsInstaller.Installer",
        `$products = @($installer.RelatedProducts('${upgradeCode}'))`,
        "$versions = foreach ($product in $products) { $installer.ProductInfo($product, 'VersionString') }",
        "$versions | Sort-Object { [version]$_ } -Descending | Select-Object -First 1",
    ].join("; ");
    const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", windowsHide: true },
    );
    const installerVersion = result.stdout?.trim();
    if (result.status === 0 && installerVersion) {
        return installerVersion;
    }

    const registry = spawnSync(
        "reg.exe",
        ["query", "HKCU\\Software\\Microsoft\\TypeAgent", "/v", "Version"],
        { encoding: "utf8", windowsHide: true },
    );
    return registry.stdout?.match(/Version\s+REG_\w+\s+(\S+)/i)?.[1];
}

function nextLocalVersion(installedVersion) {
    if (!installedVersion) {
        return "0.0.1-local";
    }
    const match = installedVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
        return "0.0.1-local";
    }

    const parts = match.slice(1).map(Number);
    parts[2]++;
    for (let index = 2; index > 0; index--) {
        if (parts[index] <= 65534) {
            break;
        }
        parts[index] = 0;
        parts[index - 1]++;
    }
    if (parts[0] > 65534) {
        throw new Error(
            `Installed TypeAgent version is too high to increment: ${installedVersion}`,
        );
    }
    return `${parts.join(".")}-local`;
}

function parseArgs(argv) {
    const args = {
        stageDir: path.join(os.tmpdir(), "typeagent-msi-stage"),
        skipBuild: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--version") args.version = argv[++i];
        else if (arg === "--stage-dir") args.stageDir = argv[++i];
        else if (arg === "--output") args.output = argv[++i];
        else if (arg === "--skip-build") args.skipBuild = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    args.stageDir = path.resolve(args.stageDir);
    args.output = path.resolve(args.output ?? path.join(args.stageDir, "out"));
    if (!args.version) {
        args.installedVersion = getInstalledVersion();
        args.version = nextLocalVersion(args.installedVersion);
    }
    return args;
}

function run(command, commandArgs, cwd = tsRoot) {
    console.log(`> ${command} ${commandArgs.join(" ")}`);
    const result = spawnSync(command, commandArgs, {
        cwd,
        stdio: "inherit",
        shell: process.platform === "win32",
    });
    if (result.status !== 0) {
        throw new Error(`Command failed (${result.status}): ${command}`);
    }
}

function requireWorkspaceDevDependencies() {
    const executableSuffix = process.platform === "win32" ? ".cmd" : "";
    for (const pkg of ["vscode-chat", "vscode-shell"]) {
        const vsce = path.join(
            tsRoot,
            "packages",
            pkg,
            "node_modules",
            ".bin",
            `vsce${executableSuffix}`,
        );
        if (!fs.existsSync(vsce)) {
            throw new Error(
                `Workspace development dependencies are missing for '${pkg}'. A previous production deploy may have replaced node_modules. ` +
                    "Run 'pnpm install' once from ts/, then rerun this command.",
            );
        }
    }
}

const args = parseArgs(process.argv);
const agentDir = path.join(args.stageDir, "agent-server");
const pluginDir = path.join(args.stageDir, "copilot-plugin");
const pnpmStateDir = path.join(args.stageDir, "pnpm-state");
const vscodeChatVsix = path.join(
    tsRoot,
    "packages",
    "vscode-chat",
    "dist-pub",
    "vscode-chat.vsix",
);
const vscodeShellVsix = path.join(
    tsRoot,
    "packages",
    "vscode-shell",
    "dist-pub",
    "vscode-shell.vsix",
);

console.log(`Building local TypeAgent MSI ${args.version}`);
if (args.installedVersion) {
    console.log(`Installed TypeAgent: ${args.installedVersion}`);
}
console.log(`Staging: ${args.stageDir}`);
console.log(`Output:  ${args.output}`);

requireWorkspaceDevDependencies();

if (!args.skipBuild) {
    run("pnpm", ["run", "build"]);
}

// Package tools that require devDependencies before the production deploy.
run("npm", ["run", "package"], path.join(tsRoot, "packages", "vscode-chat"));
run("npm", ["run", "package"], path.join(tsRoot, "packages", "vscode-shell"));
run("node", [
    path.join(scriptsDir, "stageCopilotPlugin.mjs"),
    "--out",
    pluginDir,
]);

fs.rmSync(pnpmStateDir, { recursive: true, force: true });
try {
    run("node", [
        path.join(scriptsDir, "bundleAgentServer.mjs"),
        "--out",
        agentDir,
        "--platform",
        "win32",
        "--arch",
        "x64",
        "--profile",
        "inbox",
        "--external-cli",
        "--pnpm-state-dir",
        pnpmStateDir,
    ]);
} finally {
    // pnpm's legacy deploy can leave workspace dependency status in production
    // mode even when its modules directory is redirected. Match CI by restoring
    // the frozen development install before this command exits.
    run("pnpm", ["install", "--prod=false", "--frozen-lockfile"]);
    fs.rmSync(pnpmStateDir, { recursive: true, force: true });
}

run("node", [
    path.join(scriptsDir, "build-msi.mjs"),
    "--skip-download",
    "--agent-dir",
    agentDir,
    "--plugin-dir",
    pluginDir,
    "--vscode-chat-vsix",
    vscodeChatVsix,
    "--vscode-shell-vsix",
    vscodeShellVsix,
    "--version",
    args.version,
    "--plugin-version",
    args.version,
    "--vscode-chat-version",
    args.version,
    "--vscode-shell-version",
    args.version,
    "--skip-shell-feed-resolution",
    "--output",
    args.output,
]);

console.log(
    `Local MSI ready: ${path.join(args.output, `TypeAgent-${args.version}-win32-x64.msi`)}`,
);
