// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Compute the CI scope (skip / fast / full) for the changes between --base and
// HEAD; see lib/ciScope.mjs.  Writes `mode`, `filters` (install/build) and
// `test_filters` to $GITHUB_OUTPUT when set; always prints a summary.
//
//   node tools/scripts/ciScope.mjs --base origin/main [--full-trigger <path>]...

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { computeScope, pnpmFilters } from "./lib/ciScope.mjs";

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

const args = parseArgs(process.argv.slice(2));
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

const scope = computeScope(changedFiles, { fullTriggers: args.fullTriggers });

console.log(`CI scope: ${scope.mode}`);
if (scope.packages.length)
    console.log(`Packages: ${scope.packages.join(", ")}`);
for (const r of scope.reasons.slice(0, 20)) console.log(`  full because: ${r}`);

if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        [
            `mode=${scope.mode}`,
            `filters=${pnpmFilters(scope.packages, true)}`,
            `test_filters=${pnpmFilters(scope.packages, false)}`,
            "",
        ].join("\n"),
    );
}
