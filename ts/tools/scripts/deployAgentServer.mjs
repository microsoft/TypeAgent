#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Build a self-contained, repo-less-runnable agent-server artifact.
 *
 * Approach (see codeDocs .../2026-06-11_typeagent-plugin-agent-distribution):
 * the agent-server loads on-disk data assets (agent manifests, grammars) via
 * getPackageFilePath, so it CANNOT be a single-file esbuild bundle. Instead we
 * use `pnpm deploy` to produce a folder with a flat node_modules (workspace
 * packages copied in, so data-asset resolution keeps working), prune
 * foreign-arch native binaries, and copy in the config-provisioning tool
 * (getKeys) + the bootstrap launcher (typeagent-serve).
 *
 * Result layout (<out>):
 *   dist/server.js              the daemon entry
 *   node_modules/               deployed + pruned
 *   typeagent-serve.mjs         bootstrap launcher (start / provision / status)
 *   tools/getKeys.mjs (+config, lib/, config.sample.yaml)
 *
 * Usage (from ts/):
 *   node tools/scripts/deployAgentServer.mjs --out <dir> [--platform win32] [--arch x64]
 *        [--skip-deploy] [--skip-prune]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const tsRoot = path.resolve(scriptsDir, "..", ".."); // ts/

function parseArgs(argv) {
    const args = { skipDeploy: false, skipPrune: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--out") args.out = argv[++i];
        else if (a === "--platform") args.platform = argv[++i];
        else if (a === "--arch") args.arch = argv[++i];
        else if (a === "--skip-deploy") args.skipDeploy = true;
        else if (a === "--skip-prune") args.skipPrune = true;
        else if (a === "--profile") args.profile = argv[++i];
        else if (a === "--external-cli") args.externalCli = true;
        else throw new Error(`Unknown argument: ${a}`);
    }
    if (!args.out) throw new Error("Missing --out <dir>.");
    args.out = path.resolve(args.out);
    args.platform = args.platform ?? process.platform;
    args.arch = args.arch ?? process.arch;
    return args;
}

function run(cmd, cmdArgs, cwd) {
    console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
    const res = spawnSync(cmd, cmdArgs, {
        cwd,
        stdio: "inherit",
        shell: process.platform === "win32", // resolve pnpm.cmd on Windows
    });
    if (res.status !== 0) {
        throw new Error(`Command failed (${res.status}): ${cmd}`);
    }
}

function copyInto(srcAbs, destAbs) {
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.cpSync(srcAbs, destAbs, { recursive: true });
    console.log(`  copied ${path.relative(tsRoot, srcAbs)} -> ${destAbs}`);
}

function main() {
    const args = parseArgs(process.argv);
    console.log(
        `Building agent-server artifact at ${args.out} (target ${args.platform}-${args.arch})`,
    );

    // 1. pnpm deploy (hoisted node-linker avoids the cross-drive symlink issue
    //    and yields a copied, self-contained node_modules).
    if (!args.skipDeploy) {
        fs.rmSync(args.out, { recursive: true, force: true });
        run(
            "pnpm",
            [
                "--filter",
                "agent-server",
                "--config.node-linker=hoisted",
                "deploy",
                "--prod",
                args.out,
            ],
            tsRoot,
        );
    } else {
        console.log("Skipping pnpm deploy (--skip-deploy).");
    }

    // 2. Prune foreign-arch native packages.
    if (!args.skipPrune) {
        run(
            "node",
            [
                path.join(scriptsDir, "pruneDeploy.mjs"),
                "--dir",
                args.out,
                "--platform",
                args.platform,
                "--arch",
                args.arch,
            ],
            tsRoot,
        );
    } else {
        console.log("Skipping prune (--skip-prune).");
    }

    // 2b. Apply an agent profile: drop agents (and deps reachable only through
    //     them) not in the selected profile, and record the profile so the
    //     launcher starts the daemon with it by default (the pruned artifact can
    //     no longer load the excluded agents).
    if (args.profile) {
        run(
            "node",
            [
                path.join(scriptsDir, "pruneUnusedAgents.mjs"),
                "--dir",
                args.out,
                "--profile",
                args.profile,
            ],
            tsRoot,
        );
        fs.writeFileSync(
            path.join(args.out, ".typeagent-profile"),
            args.profile,
            "utf8",
        );
        console.log(
            `  recorded profile '${args.profile}' (.typeagent-profile)`,
        );
    }

    // 2c. External-CLI variant: drop the bundled Claude/Copilot runtimes. Only
    //     valid where `claude`/`copilot` are on PATH (managed machines / the
    //     standalone installer); the runtime query() callers are wired to resolve
    //     the PATH binary (claudeExecutableOption), so they don't need the bundle.
    if (args.externalCli) {
        run(
            "node",
            [path.join(scriptsDir, "pruneSdkBinaries.mjs"), "--dir", args.out],
            tsRoot,
        );
        fs.writeFileSync(
            path.join(args.out, ".typeagent-external-cli"),
            "claude,copilot must be on PATH\n",
            "utf8",
        );
        console.log("  recorded external-cli mode (.typeagent-external-cli)");
    }

    // 3. Copy the config-provisioning tool (getKeys + its config/lib) and the
    //    config scaffold. getKeys' runtime deps are already in the deploy
    //    closure (chalk, @azure/keyvault-secrets, @azure/identity, js-yaml,
    //    @typeagent/config), so it runs as `node tools/getKeys.mjs`.
    const toolsOut = path.join(args.out, "tools");
    copyInto(
        path.join(scriptsDir, "getKeys.mjs"),
        path.join(toolsOut, "getKeys.mjs"),
    );
    copyInto(
        path.join(scriptsDir, "getKeys.config.json"),
        path.join(toolsOut, "getKeys.config.json"),
    );
    copyInto(path.join(scriptsDir, "lib"), path.join(toolsOut, "lib"));
    const sample = path.join(tsRoot, "config.sample.yaml");
    if (fs.existsSync(sample)) {
        copyInto(sample, path.join(toolsOut, "config.sample.yaml"));
    }

    // 4. Copy the bootstrap launcher to the artifact root, plus the dev-tunnel
    //    helpers (setup-devtunnel / list-tunnels) for optional remote access.
    copyInto(
        path.join(scriptsDir, "typeagent-serve.mjs"),
        path.join(args.out, "typeagent-serve.mjs"),
    );
    for (const tunnelScript of ["setup-devtunnel.mjs", "list-tunnels.mjs"]) {
        copyInto(
            path.join(scriptsDir, tunnelScript),
            path.join(args.out, tunnelScript),
        );
    }

    console.log(
        `\nArtifact ready at ${args.out}\n` +
            `  Provision config:  node typeagent-serve.mjs provision\n` +
            `  Start the service: node typeagent-serve.mjs start\n` +
            `  Check status:      node typeagent-serve.mjs status`,
    );
}

main();
