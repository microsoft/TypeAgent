#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleAgentPackage } from "./bundleAgent.mjs";
import {
    packageInstallPath,
    readJson,
    tsRoot,
    workspacePackages,
    writeJson,
} from "./bundleUtils.mjs";

function parseArgs(argv) {
    const args = { profile: "inbox" };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--out") args.out = argv[++i];
        else if (arg === "--profile") args.profile = argv[++i];
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!args.out) {
        throw new Error("Missing --out <nodeModulesRoot>.");
    }
    args.out = path.resolve(args.out);
    return args;
}

export async function bundleProfileAgents(profile, nodeModulesRoot) {
    const configPath = path.join(
        tsRoot,
        "packages",
        "defaultAgentProvider",
        "data",
        `config.${profile}.json`,
    );
    const config = readJson(configPath);
    const packages = workspacePackages();
    fs.mkdirSync(nodeModulesRoot, { recursive: true });
    const results = [];
    for (const [agentName, entry] of Object.entries(config.agents ?? {})) {
        const source = packages.get(entry.name);
        if (!source) {
            throw new Error(
                `${agentName}: workspace package '${entry.name}' was not found.`,
            );
        }
        const destination = packageInstallPath(nodeModulesRoot, entry.name);
        console.log(`[${agentName}] Bundling ${entry.name}...`);
        const result = await bundleAgentPackage(source.directory, destination);
        results.push({
            agentName,
            packageName: entry.name,
            execMode: entry.execMode ?? "separate",
            ...result.metrics,
        });
    }
    writeJson(path.join(nodeModulesRoot, ".typeagent-agents.json"), {
        profile,
        agents: results,
    });
    return results;
}

async function main() {
    const args = parseArgs(process.argv);
    const results = await bundleProfileAgents(args.profile, args.out);
    console.log(
        `Bundled ${results.length} agents for profile '${args.profile}'.`,
    );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
    await main();
}
