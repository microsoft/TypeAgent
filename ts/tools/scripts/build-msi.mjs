#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation. Licensed under the MIT License.

/**
 * build-msi.mjs
 *
 * Orchestrates the TypeAgent MSI build:
 * 1. Resolve artifact inputs (pipeline default: pre-staged local directories via --skip-download)
 * 2. Generate marketplace.json for Copilot CLI plugin registration
 * 3. Harvest file components with heat.exe (one pass per artifact dir)
 * 4. Compile WiX (candle) + link to MSI (light)
 *
 * Usage:
 *   node build-msi.mjs --rid win32-x64 --version 0.0.1-12345 --output ./out
 *   node build-msi.mjs --rid win32-x64 --version 0.0.1-12345 --plugin-version 0.0.1-12345
 *   node build-msi.mjs --skip-download --agent-dir ./agent-server --plugin-dir ./copilot-plugin --version 0.0.1-test --plugin-version 0.0.1-test --output ./out
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Argument parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let rid = "win32-x64";
let version = "latest";
let pluginVersion = "latest";
let outputDir = "./msi-out";
let skipDownload = false;
let stagedAgentDir = "";
let stagedPluginDir = "";

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rid") rid = args[++i];
    else if (args[i] === "--version") version = args[++i];
    else if (args[i] === "--plugin-version") pluginVersion = args[++i];
    else if (args[i] === "--output") outputDir = args[++i];
    else if (args[i] === "--skip-download") skipDownload = true;
    else if (args[i] === "--agent-dir") stagedAgentDir = args[++i];
    else if (args[i] === "--plugin-dir") stagedPluginDir = args[++i];
}

console.log(`📦 Building TypeAgent MSI`);
console.log(`   RID:            ${rid}`);
console.log(`   Agent version:  ${version}`);
console.log(`   Plugin version: ${pluginVersion}`);
console.log(`   Output:         ${outputDir}`);
if (stagedAgentDir) console.log(`   Agent dir:      ${stagedAgentDir}`);
if (stagedPluginDir) console.log(`   Plugin dir:     ${stagedPluginDir}`);

// ── Paths ─────────────────────────────────────────────────────────────────────
const wxsDir = path.resolve(__dirname, "../installers/wix");
const wxsFile = path.join(wxsDir, "TypeAgent-AgentServer.wxs");
const outputPath = path.resolve(outputDir);
const agentArtifactDir = path.join(outputPath, "artifact", "agent-server");
const pluginArtifactDir = path.join(outputPath, "artifact", "copilot-plugin");
const marketplaceDir = path.join(outputPath, "marketplace");
const agentHeatFile = path.join(outputPath, "AgentServerFiles.wxs");
const pluginHeatFile = path.join(outputPath, "CopilotPluginFiles.wxs");

if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────
function runCommand(cmd, cmdArgs, options = {}) {
    console.log(`\n▶ ${cmd} ${cmdArgs.join(" ")}`);
    const result = spawnSync(cmd, cmdArgs, {
        stdio: "inherit",
        shell: process.platform === "win32",
        ...options,
    });
    if (result.error) {
        console.error(`❌ Command failed: ${result.error.message}`);
        process.exit(1);
    }
    if (result.status !== 0) {
        console.error(`❌ Command exited with code ${result.status}`);
        process.exit(1);
    }
    return result;
}

function findExe(candidates) {
    return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function discoverWixBinDirs() {
    const roots = ["C:\\Program Files (x86)", "C:\\Program Files"];
    const dirs = [];
    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            if (/^WiX Toolset v3(\.|$)/i.test(entry.name)) {
                const bin = path.join(root, entry.name, "bin");
                if (fs.existsSync(bin)) dirs.push(bin);
            }
        }
    }
    return dirs;
}

const WIX_PATHS = discoverWixBinDirs();

function wixTool(name) {
    if (WIX_PATHS.length === 0) {
        console.error(
            "❌ No WiX Toolset v3.x installation found. Install from https://github.com/wixtoolset/wix3/releases",
        );
        process.exit(1);
    }
    const found = findExe(WIX_PATHS.map((d) => path.join(d, name)));
    if (!found) {
        console.error(`❌ ${name} not found in: ${WIX_PATHS.join(", ")}`);
        process.exit(1);
    }
    return found;
}

function ensureDirHasContent(dir, label) {
    if (!fs.existsSync(dir)) {
        console.error(`❌ ${label} dir not found: ${dir}`);
        process.exit(1);
    }
    const entries = fs.readdirSync(dir);
    if (entries.length === 0) {
        console.error(`❌ ${label} dir is empty: ${dir}`);
        process.exit(1);
    }
}

function prepareFromStagedDir(sourceDir, targetDir, label) {
    const resolvedSource = path.resolve(sourceDir);
    ensureDirHasContent(resolvedSource, `${label} source`);
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(resolvedSource, targetDir, { recursive: true });
    ensureDirHasContent(targetDir, `${label} target`);
    console.log(`✅ Using staged ${label}: ${resolvedSource}`);
}

function downloadArtifact(packageName, ver, targetDir) {
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });

    if (!ver || ver === "" || ver === "latest") {
        console.error(`❌ Version must be explicitly specified (got: "${ver}")`);
        console.error(`   For the MSI pipeline, queue a build and specify artifact versions.`);
        process.exit(1);
    }

    runCommand("az", [
        "artifacts",
        "universal",
        "download",
        "--organization",
        "https://dev.azure.com/msctoproj",
        "--project",
        "AI_Systems",
        "--scope",
        "project",
        "--feed",
        "typeagent",
        "--name",
        packageName,
        "--version",
        ver,
        "--path",
        targetDir,
    ], {
        shell: process.platform === "win32",
    });

    const files = fs.readdirSync(targetDir);
    if (files.length === 0) {
        console.error(`❌ Artifact download failed: ${targetDir} is empty`);
        process.exit(1);
    }
    console.log(`✅ Downloaded ${packageName}: ${files.length} items`);
}

// ── Step 1: Download artifacts ────────────────────────────────────────────────
if (!skipDownload) {
    console.log(`\n📥 Downloading agent-server.${rid}...`);
    downloadArtifact(`agent-server.${rid}`, version, agentArtifactDir);

    console.log(`\n📥 Downloading typeagent-copilot-plugin...`);
    downloadArtifact(
        "typeagent-copilot-plugin",
        pluginVersion,
        pluginArtifactDir,
    );
} else {
    if (stagedAgentDir) {
        prepareFromStagedDir(stagedAgentDir, agentArtifactDir, "agent-server");
    }
    if (stagedPluginDir) {
        prepareFromStagedDir(stagedPluginDir, pluginArtifactDir, "copilot-plugin");
    }

    for (const [label, dir] of [
        ["agent-server", agentArtifactDir],
        ["copilot-plugin", pluginArtifactDir],
    ]) {
        if (!fs.existsSync(dir)) {
            console.error(
                `❌ --skip-download set but ${label} dir not found: ${dir}`,
            );
            process.exit(1);
        }
        console.log(`⏭️  Skipping download, using: ${dir}`);
    }
}

// ── Step 2: Generate marketplace.json ─────────────────────────────────────────
console.log(`\n📝 Generating marketplace.json...`);
fs.mkdirSync(marketplaceDir, { recursive: true });
const semverVersion =
    version
        .replace(/[^0-9.]/g, ".")
        .replace(/\.{2,}/g, ".")
        .replace(/\.$/, "") || "0.0.1";
const marketplace = {
    name: "typeagent-local",
    owner: { name: "Microsoft", email: "typeagent@microsoft.com" },
    metadata: {
        description: "TypeAgent Copilot CLI plugin",
        version: semverVersion,
    },
    plugins: [
        {
            name: "typeagent",
            description: "TypeAgent integration for Copilot CLI",
            version: semverVersion,
            source: "./copilot-plugin",
        },
    ],
};
fs.writeFileSync(
    path.join(marketplaceDir, "marketplace.json"),
    JSON.stringify(marketplace, null, 2),
);
console.log(`✅ Generated marketplace.json`);

// ── Step 3: Harvest file components with heat.exe ─────────────────────────────
const heatExe = wixTool("heat.exe");
const candleExe = wixTool("candle.exe");
const lightExe = wixTool("light.exe");

function runHeat(dir, componentGroup, dirRef, varName, outFile) {
    console.log(`\n🔥 Harvesting ${componentGroup} from ${dir}...`);
    runCommand(heatExe, [
        "dir",
        dir,
        "-cg",
        componentGroup,
        "-dr",
        dirRef,
        "-var",
        `var.${varName}`,
        "-gg", // generate stable GUIDs per file path
        "-srd", // suppress root directory element
        "-sfrag", // suppress fragment wrapping (use our own Product.wxs structure)
        "-indent",
        "2",
        "-o",
        outFile,
    ]);
    console.log(`✅ Harvested: ${outFile}`);
}

runHeat(
    agentArtifactDir,
    "AgentServerComponents",
    "INSTALLFOLDER",
    "AgentServerArtifactDir",
    agentHeatFile,
);
runHeat(
    pluginArtifactDir,
    "CopilotPluginComponents",
    "PLUGINFOLDER",
    "CopilotPluginArtifactDir",
    pluginHeatFile,
);

// ── Step 4: Compile WiX (candle.exe) ─────────────────────────────────────────
console.log(`\n🕯️  Compiling WiX...`);

const wixobjDir = outputPath;
runCommand(candleExe, [
    `-dProductVersion=${version}`,
    `-dAgentServerArtifactDir=${agentArtifactDir}`,
    `-dCopilotPluginArtifactDir=${pluginArtifactDir}`,
    `-dMarketplaceDir=${marketplaceDir}`,
    `-dInstallerSourceDir=${wxsDir}`,
    `-arch`,
    `x64`,
    `-o`,
    `${wixobjDir}\\`,
    wxsFile,
    agentHeatFile,
    pluginHeatFile,
]);
console.log(`✅ Compiled WiX objects`);

// ── Step 5: Link MSI (light.exe) ──────────────────────────────────────────────
console.log(`\n💡 Linking MSI...`);

const msiName = `TypeAgent-${version}-${rid}.msi`;
const msiOutputPath = path.join(outputPath, msiName);

runCommand(lightExe, [
    `-ext`,
    `WixUIExtension`,
    `-ext`,
    `WixUtilExtension`,
    `-cultures:en-us`,
    `-o`,
    msiOutputPath,
    path.join(wixobjDir, "TypeAgent-AgentServer.wixobj"),
    path.join(wixobjDir, "AgentServerFiles.wixobj"),
    path.join(wixobjDir, "CopilotPluginFiles.wixobj"),
]);

if (!fs.existsSync(msiOutputPath)) {
    console.error(`❌ MSI build failed: output file not created`);
    process.exit(1);
}

const sizeMb = (fs.statSync(msiOutputPath).size / 1024 / 1024).toFixed(1);
console.log(`\n✅ MSI build complete!`);
console.log(`   Output: ${msiOutputPath} (${sizeMb} MB)`);
console.log(`   Sign:   node sign-msi.mjs "${msiOutputPath}"`);

process.exit(0);
