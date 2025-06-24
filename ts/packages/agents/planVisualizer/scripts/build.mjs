#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Cached build wrapper for browser-typeagent
// Skips compilation when no source files have changed

import { createHash } from "crypto";
import {
    readFileSync,
    writeFileSync,
    existsSync,
    statSync,
    readdirSync,
} from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

function calculateFileHash(filePath) {
    try {
        if (!existsSync(filePath)) return "";
        const stat = statSync(filePath);
        return `${stat.mtime.getTime()}-${stat.size}`;
    } catch (e) {
        return "";
    }
}

function calculateProjectHash(taskName) {
    const hash = createHash("md5");

    // File sets for planVisualizer tasks
    const taskFiles = {
        shared: [
            "src/view/shared/**/*.ts",
            "src/view/shared/tsconfig.json",
            "tsconfig.json",
            "../../../tsconfig.base.json",
        ],
        agent: [
            "src/agent/**/*.ts",
            "src/agent/tsconfig.json",
            "../../../tsconfig.base.json",
        ],
        server: [
            "src/view/server/**/*.ts",
            "src/view/shared/**/*.ts", // server depends on shared
            "src/view/server/tsconfig.json",
            "tsconfig.json",
            "../../../tsconfig.base.json",
        ],
    };

    const filesToCheck = taskFiles[taskName] || taskFiles["shared"];
    let hashInput = "";

    for (const pattern of filesToCheck) {
        if (pattern.includes("**")) {
            // Handle glob patterns
            const basePath = pattern.replace("/**/*.ts", "");
            const fullPath = path.join(rootDir, basePath);

            if (existsSync(fullPath)) {
                try {
                    const files = readdirSync(fullPath, { recursive: true });
                    for (const file of files) {
                        if (file.endsWith(".ts") || file.endsWith(".json")) {
                            const filePath = path.join(fullPath, file);
                            const fileHash = calculateFileHash(filePath);
                            hashInput += `${file}:${fileHash};`;
                        }
                    }
                } catch (e) {
                    // Skip directories we can't read
                }
            }
        } else {
            // Handle single files
            const filePath = path.join(rootDir, pattern);
            const fileHash = calculateFileHash(filePath);
            hashInput += `${pattern}:${fileHash};`;
        }
    }

    return createHash("md5").update(hashInput).digest("hex");
}

function checkTSBuildInfoExists(taskName) {
    const tsbuildInfoFiles = {
        shared: ".tsbuildinfo/shared.tsbuildinfo",
        agent: ".tsbuildinfo/agent.tsbuildinfo",
        server: ".tsbuildinfo/server.tsbuildinfo",
    };

    const tsbuildInfoFile = tsbuildInfoFiles[taskName];
    if (!tsbuildInfoFile) return false;

    const fullPath = path.join(rootDir, tsbuildInfoFile);
    return existsSync(fullPath);
}

function loadCache(taskName) {
    const cacheFile = path.join(rootDir, `.tsc-cache-${taskName}.json`);
    try {
        if (existsSync(cacheFile)) {
            return JSON.parse(readFileSync(cacheFile, "utf8"));
        }
    } catch (e) {
        // Invalid cache
    }
    return null;
}

function saveCache(taskName, hash) {
    const cacheFile = path.join(rootDir, `.tsc-cache-${taskName}.json`);
    const cache = {
        hash,
        timestamp: Date.now(),
        buildTime: new Date().toISOString(),
    };
    writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
}

function runTSC(command) {
    console.log(`🔄 Running: ${command}`);
    try {
        execSync(command, {
            stdio: "inherit",
            cwd: rootDir,
        });
        console.log("✅ Build completed!");
        return true;
    } catch (error) {
        console.error("❌ Build failed:", error.message);
        return false;
    }
}

// Main logic
function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error("Usage: node build.mjs <task> <build-command>");
        console.error(
            'Example: node build.mjs shared "tsc --build src/view/shared/tsconfig.json"',
        );
        process.exit(1);
    }

    const taskName = args[0];
    const tscCommand = args.slice(1).join(" ");

    const currentHash = calculateProjectHash(taskName);
    const cache = loadCache(taskName);

    // Check if we can skip the build
    if (
        cache &&
        cache.hash === currentHash &&
        checkTSBuildInfoExists(taskName)
    ) {
        console.log(`🚀 No changes detected for ${taskName}, skipping build!`);
        console.log(`⚡ Last build: ${cache.buildTime}`);
        process.exit(0);
    }

    // Need to build
    console.log(`🔄 Changes detected for ${taskName}, running build...`);

    const buildSuccess = runTSC(tscCommand);

    if (buildSuccess) {
        saveCache(taskName, currentHash);
        console.log(`📦 ${taskName} build cache updated`);
    }

    process.exit(buildSuccess ? 0 : 1);
}

main();
