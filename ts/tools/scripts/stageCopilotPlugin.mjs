#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
    copyFile,
    copyRuntimeTree,
    fileMetrics,
    tsRoot,
    writeJson,
} from "./bundleUtils.mjs";

const runtimeFiles = [
    ".mcp.json",
    "hooks.json",
    "plugin.json",
    "dist/hooks/hook-router.js",
    "dist/mcp/server.js",
];
const extensionSource = "dist/extensions/typeagent/extension.mjs";
const extensionTarget = "extensions/typeagent/extension.mjs";

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

export function stageCopilotPlugin(
    out,
    { sourceRoot = path.join(tsRoot, "packages", "copilot-plugin") } = {},
) {
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
    const extension = path.join(sourceRoot, extensionSource);
    if (!fs.existsSync(extension)) {
        throw new Error(`Copilot plugin runtime file is missing: ${extension}`);
    }
    copyFile(extension, path.join(out, extensionTarget));
    for (const directory of ["agents", "skills"]) {
        fs.cpSync(path.join(sourceRoot, directory), path.join(out, directory), {
            recursive: true,
        });
    }
    copyRuntimeTree(path.join(sourceRoot, "dist"), path.join(out, "dist"));
    const bundled = buildSync({
        absWorkingDir: sourceRoot,
        entryPoints: {
            "hooks/hook-router": path.join(
                sourceRoot,
                "dist",
                "hooks",
                "hook-router.js",
            ),
            "mcp/server": path.join(sourceRoot, "dist", "mcp", "server.js"),
        },
        outdir: path.join(out, "dist"),
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node22",
        sourcemap: true,
        metafile: true,
        external: ["bufferutil", "utf-8-validate"],
        banner: {
            js: "import { createRequire as __stageRequireFactory } from 'module'; const require = __stageRequireFactory(import.meta.url);",
        },
        logLevel: "silent",
    });
    for (const entry of ["hooks/hook-router.js", "mcp/server.js"])
        execFileSync(
            process.execPath,
            ["--check", path.join(out, "dist", entry)],
            {
                timeout: 10000,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );
    const inputs = Object.keys(bundled.metafile.inputs).map((relative) => {
        const file = path.resolve(sourceRoot, relative);
        return {
            file,
            sha256: createHash("sha256")
                .update(fs.readFileSync(file))
                .digest("hex"),
        };
    });
    const metrics = fileMetrics(out);
    writeJson(path.join(out, "bundle-manifest.json"), {
        package: "@typeagent/copilot-plugin",
        runtimeFiles: [...runtimeFiles, extensionTarget],
        runtimeClosure: {
            method: "bundle current compiled JS dependency graph; retain complete dist runtime/assets/shared helpers",
            inputs,
            outputs: bundled.metafile.outputs,
            extensionSha256: createHash("sha256")
                .update(fs.readFileSync(extension))
                .digest("hex"),
        },
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
