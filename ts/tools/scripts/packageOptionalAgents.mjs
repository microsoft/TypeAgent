#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Package the optional agents (those omitted from a server profile) as
 * self-contained, installable bundles — Option 3 from
 * codeDocs .../2026-06-11_typeagent-plugin-agent-distribution.
 *
 * The lean service profile (config.<profile>.json) drops some agents; this packs
 * each dropped agent so users can reinstall it on demand. Each agent is produced
 * via `pnpm deploy` (a folder with the agent + its full dep closure bundled in
 * node_modules, and its manifest/grammar data files intact), then foreign-arch
 * pruned. Because the repo deliberately does NOT publish its internal libraries
 * (aiclient, telemetry, knowpro, ...), bundling them per-agent avoids publishing
 * them or renaming them to the @typeagent/ scope (see the Option 2 design doc).
 *
 * An extracted bundle is loadable by the dispatcher's existing path-based
 * `@install <name> <folder>` (npmAppAgentProvider resolves the agent's
 * exports + deps from the adjacent node_modules) — no npm-specifier install
 * (M1) required.
 *
 * Usage (from ts/):
 *   node tools/scripts/packageOptionalAgents.mjs --out <dir> [--profile service]
 *        [--agents code-agent,markdown-agent] [--platform win32] [--arch x64]
 *        [--skip-prune]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const tsRoot = path.resolve(scriptsDir, "..", "..");

function parseArgs(argv) {
    const args = { profile: "service", skipPrune: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--out") args.out = argv[++i];
        else if (a === "--profile") args.profile = argv[++i];
        else if (a === "--agents") args.agents = argv[++i].split(",");
        else if (a === "--platform") args.platform = argv[++i];
        else if (a === "--arch") args.arch = argv[++i];
        else if (a === "--skip-prune") args.skipPrune = true;
        else throw new Error(`Unknown argument: ${a}`);
    }
    if (!args.out) throw new Error("Missing --out <dir>.");
    args.out = path.resolve(args.out);
    args.platform = args.platform ?? process.platform;
    args.arch = args.arch ?? process.arch;
    return args;
}

function run(cmd, cmdArgs, cwd) {
    console.log(`  > ${cmd} ${cmdArgs.join(" ")}`);
    const res = spawnSync(cmd, cmdArgs, {
        cwd,
        stdio: "inherit",
        shell: process.platform === "win32",
    });
    if (res.status !== 0)
        throw new Error(`Command failed (${res.status}): ${cmd}`);
}

function readJson(f) {
    return JSON.parse(fs.readFileSync(f, "utf8"));
}

function agentNames(cfg) {
    return Object.values(cfg.agents ?? {})
        .map((a) => a?.name)
        .filter((n) => typeof n === "string");
}

// Resolve an exports subpath target from a package.json (handles string or
// conditional-object export entries).
function exportTarget(pkg, key) {
    const e = pkg.exports?.[key];
    if (typeof e === "string") return e;
    if (e && typeof e === "object") return e.default ?? e.import ?? e.require;
    return undefined;
}

// Confirm the deployed agent is loadable: the agent/manifest and agent/handlers
// exports must point at files that exist in the bundle.
function validateAgentBundle(dir, npmName) {
    const pkg = readJson(path.join(dir, "package.json"));
    const checks = ["./agent/manifest", "./agent/handlers"];
    for (const key of checks) {
        const target = exportTarget(pkg, key);
        if (!target) throw new Error(`${npmName}: missing exports["${key}"]`);
        const file = path.join(dir, target);
        if (!fs.existsSync(file)) {
            throw new Error(
                `${npmName}: exports["${key}"] -> ${target} not found in bundle`,
            );
        }
    }
    // The handler module must be present with deps resolvable: at least confirm
    // node_modules exists and the agent SDK is bundled.
    if (
        !fs.existsSync(
            path.join(dir, "node_modules", "@typeagent", "agent-sdk"),
        )
    ) {
        throw new Error(`${npmName}: @typeagent/agent-sdk not bundled`);
    }
    return true;
}

function main() {
    const args = parseArgs(process.argv);
    const dataDir = path.join(
        tsRoot,
        "packages",
        "defaultAgentProvider",
        "data",
    );
    const full = readJson(path.join(dataDir, "config.json"));
    const prof = readJson(path.join(dataDir, `config.${args.profile}.json`));
    const profileNames = new Set(agentNames(prof));
    let excluded = agentNames(full).filter((n) => !profileNames.has(n));
    if (args.agents) excluded = excluded.filter((n) => args.agents.includes(n));

    console.log(
        `Packaging ${excluded.length} optional agent(s) for profile ` +
            `'${args.profile}' (${args.platform}-${args.arch}): ${excluded.join(", ")}`,
    );
    fs.mkdirSync(args.out, { recursive: true });

    const results = [];
    for (const npmName of excluded) {
        const dest = path.join(args.out, npmName);
        console.log(`\n[${npmName}] deploying...`);
        fs.rmSync(dest, { recursive: true, force: true });
        run(
            "pnpm",
            [
                "--filter",
                npmName,
                "--config.node-linker=hoisted",
                "deploy",
                "--prod",
                dest,
            ],
            tsRoot,
        );
        if (!args.skipPrune) {
            run(
                "node",
                [
                    path.join(scriptsDir, "pruneDeploy.mjs"),
                    "--dir",
                    dest,
                    "--platform",
                    args.platform,
                    "--arch",
                    args.arch,
                ],
                tsRoot,
            );
        }
        validateAgentBundle(dest, npmName);
        console.log(
            `[${npmName}] validated (manifest + handlers + agent-sdk present).`,
        );
        results.push(npmName);
    }

    console.log(
        `\nPackaged ${results.length} optional agent bundle(s) under ${args.out}.\n` +
            `Each is installable via the dispatcher:  @install <name> <bundle-folder>\n` +
            `or publishable per-RID:  az artifacts universal publish --name <name> --path <bundle-folder>`,
    );
}

main();
