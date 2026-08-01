#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { fileMetrics, readJson } from "./bundleUtils.mjs";

function getBackgroundResources() {
    return process
        .getActiveResourcesInfo()
        .filter((resource) => !["PipeWrap", "TTYWrap"].includes(resource));
}

function parseArgs(argv) {
    const args = { maxFiles: 7000 };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--dir") args.dir = argv[++i];
        else if (arg === "--max-files") args.maxFiles = Number(argv[++i]);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!args.dir) {
        throw new Error("Missing --dir <artifact>.");
    }
    args.dir = path.resolve(args.dir);
    return args;
}

function findDevelopmentFiles(root) {
    const bad = [];
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (
                entry.isFile() &&
                (/\.d\.(?:ts|mts|cts)(?:\.map)?$/i.test(entry.name) ||
                    /\.(?:js|mjs|cjs|css)\.map$/i.test(entry.name) ||
                    /\.tsbuildinfo$/i.test(entry.name))
            ) {
                bad.push(full);
            }
        }
    }
    return bad;
}

async function validateAgents(root) {
    const require = createRequire(
        path.join(root, "default-agent-provider", "package.json"),
    );
    const distribution = readJson(
        path.join(root, "node_modules", ".typeagent-agents.json"),
    );
    for (const agent of distribution.agents) {
        const resourcesBefore = getBackgroundResources();
        const manifest = require(`${agent.packageName}/agent/manifest`);
        if (!manifest || typeof manifest !== "object") {
            throw new Error(`${agent.packageName}: manifest did not load.`);
        }
        const handler = require.resolve(`${agent.packageName}/agent/handlers`);
        const module = await import(pathToFileURL(handler).href);
        if (typeof module.instantiate !== "function") {
            throw new Error(`${agent.packageName}: instantiate() is missing.`);
        }
        if (agent.packageName === "@typeagent/browser") {
            for (const runtimeFile of [
                path.join(path.dirname(handler), "phrases.json"),
                path.join(
                    path.dirname(path.dirname(handler)),
                    "views",
                    "server",
                    "server.mjs",
                ),
            ]) {
                if (!fs.existsSync(runtimeFile)) {
                    throw new Error(
                        `${agent.packageName}: runtime file is missing ${runtimeFile}.`,
                    );
                }
            }
        }
        const resourcesAfter = getBackgroundResources();
        if (resourcesAfter.length > resourcesBefore.length) {
            console.warn(
                `${agent.packageName} import added background resource(s): ` +
                    resourcesAfter.slice(resourcesBefore.length).join(", "),
            );
        }
    }
}

function validateNativeRuntime(root) {
    const runtimePackage = path.join(root, "package.json");
    const script = [
        "const runtimeRequire = require('node:module').createRequire(process.argv[1]);",
        "const Database = runtimeRequire('better-sqlite3');",
        "const db = new Database(':memory:');",
        "db.exec('create table smoke(value integer)');",
        "db.close();",
    ].join("");
    const result = spawnSync(process.execPath, ["-e", script, runtimePackage], {
        encoding: "utf8",
    });
    if (result.status !== 0) {
        throw new Error(
            `better-sqlite3 smoke test failed: ${result.stderr || result.stdout}`,
        );
    }
}

async function main() {
    const args = parseArgs(process.argv);
    const metrics = fileMetrics(args.dir);
    if (metrics.files > args.maxFiles) {
        throw new Error(
            `Bundled artifact has ${metrics.files} files; maximum is ${args.maxFiles}.`,
        );
    }
    const developmentFiles = findDevelopmentFiles(args.dir);
    if (developmentFiles.length > 0) {
        throw new Error(
            `Bundled artifact contains development files:\n${developmentFiles
                .slice(0, 20)
                .join("\n")}`,
        );
    }
    await validateAgents(args.dir);
    validateNativeRuntime(args.dir);
    console.log(
        `Validated bundled artifact: ${metrics.files} files, ` +
            `${(metrics.bytes / 1024 / 1024).toFixed(1)} MB`,
    );
}

await main();

const activeResources = process
    .getActiveResourcesInfo()
    .filter((resource) => !["PipeWrap", "TTYWrap"].includes(resource));
if (activeResources.length > 0) {
    throw new Error(
        `Agent imports left ${activeResources.length} background resource(s) open: ` +
            activeResources.join(", "),
    );
}
