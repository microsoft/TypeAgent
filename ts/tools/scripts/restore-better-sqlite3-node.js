// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Restore the Node.js-compatible better-sqlite3 binary to build/Release/.
//
// Problem: packages/shell postinstall runs electron-builder install-app-deps,
// which rebuilds better-sqlite3 for Electron (wrong ABI for Node.js agent
// processes like email, kp, code, etc.).
//
// The companion copy-better-sqlite3-node.js saves the correct Node.js binary
// to prebuild-node/ BEFORE electron-builder wipes build/Release/.  This script
// runs AFTER and restores prebuild-node/ → build/Release/ so that Node.js
// agent processes get the right binary.
//
// Both scripts run as part of the root postinstall (which executes after all
// workspace package postinstalls, including shell's electron-builder step).

const fs = require("fs");
const path = require("path");

function isNodeCompatible(binaryPath) {
    try {
        process.dlopen({ exports: {} }, binaryPath);
        return true;
    } catch {
        return false;
    }
}

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

    const src = path.join(pkgDir, "prebuild-node", "better_sqlite3.node");
    const dst = path.join(pkgDir, "build", "Release", "better_sqlite3.node");

    if (!fs.existsSync(src)) {
        console.warn(
            `⚠️  No prebuild-node binary for ${entry} — skipping restore`,
        );
        continue;
    }

    // If build/Release/ is already Node-compatible, nothing to do
    if (fs.existsSync(dst) && isNodeCompatible(dst)) {
        console.log(`✅ ${entry}: build/Release already Node-compatible`);
        continue;
    }

    try {
        fs.mkdirSync(path.join(pkgDir, "build", "Release"), {
            recursive: true,
        });
        fs.copyFileSync(src, dst);
        console.log(`✅ ${entry}: restored Node.js binary → build/Release/`);
    } catch (e) {
        console.error(`❌ Failed to restore ${entry}:`, e.message);
        hasError = true;
    }
}

if (hasError) {
    process.exit(1);
}
