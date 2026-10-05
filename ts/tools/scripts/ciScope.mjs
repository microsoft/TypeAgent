// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Compute the CI scope (skip / fast / full) for the changes between --base and
// HEAD.  Run from ts/.  Writes `mode`, `filters` (install/build) and
// `test_filters` to $GITHUB_OUTPUT when set; always prints a summary.
//
//   node tools/scripts/ciScope.mjs --base origin/main [--full-trigger <path>]...

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
    buildGraph,
    computeScope,
    expandWorkspaceGlobs,
    pnpmFilters,
} from "./lib/ciScope.mjs";

function parseArgs(argv) {
    const args = { base: undefined, fullTriggers: [] };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--base") args.base = argv[++i];
        else if (argv[i] === "--full-trigger")
            args.fullTriggers.push(argv[++i]);
        else throw new Error(`Unknown argument: ${argv[i]}`);
    }
    if (!args.base) throw new Error("--base is required");
    return args;
}

function workspaceGlobs(tsDir) {
    const text = fs.readFileSync(
        path.join(tsDir, "pnpm-workspace.yaml"),
        "utf8",
    );
    const globs = [];
    let inPackages = false;
    for (const line of text.split(/\r?\n/)) {
        if (/^packages:\s*$/.test(line)) inPackages = true;
        else if (inPackages && /^\s+-\s+/.test(line)) {
            globs.push(
                line
                    .replace(/^\s+-\s+/, "")
                    .replace(/["']/g, "")
                    .trim(),
            );
        } else if (inPackages && line.trim() && !line.startsWith(" ")) break;
    }
    return globs;
}

function loadPackages(tsDir) {
    const listDirs = (rel) => {
        const abs = path.join(tsDir, rel);
        if (!fs.existsSync(abs)) return [];
        return fs
            .readdirSync(abs, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    };
    const packages = [];
    for (const dir of expandWorkspaceGlobs(workspaceGlobs(tsDir), listDirs)) {
        const file = path.join(tsDir, dir, "package.json");
        if (!fs.existsSync(file)) continue;
        const json = JSON.parse(fs.readFileSync(file, "utf8"));
        const deps = Object.keys({
            ...json.dependencies,
            ...json.devDependencies,
            ...json.optionalDependencies,
            ...json.peerDependencies,
        });
        packages.push({ dir, name: json.name, deps });
    }
    return packages;
}

export { loadPackages };
if (process.env.CI_SCOPE_NO_MAIN !== "1") main();
function main() {
    const args = parseArgs(process.argv.slice(2));
    const tsDir = process.cwd();
    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
    }).trim();
    const changedFiles = execFileSync(
        "git",
        ["diff", "--name-only", `${args.base}...HEAD`],
        { encoding: "utf8", cwd: repoRoot },
    )
        .split("\n")
        .filter(Boolean);

    const graph = buildGraph(loadPackages(tsDir));
    const scope = computeScope(changedFiles, graph, {
        extraFullTriggers: args.fullTriggers,
    });

    console.log(`CI scope: ${scope.mode}`);
    if (scope.changed.length)
        console.log(`Changed: ${scope.changed.join(", ")}`);
    if (scope.affected.length)
        console.log(`Affected: ${scope.affected.join(", ")}`);
    for (const r of scope.reasons) console.log(`  full because: ${r}`);

    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(
            process.env.GITHUB_OUTPUT,
            [
                `mode=${scope.mode}`,
                `filters=${pnpmFilters(scope.affected, true)}`,
                `test_filters=${pnpmFilters(scope.affected, false)}`,
                `sqlite=${scope.sqlite}`,
                "",
            ].join("\n"),
        );
    }
}
