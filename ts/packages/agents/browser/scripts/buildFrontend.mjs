#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Smart build wrapper that truly skips builds when nothing has changed
// This runs BEFORE Vite and can exit early if no changes are detected

import { createHash } from "crypto";
import {
    readFileSync,
    writeFileSync,
    existsSync,
    statSync,
    mkdirSync,
} from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const cacheDir = path.join(rootDir, ".build.cache");
const cacheFile = path.join(cacheDir, ".frontend-build-cache.json");

function calculateFileHash(filePath) {
    try {
        if (!existsSync(filePath)) return "";
        const stat = statSync(filePath);
        return `${stat.mtime.getTime()}-${stat.size}`;
    } catch (e) {
        return "";
    }
}

function calculateProjectHash() {
    const hash = createHash("md5");

    // Key files that affect the planVisualizer frontend build
    const keyFiles = [
        // Source files
        "src/views/client/plans/index.html",
        "src/views/client/plans/app.ts",
        "src/views/client/plans/config.ts",
        "src/views/client/plans/apiService.ts",
        "src/views/client/plans/cytoscapeConfig.ts",
        "src/views/client/plans/visualizer.ts",
        "src/views/client/plans/tsconfig.json",
        "package.json",
        "vite.config.mjs",

        // Lock file for dependencies
        "../../../../pnpm-lock.yaml",
        "../../../../package.json",
    ];

    let hashInput = "";
    for (const file of keyFiles) {
        const filePath = path.join(rootDir, file);
        const fileHash = calculateFileHash(filePath);
        hashInput += `${file}:${fileHash};`;
    }

    // Also check CSS directory
    const cssDir = path.join(rootDir, "src/views/client/plans/css");
    if (existsSync(cssDir)) {
        try {
            const files = readdirSync(cssDir, { recursive: true });
            for (const file of files) {
                const filePath = path.join(cssDir, file);
                const fileHash = calculateFileHash(filePath);
                hashInput += `css/${file}:${fileHash};`;
            }
        } catch (e) {
            // Skip if can't read
        }
    }

    return createHash("md5").update(hashInput).digest("hex");
}

function checkOutputExists() {
    const outputDir = path.join(rootDir, "dist/views/public");
    const indexFile = path.join(outputDir, "index.html");
    return existsSync(indexFile);
}

function loadCache() {
    try {
        if (existsSync(cacheFile)) {
            return JSON.parse(readFileSync(cacheFile, "utf8"));
        }
    } catch (e) {
        // Invalid cache
    }
    return null;
}

function saveCache(hash) {
    // Ensure cache directory exists
    if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true });
    }

    const cache = {
        hash,
        timestamp: Date.now(),
        buildTime: new Date().toISOString(),
    };
    writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
}

function runBuild() {
    console.log("🔄 Running Vite build...");
    try {
        execSync("pnpm exec vite build", {
            stdio: "inherit",
            cwd: rootDir,
        });
        console.log("✅ Build completed successfully!");
        return true;
    } catch (error) {
        console.error("❌ Build failed:", error.message);
        return false;
    }
}

// Main logic
function main() {
    const currentHash = calculateProjectHash();
    const cache = loadCache();

    // Check if we can skip the build
    if (cache && cache.hash === currentHash && checkOutputExists()) {
        console.log("🚀 No changes detected, skipping build entirely!");
        console.log(`⚡ Last build: ${cache.buildTime}`);
        process.exit(0);
    }

    // Need to build
    console.log("🔄 Changes detected or no previous build found");

    const buildSuccess = runBuild();

    if (buildSuccess) {
        saveCache(currentHash);
        console.log("📦 Build cache updated");
    }

    process.exit(buildSuccess ? 0 : 1);
}

main();
