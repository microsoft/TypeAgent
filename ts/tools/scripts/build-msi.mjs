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
 * 3. Zip each artifact dir into a single payload archive (extracted at install time)
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
// Optional TypeAgent Shell download coordinates, baked into the MSI as the
// SHELLBASEURL / SHELLSTORAGE / SHELLCONTAINER / SHELLCHANNEL property defaults
// so the "install the shell" option has a location on a fresh machine.
let shellBaseUrl = "";
let shellStorage = "";
let shellContainer = "";
let shellChannel = "lkg";
// Optional Azure Artifacts Universal Package fallback for the shell download,
// baked into the MSI so the installer can pull the shell from the feed when the
// blob download fails (e.g. the account disallows anonymous access).
let shellFeed = "";
let shellPackage = "";
let shellFeedVersion = "";
let shellOrg = "";
let shellProject = "";

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rid") rid = args[++i];
    else if (args[i] === "--version") version = args[++i];
    else if (args[i] === "--plugin-version") pluginVersion = args[++i];
    else if (args[i] === "--output") outputDir = args[++i];
    else if (args[i] === "--skip-download") skipDownload = true;
    else if (args[i] === "--agent-dir") stagedAgentDir = args[++i];
    else if (args[i] === "--plugin-dir") stagedPluginDir = args[++i];
    else if (args[i] === "--shell-base-url") shellBaseUrl = args[++i];
    else if (args[i] === "--shell-storage") shellStorage = args[++i];
    else if (args[i] === "--shell-container") shellContainer = args[++i];
    else if (args[i] === "--shell-channel") shellChannel = args[++i];
    else if (args[i] === "--shell-feed") shellFeed = args[++i];
    else if (args[i] === "--shell-package") shellPackage = args[++i];
    else if (args[i] === "--shell-feed-version") shellFeedVersion = args[++i];
    else if (args[i] === "--shell-org") shellOrg = args[++i];
    else if (args[i] === "--shell-project") shellProject = args[++i];
}

console.log(`📦 Building TypeAgent MSI`);
console.log(`   RID:            ${rid}`);
console.log(`   Agent version:  ${version}`);
console.log(`   Plugin version: ${pluginVersion}`);
console.log(`   Output:         ${outputDir}`);
if (stagedAgentDir) console.log(`   Agent dir:      ${stagedAgentDir}`);
if (stagedPluginDir) console.log(`   Plugin dir:     ${stagedPluginDir}`);

// The shell download is authenticated: install-shell.ps1 uses `az storage blob
// download --auth-mode login` first, then the Azure Artifacts feed as a
// fallback. We intentionally do NOT derive an anonymous blob base URL here
// (the storage account disallows anonymous access, and org policy requires
// authenticated access). -shell-base-url may still be passed explicitly for a
// public container in standalone scenarios.
if (shellBaseUrl || shellStorage) {
    console.log(`   Shell base URL: ${shellBaseUrl || "(none)"}`);
    console.log(`   Shell storage:  ${shellStorage || "(none)"}/${shellContainer || "(none)"}`);
    console.log(`   Shell channel:  ${shellChannel}`);
}
if (shellFeed && shellPackage) {
    console.log(`   Shell feed:     ${shellFeed} / ${shellPackage} v${shellFeedVersion || "(latest)"}`);
}

if (rid !== "win32-x64") {
    console.error(
        `❌ Unsupported RID for MSI build: ${rid}. Currently supported: win32-x64`,
    );
    process.exit(1);
}

// ── Paths ─────────────────────────────────────────────────────────────────────
const wxsDir = path.resolve(__dirname, "../installers/wix");
const wxsFile = path.join(wxsDir, "TypeAgent-AgentServer.wxs");
const outputPath = path.resolve(outputDir);
const agentArtifactDir = path.join(outputPath, "artifact", "agent-server");
const pluginArtifactDir = path.join(outputPath, "artifact", "copilot-plugin");
const marketplaceDir = path.join(outputPath, "marketplace");
const payloadDir = path.join(outputPath, "payload");
const agentZipFile = path.join(payloadDir, "agent-server.zip");
const pluginZipFile = path.join(payloadDir, "copilot-plugin.zip");

if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────
function runCommand(cmd, cmdArgs, options = {}) {
    console.log(`\n▶ ${cmd} ${cmdArgs.join(" ")}`);

    // Use shell:false so Node passes the exe path directly to CreateProcess,
    // which handles paths with spaces correctly (e.g. WiX under Program Files (x86)).
    // Only az CLI uses shell:true (passed explicitly via options) because it's a
    // script wrapper, not a direct .exe.
    const result = spawnSync(cmd, cmdArgs, {
        stdio: "inherit",
        shell: false,
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
    if (fs.existsSync(targetDir))
        fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(resolvedSource, targetDir, { recursive: true });
    ensureDirHasContent(targetDir, `${label} target`);
    console.log(`✅ Using staged ${label}: ${resolvedSource}`);
}

function downloadArtifact(packageName, ver, targetDir) {
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });

    if (!ver || ver === "" || ver === "latest") {
        console.error(
            `❌ Version must be explicitly specified (got: "${ver}")`,
        );
        console.error(
            `   For the MSI pipeline, queue a build and specify artifact versions.`,
        );
        process.exit(1);
    }

    runCommand(
        "az",
        [
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
        ],
        {
            shell: process.platform === "win32",
        },
    );

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
        prepareFromStagedDir(
            stagedPluginDir,
            pluginArtifactDir,
            "copilot-plugin",
        );
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
const pluginSemverVersion =
    pluginVersion
        .replace(/[^0-9.]/g, ".")
        .replace(/\.{2,}/g, ".")
        .replace(/\.$/, "") || "0.0.1";

function toWixProductVersion(input) {
    // WiX requires 4 numeric parts, each in [0, 65534].
    const parts = (input.match(/\d+/g) ?? ["0", "0", "1", "0"])
        .slice(0, 4)
        .map((n) => Number.parseInt(n, 10) || 0);

    while (parts.length < 4) {
        parts.push(0);
    }

    // Carry overflow from right to left so large build IDs remain representable.
    for (let i = 3; i > 0; i--) {
        const carry = Math.floor(parts[i] / 65535);
        parts[i] = parts[i] % 65535;
        parts[i - 1] += carry;
    }

    // Clamp the major version in the unlikely event of extreme overflow.
    parts[0] = Math.min(parts[0], 65534);

    return parts.join(".");
}

const wixProductVersion = toWixProductVersion(version);
console.log(`   WiX ProductVersion: ${wixProductVersion}`);

const marketplace = {
    name: "typeagent-local",
    owner: { name: "Microsoft", email: "typeagent@microsoft.com" },
    metadata: {
        description: "TypeAgent Copilot CLI plugin",
        version: pluginSemverVersion,
    },
    plugins: [
        {
            name: "typeagent",
            description: "TypeAgent integration for Copilot CLI",
            version: pluginSemverVersion,
            source: "./copilot-plugin",
        },
    ],
};
fs.writeFileSync(
    path.join(marketplaceDir, "marketplace.json"),
    JSON.stringify(marketplace, null, 2),
);
console.log(`✅ Generated marketplace.json`);

// ── Step 3: Zip payload archives ──────────────────────────────────────────────
// Ship agent-server and copilot-plugin as single zip files (one MSI File
// component each) instead of harvesting them with heat (one Component per
// file). A flat node_modules produced tens of thousands of components, which
// made the installer's "Computing space requirements" (CostFinalize) step take
// minutes. A deferred custom action (extract-payload.ps1) unpacks the zips at
// install time.
const candleExe = wixTool("candle.exe");
const lightExe = wixTool("light.exe");

function zipDirectory(sourceDir, zipFile, label) {
    console.log(`\n🗜️  Zipping ${label} -> ${zipFile}...`);
    if (fs.existsSync(zipFile)) fs.rmSync(zipFile);
    const psScript =
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
        // includeBaseDirectory=$false so the zip root holds the payload files
        // directly, and they extract straight into INSTALLFOLDER/PLUGINFOLDER.
        `[System.IO.Compression.ZipFile]::CreateFromDirectory(` +
        `'${sourceDir.replace(/'/g, "''")}', ` +
        `'${zipFile.replace(/'/g, "''")}', ` +
        `[System.IO.Compression.CompressionLevel]::Optimal, $false)`;
    runCommand("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        psScript,
    ]);
    if (!fs.existsSync(zipFile)) {
        console.error(`❌ Failed to create ${label} archive: ${zipFile}`);
        process.exit(1);
    }
    const sizeMb = (fs.statSync(zipFile).size / 1024 / 1024).toFixed(1);
    console.log(`✅ Zipped ${label}: ${zipFile} (${sizeMb} MB)`);
}

fs.mkdirSync(payloadDir, { recursive: true });
zipDirectory(agentArtifactDir, agentZipFile, "agent-server");
zipDirectory(pluginArtifactDir, pluginZipFile, "copilot-plugin");

// ── Step 4: Compile WiX (candle.exe) ─────────────────────────────────────────
console.log(`\n🕯️  Compiling WiX...`);

const wixobjDir = outputPath;
runCommand(candleExe, [
    `-dProductVersion=${wixProductVersion}`,
    `-dAgentServerZip=${agentZipFile}`,
    `-dCopilotPluginZip=${pluginZipFile}`,
    `-dMarketplaceDir=${marketplaceDir}`,
    `-dInstallerSourceDir=${wxsDir}`,
    `-dShellBaseUrl=${shellBaseUrl}`,
    `-dShellStorage=${shellStorage}`,
    `-dShellContainer=${shellContainer}`,
    `-dShellChannel=${shellChannel}`,
    `-dShellFeed=${shellFeed}`,
    `-dShellPackage=${shellPackage}`,
    `-dShellFeedVersion=${shellFeedVersion}`,
    `-dShellOrg=${shellOrg}`,
    `-dShellProject=${shellProject}`,
    `-arch`,
    `x64`,
    `-o`,
    `${wixobjDir}\\`,
    wxsFile,
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
    // Per-user install under LocalAppData intentionally uses File keypaths on
    // the payload components, which triggers ICE38; suppress that specific ICE.
    `-sice:ICE38`,
    // ICE64 flags user-profile directories that lack a RemoveFile entry
    // (INSTALLFOLDER/PLUGINFOLDER are populated at runtime by ExtractPayload and
    // cleaned up by CleanupPayload); safe to suppress for this per-user install.
    `-sice:ICE64`,
    `-cultures:en-us`,
    `-o`,
    msiOutputPath,
    path.join(wixobjDir, "TypeAgent-AgentServer.wixobj"),
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
