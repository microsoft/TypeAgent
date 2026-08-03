#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFile, fileMetrics, tsRoot, writeJson } from "./bundleUtils.mjs";

const runtimeFiles = [
    ".mcp.json",
    "hooks.json",
    "plugin.json",
    "dist/hooks/hook-agent-stop.js",
    "dist/hooks/hook-post-tool.js",
    "dist/hooks/hook-powershell.js",
    "dist/hooks/hook-router.js",
    "dist/mcp/server.js",
];

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--out") args.out = argv[++i];
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!args.out) {
        throw new Error("Missing --out <dir>.");
    }
    args.out = path.resolve(args.out);
    return args;
}

export function stageCopilotPlugin(out) {
    const sourceRoot = path.join(tsRoot, "packages", "copilot-plugin");
    fs.rmSync(out, { recursive: true, force: true });
    for (const relative of runtimeFiles) {
        const source = path.join(sourceRoot, relative);
        if (!fs.existsSync(source)) {
            throw new Error(
                `Copilot plugin runtime file is missing: ${source}`,
            );
        }
        copyFile(source, path.join(out, relative));
    }
    for (const directory of ["agents", "skills"]) {
        fs.cpSync(path.join(sourceRoot, directory), path.join(out, directory), {
            recursive: true,
        });
    }
    const metrics = fileMetrics(out);
    writeJson(path.join(out, "bundle-manifest.json"), {
        package: "@typeagent/copilot-plugin",
        runtimeFiles,
        metrics,
    });
    return metrics;
}

function main() {
    const args = parseArgs(process.argv);
    const metrics = stageCopilotPlugin(args.out);
    console.log(
        `Staged Copilot plugin: ${metrics.files} files, ` +
            `${(metrics.bytes / 1024 / 1024).toFixed(1)} MB`,
    );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
    main();
}
