#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation. Licensed under the MIT License.

/**
 * sign-msi.mjs
 *
 * Signs a TypeAgent MSI using the development certificate from Key Vault.
 *
 * Steps:
 * 1. Invoke getCert.mjs to pull cert from aisystems vault
 * 2. Sign the MSI with signtool.exe
 * 3. Verify the signature
 *
 * Usage:
 *   node sign-msi.mjs path/to/TypeAgent-AgentServer.msi
 *   node sign-msi.mjs path/to/TypeAgent-AgentServer.msi --verify-only
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const config = require("./getKeys.config.json");

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error("Usage: node sign-msi.mjs <msi-path> [--verify-only]");
    process.exit(1);
}

const msiPath = path.resolve(args[0]);
const verifyOnly = args.includes("--verify-only");

if (!fs.existsSync(msiPath)) {
    console.error(`❌ MSI file not found: ${msiPath}`);
    process.exit(1);
}

console.log(`🔐 Signing TypeAgent MSI`);
console.log(`   File: ${msiPath}`);
console.log(
    `   Size: ${(fs.statSync(msiPath).size / 1024 / 1024).toFixed(2)} MB`,
);

function runCommand(cmd, args, options = {}) {
    const result = spawnSync(cmd, args, {
        stdio: "inherit",
        shell: false,
        ...options,
    });
    if (result.error) {
        console.error(`❌ Command failed: ${result.error.message}`);
        return false;
    }
    return result.status === 0;
}

function resolveCertPassword() {
    // Use getCert.mjs get-password so auth goes through the same Azure SDK
    // credential chain that pull already uses — az CLI child processes don't
    // inherit the AzureCLI@2 task auth context reliably.
    console.log(`   Resolving cert password via getCert.mjs get-password...`);
    const result = spawnSync(
        "node",
        [path.join(__dirname, "getCert.mjs"), "get-password"],
        { encoding: "utf8" },
    );

    if (result.status !== 0) {
        const fromEnv = process.env.MSI_SIGNING_CERT_PASSWORD?.trim();
        if (fromEnv) {
            console.warn(
                "⚠️  getCert.mjs get-password failed; falling back to MSI_SIGNING_CERT_PASSWORD.",
            );
            return fromEnv;
        }
        const certVaultName = config?.cert?.vault ?? "aisystems";
        const passwordSecretName =
            config?.cert?.passwordSecretName ??
            "TypeAgent-Development-Certificate-Password";
        console.error(
            `❌ Could not resolve MSI certificate password. Ensure az is logged in and can read '${passwordSecretName}' from vault '${certVaultName}'.`,
        );
        if (result.stderr) {
            console.error(result.stderr.trim());
        }
        process.exit(1);
    }

    // getCert can emit extra login/status lines in CI; extract the temp file path line.
    const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const lines = combinedOutput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const pathLikeLine = [...lines]
        .reverse()
        .find((line) => /^[A-Za-z]:\\.+\.txt$/i.test(line));
    const tmpFilePath = pathLikeLine ?? result.stdout?.trim();
    if (!tmpFilePath || !fs.existsSync(tmpFilePath)) {
        console.error(`❌ getCert.mjs get-password succeeded but temp file not found: ${tmpFilePath}`);
        process.exit(1);
    }

    try {
        const password = fs.readFileSync(tmpFilePath, "utf8").trim();
        fs.unlinkSync(tmpFilePath);
        return password;
    } catch (e) {
        console.error(`❌ Failed to read password from temp file: ${e.message}`);
        process.exit(1);
    }
}


// Step 1: Pull cert from Key Vault (unless verify-only)
if (!verifyOnly) {
    console.log(`\n📥 Pulling TypeAgent dev certificate from Key Vault...`);
    const getCertResult = spawnSync("node", [
        path.join(__dirname, "getCert.mjs"),
        "pull",
    ]);
    if (getCertResult.status !== 0) {
        console.error(`❌ Failed to pull certificate from Key Vault`);
        process.exit(1);
    }
    console.log(`✅ Certificate retrieved`);
}

// Step 2: Sign the MSI
if (!verifyOnly) {
    console.log(`\n✍️  Signing MSI with TypeAgent-Development-Certificate...`);

    const certPassword = resolveCertPassword();
    const pfxPath = path.join(
        os.homedir(),
        ".typeagent/TypeAgent-Development-Certificate.pfx",
    );

    if (!fs.existsSync(pfxPath)) {
        console.error(
            `❌ Certificate not found: ${pfxPath}. Run 'node getCert.mjs pull' first.`,
        );
        process.exit(1);
    }

    // Find signtool.exe (from Windows SDK)
    const signtoolPaths = [
        "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\signtool.exe",
        "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\x64\\signtool.exe",
        "C:\\Program Files (x86)\\Windows Kits\\8.1\\bin\\x64\\signtool.exe",
    ];
    let signtoolExe = null;
    for (const p of signtoolPaths) {
        if (fs.existsSync(p)) {
            signtoolExe = p;
            break;
        }
    }

    if (!signtoolExe) {
        // Try to find it via PATH
        const pathTest = spawnSync("where", ["signtool.exe"], {
            encoding: "utf8",
        });
        if (pathTest.status === 0 && pathTest.stdout) {
            signtoolExe = pathTest.stdout.trim().split("\n")[0];
        }
    }

    if (!signtoolExe) {
        console.error(
            `❌ signtool.exe not found. Install Windows SDK or ensure it's on PATH.`,
        );
        process.exit(1);
    }

    console.log(`   Using: ${signtoolExe}`);

    if (
        !runCommand(signtoolExe, [
            "sign",
            "/fd",
            "SHA256",
            "/a",
            "/f",
            pfxPath,
            "/p",
            certPassword,
            "/t",
            "http://timestamp.digicert.com",
            msiPath,
        ])
    ) {
        console.error(`❌ Failed to sign MSI`);
        process.exit(1);
    }

    console.log(`✅ MSI signed successfully`);
}

// Step 3: Verify signature
console.log(`\n✔️  Verifying signature...`);
const signtoolPaths = [
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\signtool.exe",
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\x64\\signtool.exe",
    "C:\\Program Files (x86)\\Windows Kits\\8.1\\bin\\x64\\signtool.exe",
];
let signtoolExe = null;
for (const p of signtoolPaths) {
    if (fs.existsSync(p)) {
        signtoolExe = p;
        break;
    }
}

if (signtoolExe) {
    if (runCommand(signtoolExe, ["verify", "/pa", msiPath])) {
        console.log(`✅ Signature verified successfully`);
    } else {
        console.warn(
            `⚠️  Signature verification had issues (may be OK for self-signed)`,
        );
    }
} else {
    console.warn(`⚠️  signtool.exe not found for verification`);
}

console.log(`\n✅ MSI signing complete!`);
console.log(`   File: ${msiPath}`);
console.log(`   Ready for distribution`);

process.exit(0);
