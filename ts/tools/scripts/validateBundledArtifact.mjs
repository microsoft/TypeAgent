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

function getAddedResources(resourcesBefore, resourcesAfter) {
    const remaining = [...resourcesBefore];
    return resourcesAfter.filter((resource) => {
        const index = remaining.indexOf(resource);
        if (index === -1) {
            return true;
        }
        remaining.splice(index, 1);
        return false;
    });
}

async function waitForAddedResources(resourcesBefore, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let addedResources;
    do {
        addedResources = getAddedResources(
            resourcesBefore,
            getBackgroundResources(),
        );
        if (addedResources.length === 0 || Date.now() >= deadline) {
            return addedResources;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    } while (true);
}

function parseArgs(argv) {
    const args = { maxFiles: 8000 };
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

function declaredRuntimeDevelopmentFiles(root) {
    const allowed = new Set();
    const distribution = readJson(
        path.join(root, "node_modules", ".typeagent-agents.json"),
    );
    for (const agent of distribution.agents) {
        const directory = packageRoot(root, agent.packageName);
        const pkg = readJson(path.join(directory, "package.json"));
        for (const mapping of pkg.typeagent?.bundle?.assetMappings ?? []) {
            if (/\.(?:d\.)?(?:ts|mts|cts)$/i.test(mapping.destination)) {
                allowed.add(path.resolve(directory, mapping.destination));
            }
        }
    }
    return allowed;
}

function findDevelopmentFiles(root, allowed) {
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
                !allowed.has(path.resolve(full)) &&
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

function packageRoot(root, packageName) {
    return path.join(root, "node_modules", ...packageName.split("/"));
}

function validateDeclaredBundleFiles(root, packageName) {
    const packageDirectory = packageRoot(root, packageName);
    const pkg = readJson(path.join(packageDirectory, "package.json"));
    for (const entry of pkg.typeagent?.bundle?.entries ?? []) {
        const file = path.join(packageDirectory, entry);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
            throw new Error(`${packageName}: bundle entry is missing ${file}.`);
        }
    }
    for (const asset of pkg.typeagent?.bundle?.assets ?? []) {
        const file = path.join(packageDirectory, asset);
        if (!fs.existsSync(file)) {
            throw new Error(`${packageName}: bundle asset is missing ${file}.`);
        }
    }
    for (const mapping of pkg.typeagent?.bundle?.assetMappings ?? []) {
        const file = path.join(packageDirectory, mapping.destination);
        if (!fs.existsSync(file)) {
            throw new Error(
                `${packageName}: mapped bundle asset is missing ${file}.`,
            );
        }
    }
}

function validateBrowserRuntime(root) {
    const browserRoot = packageRoot(root, "@typeagent/browser");
    const requiredFiles = [
        "dist/agent/phrases.json",
        "dist/puppeteer/index.mjs",
        "dist/views/server/server.mjs",
        "src/agent/discovery/schema/discoveryActions.mts",
        "src/agent/indexing/schema/summarization.mts",
        "src/agent/knowledge/actions/schema/topicRelationship.mts",
        "src/agent/knowledge/schema/pageQuestionSchema.mts",
        "src/agent/search/schema/answerEnhancement.mts",
        "src/agent/search/schema/queryAnalysis.mts",
        "src/agent/webFlows/schema/browserApi.mts",
        "src/agent/webFlows/schema/webFlowGeneration.mts",
        "src/agent/webFlows/webFlowSandbox.d.ts",
    ];
    for (const relative of requiredFiles) {
        const file = path.join(browserRoot, relative);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
            throw new Error(
                `@typeagent/browser: runtime file is missing ${file}.`,
            );
        }
    }
    const extensionRoot = path.join(browserRoot, "dist", "extension");
    const extensionScripts = [];
    const stack = [extensionRoot];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile() && /\.(?:js|mjs)$/i.test(entry.name)) {
                extensionScripts.push(full);
            }
        }
    }
    if (extensionScripts.length === 0) {
        throw new Error(
            "@typeagent/browser: bundled extension contains no JavaScript files.",
        );
    }
}

function validateFlowRuntime(root, packageNames) {
    for (const [packageName, relative] of [
        ["@typeagent/taskflow-typeagent", "src/script/taskFlowSandbox.d.ts"],
        ["@typeagent/powershell-typeagent", "scripts/scriptHost.ps1"],
    ]) {
        if (!packageNames.has(packageName)) {
            continue;
        }
        const file = path.join(packageRoot(root, packageName), relative);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
            throw new Error(`${packageName}: runtime file is missing ${file}.`);
        }
    }
}

async function validateAgents(root) {
    const require = createRequire(
        path.join(root, "default-agent-provider", "package.json"),
    );
    const distribution = readJson(
        path.join(root, "node_modules", ".typeagent-agents.json"),
    );
    const packageNames = new Set(
        distribution.agents.map((agent) => agent.packageName),
    );
    for (const agent of distribution.agents) {
        validateDeclaredBundleFiles(root, agent.packageName);
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
        const addedResources = await waitForAddedResources(
            resourcesBefore,
            250,
        );
        if (addedResources.length > 0) {
            console.warn(
                `${agent.packageName} import added background resource(s): ` +
                    addedResources.join(", "),
            );
        }
    }
    if (packageNames.has("@typeagent/browser")) {
        validateBrowserRuntime(root);
    }
    validateFlowRuntime(root, packageNames);
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
    const developmentFiles = findDevelopmentFiles(
        args.dir,
        declaredRuntimeDevelopmentFiles(args.dir),
    );
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

const initialResources = getBackgroundResources();
await main();

const activeResources = await waitForAddedResources(initialResources, 1000);
if (activeResources.length > 0) {
    throw new Error(
        `Agent imports left ${activeResources.length} background resource(s) open: ` +
            activeResources.join(", "),
    );
}
