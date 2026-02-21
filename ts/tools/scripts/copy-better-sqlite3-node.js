// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Save the Node.js-compatible better-sqlite3 native binary to a safe location.
//
// Problem: electron-builder's install-app-deps (in packages/shell postinstall)
// rebuilds better-sqlite3 for Electron, wiping the entire build/ directory.
// This runs in the root postinstall BEFORE electron-builder, so we save the
// correct Node.js binary to prebuild-node/ (outside build/) where
// electron-builder won't touch it.
//
// If the binary in build/Release/ is already for Electron (wrong ABI), we
// re-download the correct Node.js prebuilt via prebuild-install.
//
// Works with pnpm's store layout on Windows, macOS, and Linux.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const expectedABI = process.versions.modules; // e.g. "127" for Node 22

function isNodeCompatible(binaryPath) {
    try {
        process.dlopen({ exports: {} }, binaryPath);
        return true;
    } catch {
        return false;
    }
}

// Find all better-sqlite3 installations in the pnpm store
const pnpmDir = path.resolve(__dirname, "..", "..", "node_modules", ".pnpm");
const entries = fs
    .readdirSync(pnpmDir)
    .filter((e) => e.startsWith("better-sqlite3@"));

if (entries.length === 0) {
    console.error("No better-sqlite3 installations found in", pnpmDir);
    process.exit(1);
}

let hasError = false;

for (const entry of entries) {
    const pkgDir = path.join(pnpmDir, entry, "node_modules", "better-sqlite3");
    if (!fs.existsSync(path.join(pkgDir, "package.json"))) {
        continue;
    }

    console.log(`\n📦 Processing ${entry}:`);
    console.log("   ", pkgDir);

    const dstDir = path.join(pkgDir, "prebuild-node");
    const dst = path.join(dstDir, "better_sqlite3.node");

    // If prebuild-node/ already has a compatible binary, skip
    if (fs.existsSync(dst) && isNodeCompatible(dst)) {
        console.log(
            "✅ Already has compatible Node.js binary in prebuild-node/",
        );
        continue;
    }

    const releaseBinary = path.join(
        pkgDir,
        "build",
        "Release",
        "better_sqlite3.node",
    );

    // If build/Release/ has a compatible Node.js binary, just copy it
    if (fs.existsSync(releaseBinary) && isNodeCompatible(releaseBinary)) {
        fs.mkdirSync(dstDir, { recursive: true });
        fs.copyFileSync(releaseBinary, dst);
        console.log("✅ Copied compatible binary from build/Release/");
        console.log(" → ", dst);
        continue;
    }

    // Binary is missing or wrong ABI (e.g. Electron) — re-download for Node.js
    console.log(
        "⬇️  Downloading Node.js-compatible prebuilt via prebuild-install...",
    );
    const tempBuildDir = path.join(pkgDir, "build-node-temp");
    try {
        // prebuild-install writes to build/Release/, so use a temp dir
        // to avoid disturbing any existing Electron binary
        fs.rmSync(tempBuildDir, { recursive: true, force: true });
        const origBuild = path.join(pkgDir, "build");
        const hasBuild = fs.existsSync(origBuild);
        if (hasBuild) {
            fs.renameSync(origBuild, tempBuildDir);
        }
        try {
            execFileSync(
                process.execPath,
                [
                    require.resolve("prebuild-install/bin"),
                    "--runtime",
                    "node",
                    "--target",
                    process.version,
                ],
                {
                    cwd: pkgDir,
                    stdio: "inherit",
                },
            );

            const downloaded = path.join(
                pkgDir,
                "build",
                "Release",
                "better_sqlite3.node",
            );
            if (!fs.existsSync(downloaded)) {
                throw new Error("prebuild-install did not produce a binary");
            }

            fs.mkdirSync(dstDir, { recursive: true });
            fs.copyFileSync(downloaded, dst);
            console.log("✅ Node.js binary saved to prebuild-node/");

            // Remove the temp build dir created by prebuild-install
            fs.rmSync(path.join(pkgDir, "build"), {
                recursive: true,
                force: true,
            });
        } finally {
            // Restore original build dir (may contain Electron binary)
            if (hasBuild) {
                if (!fs.existsSync(origBuild)) {
                    fs.renameSync(tempBuildDir, origBuild);
                } else {
                    fs.rmSync(tempBuildDir, { recursive: true, force: true });
                }
            }
        }
    } catch (e) {
        console.error(`❌ Failed for ${entry}:`, e.message);
        fs.rmSync(tempBuildDir, { recursive: true, force: true });
        hasError = true;
        continue;
    }
}

if (hasError) {
    process.exit(1);
}
