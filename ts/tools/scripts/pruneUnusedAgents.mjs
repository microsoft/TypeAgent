#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Prune agents (and their now-orphaned dependencies) that a server profile does
 * not include, from a `pnpm deploy` output.
 *
 * The agent set is config-driven: the daemon loads only the agents listed in the
 * selected provider config (data/config.<profile>.json, via `--config`). Agents
 * omitted from the profile are never loaded, so their packages — and any deps
 * reachable ONLY through them — are dead weight in the artifact.
 *
 * Mechanism (reachability tree-shake over the installed node_modules):
 *   excluded = agents in the full config.json but NOT in config.<profile>.json
 *   keep     = BFS over package DIRECTORIES using Node-style resolution (walk up
 *              from each package for each dep), starting at the deployed root and
 *              never traversing into an excluded agent. Resolving by directory
 *              (not just name) is required because pnpm leaves some nested
 *              node_modules on version conflicts — a nested dep must keep its own
 *              transitive deps.
 *   delete   = every installed package directory (any nesting level) not in `keep`
 * Deps shared with a kept agent stay (they remain reachable); only deps unique to
 * excluded agents are removed.
 *
 * SAFETY: this is a dependency-graph tree-shake. It cannot see packages loaded by
 * dynamic require()/import() that aren't declared in package.json. Always boot the
 * pruned artifact (e.g. `node dist/server.js --config <profile>`) to confirm.
 *
 * Usage:
 *   node tools/scripts/pruneUnusedAgents.mjs --dir <deployDir> [--profile service] [--dry-run]
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
    const args = { profile: "service", dryRun: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dir") args.dir = argv[++i];
        else if (a === "--profile") args.profile = argv[++i];
        else if (a === "--dry-run") args.dryRun = true;
        else throw new Error(`Unknown argument: ${a}`);
    }
    if (!args.dir) throw new Error("Missing --dir <deployDir>.");
    args.dir = path.resolve(args.dir);
    return args;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function agentNames(config) {
    return Object.values(config.agents ?? {})
        .map((a) => a?.name)
        .filter((n) => typeof n === "string");
}

// All declared deps of a package that could be required at runtime.
function depNamesOf(pkgJson) {
    return [
        ...Object.keys(pkgJson.dependencies ?? {}),
        ...Object.keys(pkgJson.optionalDependencies ?? {}),
        ...Object.keys(pkgJson.peerDependencies ?? {}),
    ];
}

// Node-style resolution: from a package directory, a dep `name` is found in the
// nearest ancestor's node_modules. Walk up from `fromDir` to the deploy root,
// checking `<ancestor>/node_modules/<name>`. Returns the resolved package dir.
function resolveDep(fromDir, name, rootDir) {
    let cur = fromDir;
    while (true) {
        const cand = path.join(cur, "node_modules", ...name.split("/"));
        if (fs.existsSync(path.join(cand, "package.json"))) return cand;
        if (path.resolve(cur) === path.resolve(rootDir)) break;
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
    }
    return undefined;
}

function dirSizeBytes(dir) {
    let total = 0;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) total += dirSizeBytes(full);
        else if (e.isFile()) {
            try {
                total += fs.statSync(full).size;
            } catch {
                /* ignore */
            }
        }
    }
    return total;
}

function fmt(bytes) {
    const mb = bytes / (1024 * 1024);
    return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

// Enumerate every installed package directory at any nesting level. Returns
// { name, dir } for each, skipping dot-entries (.bin/.pnpm/...).
function listInstalledPackages(nodeModulesDir, acc = []) {
    if (!fs.existsSync(nodeModulesDir)) return acc;
    for (const entry of fs.readdirSync(nodeModulesDir, {
        withFileTypes: true,
    })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        if (entry.name.startsWith("@")) {
            const scopeDir = path.join(nodeModulesDir, entry.name);
            for (const sub of fs.readdirSync(scopeDir, {
                withFileTypes: true,
            })) {
                if (!sub.isDirectory()) continue;
                const dir = path.join(scopeDir, sub.name);
                acc.push({ name: `${entry.name}/${sub.name}`, dir });
                listInstalledPackages(path.join(dir, "node_modules"), acc);
            }
        } else {
            const dir = path.join(nodeModulesDir, entry.name);
            acc.push({ name: entry.name, dir });
            listInstalledPackages(path.join(dir, "node_modules"), acc);
        }
    }
    return acc;
}

function main() {
    const args = parseArgs(process.argv);
    const nm = path.join(args.dir, "node_modules");
    const dataDir = path.join(nm, "default-agent-provider", "data");
    const fullCfg = readJson(path.join(dataDir, "config.json"));
    const profCfg = readJson(path.join(dataDir, `config.${args.profile}.json`));

    const profileNames = new Set(agentNames(profCfg));
    const excluded = new Set(
        agentNames(fullCfg).filter((n) => !profileNames.has(n)),
    );
    console.log(
        `Profile '${args.profile}': keeping ${profileNames.size} agents, ` +
            `excluding ${excluded.size} (${[...excluded].join(", ")}).`,
    );

    // BFS the keep-set over package DIRECTORIES using Node-style resolution,
    // never traversing into an excluded agent. Seeded from the deployed root
    // package's deps (resolved against the top-level node_modules).
    const rootPkg = readJson(path.join(args.dir, "package.json"));
    const keep = new Set(); // resolved absolute dirs
    const queue = []; // dirs to process
    function enqueueDeps(fromDir, names) {
        for (const name of names) {
            if (excluded.has(name)) continue;
            const resolved = resolveDep(fromDir, name, args.dir);
            if (resolved === undefined) continue; // absent optional/peer dep
            const key = path.resolve(resolved);
            if (keep.has(key)) continue;
            keep.add(key);
            queue.push(resolved);
        }
    }
    enqueueDeps(args.dir, depNamesOf(rootPkg));
    while (queue.length > 0) {
        const dir = queue.shift();
        let pj;
        try {
            pj = readJson(path.join(dir, "package.json"));
        } catch {
            continue;
        }
        enqueueDeps(dir, depNamesOf(pj));
    }

    // Delete every installed package directory not in the keep-set.
    let freed = 0;
    const removed = [];
    for (const { name, dir } of listInstalledPackages(nm)) {
        if (keep.has(path.resolve(dir))) continue;
        if (!fs.existsSync(dir)) continue; // parent already removed
        const size = dirSizeBytes(dir);
        freed += size;
        removed.push({ name, size });
        if (!args.dryRun) fs.rmSync(dir, { recursive: true, force: true });
    }

    removed.sort((a, b) => b.size - a.size);
    for (const r of removed.slice(0, 25)) {
        console.log(
            `  ${args.dryRun ? "would remove" : "removed"}: ${r.name} (${fmt(r.size)})`,
        );
    }
    if (removed.length > 25) {
        console.log(`  ... and ${removed.length - 25} more`);
    }
    console.log(
        `${args.dryRun ? "Would free" : "Freed"} ${fmt(freed)} across ${removed.length} package(s).`,
    );
}

main();
