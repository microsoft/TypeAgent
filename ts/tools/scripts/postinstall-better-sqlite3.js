// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Postinstall script for better-sqlite3 to handle prebuilt binaries
 * This script reorganizes the better-sqlite3 build directory structure
 * to support both standard Node.js and Electron environments
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const betterSqlite3Path = path.join(
    __dirname,
    "../../node_modules/.pnpm/node_modules/better-sqlite3",
);

// Check if better-sqlite3 exists in node_modules
if (!fs.existsSync(betterSqlite3Path)) {
    console.log("[postinstall] better-sqlite3 not found, skipping postinstall");
    process.exit(0);
}

const buildPath = path.join(betterSqlite3Path, "build");
const releasePath = path.join(buildPath, "Release");
const releaseNodePath = path.join(buildPath, "Release-Node");
const binaryFile = "better_sqlite3.node";
const sourceBinary = path.join(releasePath, binaryFile);
const targetBinary = path.join(releaseNodePath, binaryFile);

console.log("[postinstall] Setting up better-sqlite3 binaries...");

try {
    // If Release-Node already exists and has the binary, we're done
    if (fs.existsSync(targetBinary)) {
        console.log(
            "[postinstall] better-sqlite3 already configured, skipping",
        );
        process.exit(0);
    }

    // Clean build directory if it exists (with retry for Windows file locking)
    if (fs.existsSync(buildPath)) {
        console.log("[postinstall] Cleaning existing build directory...");
        let retries = 3;
        while (retries > 0) {
            try {
                fs.rmSync(buildPath, {
                    recursive: true,
                    force: true,
                    maxRetries: 3,
                });
                break;
            } catch (err) {
                retries--;
                if (retries === 0) {
                    // If we can't delete, it might be in use - try to work around it
                    console.warn(
                        "[postinstall] Warning: Could not clean build directory, attempting to work around it...",
                    );
                    if (!fs.existsSync(releasePath)) {
                        console.error(
                            "[postinstall] Error: Release directory does not exist and could not be cleaned",
                        );
                        process.exit(1);
                    }
                    break;
                }
                // Wait a bit before retrying (Windows file locking)
                console.log(
                    `[postinstall] Retrying clean (${retries} attempts left)...`,
                );
                execSync("ping 127.0.0.1 -n 2 > nul", { stdio: "ignore" }); // 1 second delay on Windows
            }
        }
    }

    // Run prebuild-install to get the prebuilt binary
    console.log("[postinstall] Running prebuild-install...");
    try {
        execSync("pnpm exec prebuild-install", {
            cwd: betterSqlite3Path,
            stdio: "inherit",
        });
    } catch (err) {
        console.warn(
            "[postinstall] prebuild-install failed, this is OK if building from source",
        );
    }

    // Create Release-Node directory if it doesn't exist
    if (!fs.existsSync(releaseNodePath)) {
        console.log("[postinstall] Creating Release-Node directory...");
        fs.mkdirSync(releaseNodePath, { recursive: true });
    }

    // Copy the binary from Release to Release-Node
    if (fs.existsSync(sourceBinary)) {
        console.log("[postinstall] Copying binary to Release-Node...");
        fs.copyFileSync(sourceBinary, targetBinary);
        console.log("[postinstall] better-sqlite3 setup complete!");
    } else {
        console.warn(
            "[postinstall] Warning: Could not find prebuilt binary, this may be expected if building from source",
        );
    }

    process.exit(0);
} catch (err) {
    console.error(
        "[postinstall] Error during better-sqlite3 setup:",
        err.message,
    );
    // Don't fail the install if this doesn't work - better-sqlite3 might still work
    console.log("[postinstall] Continuing despite error...");
    process.exit(0);
}
