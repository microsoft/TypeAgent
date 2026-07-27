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

// Map an npm package name to a bundle-folder / universal-package name.
// Azure Artifacts universal package names must be lowercase and contain only
// alphanumeric segments separated by '-', '.', or '_' — the npm scope
// ('@typeagent/') is invalid there. Stripping the scope yields a valid, stable
// identity matching the pre-scoping bundle name (e.g. '@typeagent/code-agent'
// -> 'code-agent'). The scoped name is still used for `pnpm --filter`.
function toBundleName(npmName) {
    return npmName
        .replace(/^@[^/]+\//, "")
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .toLowerCase();
}

// Workspace packages keyed by npm name -> { path, private }. Used to decide
// which agents are published to the npm feed.
function workspacePackages() {
    const res = spawnSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
        cwd: tsRoot,
        encoding: "utf8",
        maxBuffer: 1 << 26,
        shell: process.platform === "win32",
    });
    if (res.status !== 0)
        throw new Error(`pnpm ls failed (${res.status}): ${res.stderr ?? ""}`);
    const map = new Map();
    for (const p of JSON.parse(res.stdout)) if (p.name) map.set(p.name, p);
    return map;
}

// An agent published to the npm feed is installed via its npm specifier (M1),
// so it must NOT also be shipped as a universal package. The npm publish step
// packs '@typeagent/*' packages that aren't private, so mirror that filter.
function isNpmPublished(npmName, pkgs) {
    if (!npmName.startsWith("@typeagent/")) return false;
    const p = pkgs.get(npmName);
    if (!p) return false;
    const pj = readJson(path.join(p.path, "package.json"));
    return pj.private !== true;
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
    if (args.agents)
        excluded = excluded.filter(
            (n) =>
                args.agents.includes(n) ||
                args.agents.includes(toBundleName(n)),
        );

    // Agents published to the npm feed are installed via their npm specifier,
    // so don't also ship them as universal packages. Only bundle agents that
    // can't be npm-published. An explicit `--agents` list overrides this (for
    // local testing of a specific bundle).
    if (!args.agents && excluded.length) {
        const pkgs = workspacePackages();
        const npmPublished = excluded.filter((n) => isNpmPublished(n, pkgs));
        if (npmPublished.length)
            console.warn(
                `Skipping ${npmPublished.length} npm-published agent(s) ` +
                    `(installed via the npm feed, not as universal packages): ` +
                    npmPublished.join(", "),
            );
        excluded = excluded.filter((n) => !npmPublished.includes(n));
    }

    // Universal-package names must be unique after scope stripping.
    const seen = new Map();
    for (const n of excluded) {
        const b = toBundleName(n);
        if (seen.has(b))
            throw new Error(
                `Bundle name collision: '${seen.get(b)}' and '${n}' both map ` +
                    `to universal-package name '${b}'.`,
            );
        seen.set(b, n);
    }

    console.log(
        `Packaging ${excluded.length} optional agent(s) for profile ` +
            `'${args.profile}' (${args.platform}-${args.arch}): ${excluded.join(", ")}`,
    );
    fs.mkdirSync(args.out, { recursive: true });

    const results = [];
    for (const npmName of excluded) {
        const bundleName = toBundleName(npmName);
        const dest = path.join(args.out, bundleName);
        console.log(`\n[${npmName}] deploying -> ${bundleName}/ ...`);
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
        results.push(bundleName);
    }

    // Always leave a manifest so the artifact is non-empty (all optional agents
    // may be npm-published, leaving no bundles) and self-documenting.
    fs.writeFileSync(
        path.join(args.out, "bundles.json"),
        JSON.stringify(
            {
                profile: args.profile,
                platform: args.platform,
                arch: args.arch,
                bundles: results,
                note:
                    "npm-published agents ('@typeagent/*', not private) are " +
                    "installed from the npm feed and are intentionally not " +
                    "bundled as universal packages.",
            },
            null,
            2,
        ) + "\n",
    );

    console.log(
        `\nPackaged ${results.length} optional agent bundle(s) under ${args.out}.\n` +
            `Bundle folders (== universal-package names): ${results.join(", ")}\n` +
            `Each is installable via the dispatcher:  @install <name> <bundle-folder>\n` +
            `or publishable per-RID:  az artifacts universal publish --name <bundle-folder> --path <bundle-folder>`,
    );
}

main();
