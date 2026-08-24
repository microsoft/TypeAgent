#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleProfileAgents } from "./bundleProductAgents.mjs";
import {
    bundleEntry,
    copyFile,
    fileMetrics,
    readJson,
    runtimeExternalPackages,
    tsRoot,
    writeJson,
} from "./bundleUtils.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
    const args = {
        profile: "inbox",
        platform: process.platform,
        arch: process.arch,
        externalCli: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--out") args.out = argv[++i];
        else if (arg === "--profile") args.profile = argv[++i];
        else if (arg === "--platform") args.platform = argv[++i];
        else if (arg === "--arch") args.arch = argv[++i];
        else if (arg === "--external-cli") args.externalCli = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!args.out) {
        throw new Error("Missing --out <dir>.");
    }
    args.out = path.resolve(args.out);
    return args;
}

function run(command, args, cwd = tsRoot) {
    console.log(`> ${command} ${args.join(" ")}`);
    const result = spawnSync(command, args, {
        cwd,
        stdio: "inherit",
        shell: process.platform === "win32",
    });
    if (result.status !== 0) {
        throw new Error(`Command failed (${result.status}): ${command}`);
    }
}

function copyDirectory(source, destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
}

function copyDispatcherAssets(out) {
    const sourceRoot = path.join(
        tsRoot,
        "packages",
        "dispatcher",
        "dispatcher",
    );
    const destinationRoot = path.join(out, "dispatcher");
    copyDirectory(
        path.join(sourceRoot, "data"),
        path.join(destinationRoot, "data"),
    );
    const stack = [path.join(sourceRoot, "src")];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (
                entry.isFile() &&
                /ActionSchema.*\.(?:ts|mts)$/i.test(entry.name)
            ) {
                const relative = path.relative(sourceRoot, full);
                copyFile(full, path.join(destinationRoot, relative));
            }
        }
    }
}

function copyProviderAssets(out, profile) {
    const sourceRoot = path.join(tsRoot, "packages", "defaultAgentProvider");
    const destinationRoot = path.join(out, "default-agent-provider");
    copyFile(
        path.join(sourceRoot, "package.json"),
        path.join(destinationRoot, "package.json"),
    );
    for (const config of ["config.json", `config.${profile}.json`]) {
        copyFile(
            path.join(sourceRoot, "data", config),
            path.join(destinationRoot, "data", config),
        );
    }
    copyDirectory(
        path.join(sourceRoot, "data", "explainer"),
        path.join(destinationRoot, "data", "explainer"),
    );
    copyFile(
        path.join(tsRoot, "packages", "agents", "agents.catalog.json"),
        path.join(out, "agents", "agents.catalog.json"),
    );
}

async function bundleExecutable(entryPoint, outfile, external = [], assetRoot) {
    return bundleEntry({
        entryPoint,
        outfile,
        external,
        runtimeRootFromOutput: "../",
        assetRoot,
    });
}

export async function bundleAgentServer(args) {
    const out = args.out;
    fs.rmSync(out, { recursive: true, force: true });

    run("pnpm", [
        "--filter",
        "agent-server-bundled-runtime",
        "--config.node-linker=hoisted",
        "deploy",
        "--prod",
        out,
    ]);
    run("node", [
        path.join(scriptsDir, "pruneDeploy.mjs"),
        "--dir",
        out,
        "--platform",
        args.platform,
        "--arch",
        args.arch,
    ]);
    if (args.externalCli) {
        run("node", [
            path.join(scriptsDir, "pruneSdkBinaries.mjs"),
            "--dir",
            out,
        ]);
    }
    run("node", [path.join(scriptsDir, "pruneDeployFiles.mjs"), "--dir", out]);

    const profileConfig = readJson(
        path.join(
            tsRoot,
            "packages",
            "defaultAgentProvider",
            "data",
            `config.${args.profile}.json`,
        ),
    );
    const profilePackages = Object.values(profileConfig.agents ?? {}).map(
        (entry) => entry.name,
    );
    const externals = [
        ...profilePackages,
        ...runtimeExternalPackages,
        "@modelcontextprotocol/server-filesystem",
        "readline/promises",
    ];

    const metafiles = {};
    metafiles.server = await bundleExecutable(
        path.join(
            tsRoot,
            "packages",
            "agentServer",
            "server",
            "dist",
            "server.js",
        ),
        path.join(out, "dist", "server.js"),
        externals,
        out,
    );
    metafiles.stop = await bundleExecutable(
        path.join(
            tsRoot,
            "packages",
            "agentServer",
            "server",
            "dist",
            "stop.js",
        ),
        path.join(out, "dist", "stop.js"),
        externals,
        out,
    );
    metafiles.agentProcess = await bundleExecutable(
        path.join(
            tsRoot,
            "packages",
            "dispatcher",
            "nodeProviders",
            "dist",
            "agentProvider",
            "process",
            "agentProcess.js",
        ),
        path.join(out, "dist", "agentProcess.js"),
        externals,
        out,
    );
    metafiles.commandExecutor = await bundleExecutable(
        path.join(tsRoot, "packages", "commandExecutor", "dist", "server.js"),
        path.join(out, "bin", "command-executor.js"),
        externals,
        out,
    );

    copyFile(
        path.join(scriptsDir, "typeagent-serve.mjs"),
        path.join(out, "typeagent-serve.mjs"),
    );
    for (const script of [
        "getKeys.mjs",
        "generate-selfhost-config.mjs",
        "setup-devtunnel.mjs",
        "list-tunnels.mjs",
    ]) {
        metafiles[script] = await bundleExecutable(
            path.join(scriptsDir, script),
            path.join(out, "tools", script),
            externals,
            out,
        );
    }
    copyFile(
        path.join(tsRoot, "config.sample.yaml"),
        path.join(out, "tools", "config.sample.yaml"),
    );
    copyFile(
        path.join(scriptsDir, "getKeys.config.json"),
        path.join(out, "tools", "getKeys.config.json"),
    );

    copyProviderAssets(out, args.profile);
    copyDispatcherAssets(out);
    const agents = await bundleProfileAgents(
        args.profile,
        path.join(out, "node_modules"),
    );
    fs.writeFileSync(
        path.join(out, ".typeagent-profile"),
        args.profile,
        "utf8",
    );
    if (args.externalCli) {
        fs.writeFileSync(
            path.join(out, ".typeagent-external-cli"),
            "claude,copilot must be on PATH\n",
        );
    }

    const metrics = fileMetrics(out);
    const bundledInputs = new Set();
    for (const metafile of Object.values(metafiles)) {
        for (const input of Object.keys(metafile.inputs)) {
            bundledInputs.add(input);
        }
    }
    writeJson(path.join(out, "bundle-manifest.json"), {
        profile: args.profile,
        platform: args.platform,
        arch: args.arch,
        externalCli: args.externalCli,
        agents,
        runtimeExternals: runtimeExternalPackages,
        bundledInputs: [...bundledInputs].sort(),
        metrics,
    });
    console.log(
        `Bundled agent server: ${metrics.files} files, ` +
            `${(metrics.bytes / 1024 / 1024).toFixed(1)} MB`,
    );
    return { metrics, agents };
}

async function main() {
    await bundleAgentServer(parseArgs(process.argv));
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
    await main();
}
