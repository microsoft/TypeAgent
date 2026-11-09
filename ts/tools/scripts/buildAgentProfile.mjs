#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, tsRoot } from "./bundleUtils.mjs";

function parseArgs(argv) {
    const args = { profile: "inbox" };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--profile") args.profile = argv[++i];
        else throw new Error(`Unknown argument: ${arg}`);
    }
    return args;
}

function runBuild(packageNames) {
    console.log(`> pnpm run build ${packageNames.join(" ")}`);
    const result = spawnSync("pnpm", ["run", "build", ...packageNames], {
        cwd: tsRoot,
        stdio: "inherit",
        shell: process.platform === "win32",
    });
    if (result.status !== 0) {
        throw new Error(`Agent profile build failed (${result.status}).`);
    }
}

function main() {
    const { profile } = parseArgs(process.argv);
    const configFile =
        profile === "all" ? "config.json" : `config.${profile}.json`;
    const config = readJson(
        path.join(
            tsRoot,
            "packages",
            "defaultAgentProvider",
            "data",
            configFile,
        ),
    );
    const packageNames = [
        ...new Set(
            Object.values(config.agents ?? {}).map((entry) => entry.name),
        ),
    ];
    runBuild(packageNames);
    console.log(
        `Built ${packageNames.length} agent package(s) for profile '${profile}'.`,
    );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
    main();
}
