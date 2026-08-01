#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Package the optional agents (those omitted from a server profile) as
 * self-contained, installable bundles - Option 3 from
 * codeDocs .../2026-06-11_typeagent-plugin-agent-distribution.
 *
 * The lean inbox profile (config.<profile>.json) drops some agents; this packs
 * each dropped agent so users can reinstall it on demand. Each agent is produced
 * by `bundleAgentPackage()`, with only declared runtime externals installed in
 * an adjacent node_modules directory, then foreign-architecture files are
 * pruned. Internal TypeAgent libraries are included in the generated handler
 * bundle and do not need to be published independently.
 *
 * An extracted bundle is loadable by the dispatcher's existing path-based
 * `@install <name> <folder>` (npmAppAgentProvider resolves the agent's
 * exports + deps from the adjacent node_modules) — no npm-specifier install
 * (M1) required.
 *
 * Usage (from ts/):
 *   node tools/scripts/packageOptionalAgents.mjs --out <dir> [--profile inbox]
 *        [--agents code-agent,markdown-agent] [--platform win32] [--arch x64]
 *        [--skip-prune]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { bundleAgentPackage } from "./bundleAgent.mjs";
import { readJson, tsRoot, workspacePackages } from "./bundleUtils.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
    const args = { profile: "inbox", skipPrune: false };
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

function run(cmd, cmdArgs, cwd, env = process.env) {
    console.log(`  > ${cmd} ${cmdArgs.join(" ")}`);
    const res = spawnSync(cmd, cmdArgs, {
        cwd,
        stdio: "inherit",
        shell: process.platform === "win32",
        env,
    });
    if (res.status !== 0)
        throw new Error(`Command failed (${res.status}): ${cmd}`);
}

function writeRuntimeInstallWorkspace(directory) {
    const content = [
        'packages: ["."]',
        "allowBuilds:",
        '  "@azure/msal-node-extensions": true',
        '  "@azure/msal-node-runtime": true',
        "  better-sqlite3: true",
        "  keytar: true",
        "  onnxruntime-node: true",
        "  puppeteer: true",
        "  sharp: true",
        "",
    ].join("\n");
    const workspace = path.join(directory, "pnpm-workspace.yaml");
    fs.writeFileSync(workspace, content, "utf8");
    return workspace;
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
async function validateAgentBundle(dir, npmName) {
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
    const handlerTarget = exportTarget(pkg, "./agent/handlers");
    const handler = await import(
        `${pathToFileURL(path.join(dir, handlerTarget)).href}?validate=${Date.now()}`
    );
    if (typeof handler.instantiate !== "function") {
        throw new Error(`${npmName}: handler does not export instantiate().`);
    }
    return true;
}

async function main() {
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

    const pkgs = workspacePackages();

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
        const source = pkgs.get(npmName);
        if (!source) {
            throw new Error(`Workspace package '${npmName}' was not found.`);
        }
        console.log(`\n[${npmName}] bundling -> ${bundleName}/ ...`);
        await bundleAgentPackage(source.directory, dest);
        const generatedPackage = readJson(path.join(dest, "package.json"));
        if (Object.keys(generatedPackage.dependencies ?? {}).length > 0) {
            const workspace = writeRuntimeInstallWorkspace(dest);
            try {
                run(
                    "pnpm",
                    [
                        "install",
                        "--prod",
                        "--config.node-linker=hoisted",
                        "--lockfile=false",
                    ],
                    dest,
                    {
                        ...process.env,
                        PUPPETEER_SKIP_DOWNLOAD: "true",
                        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: "true",
                    },
                );
            } finally {
                fs.rmSync(workspace, { force: true });
            }
        }
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
        await validateAgentBundle(dest, npmName);
        console.log(`[${npmName}] validated (manifest + handler import).`);
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
                format: "bundleAgentPackage",
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

await main();
