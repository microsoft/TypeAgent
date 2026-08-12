// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared PR-vs-main job-scope decisions used by build-ts.yml and
// build-package-shell.yml.  Required status-check *names* stay the same
// (every matrix cell still reports); this only decides whether the cell
// does the expensive install/build/test/package work.
//
// Coverage that is skipped on pull_request still runs on push / merge_group
// / workflow_dispatch (and on main).
//
// Usage in Actions:
//   EVENT_NAME, TS_FILTER, MATRIX_OS, MATRIX_VERSION -> GITHUB_OUTPUT
// Local table:
//   node tools/scripts/prCiScope.mjs --table

import fs from "node:fs";
import { pathToFileURL } from "node:url";

// dorny/paths-filter writes "true" / "false".  The existing workflows treat
// anything other than the string "false" as "run" (including an unset
// output when the action hits continue-on-error).
export function pathFilterAllows(output) {
    return output !== "false";
}

function isPullRequest(eventName) {
    return eventName === "pull_request";
}

function nodeVersion(version) {
    return Number(version);
}

/**
 * Full install + build + test:local (+ UI tests on Linux).
 * PRs skip Node 24 — that cell still reports, and Node 24 is covered on
 * push / merge_group / main.
 */
export function shouldRunBuildTsFull({ eventName, tsFilter, version }) {
    if (!isPullRequest(eventName)) {
        return true;
    }
    if (!pathFilterAllows(tsFilter)) {
        return false;
    }
    return nodeVersion(version) === 22;
}

/**
 * Changed-file prettier + complexity / lint / circular / debt gates.
 * These are repo-wide (not OS-specific), so they run once on ubuntu + 22.
 */
export function shouldRunBuildTsRatchet({ eventName, tsFilter, os, version }) {
    if (!isPullRequest(eventName)) {
        return false;
    }
    if (!pathFilterAllows(tsFilter)) {
        return false;
    }
    return os === "ubuntu-latest" && nodeVersion(version) === 22;
}

/**
 * Lint step: whole-repo lint on non-PR events (every cell, same as today);
 * on PRs it is the changed-file prettier check and shares the ratchet cell.
 */
export function shouldRunBuildTsLint(ctx) {
    if (!isPullRequest(ctx.eventName)) {
        return true;
    }
    return shouldRunBuildTsRatchet(ctx);
}

export function shouldFetchPrBase(ctx) {
    return shouldRunBuildTsRatchet(ctx);
}

/**
 * Electron shell packaging.  PRs keep the ubuntu cell as a smoke; macos
 * and windows package on push / merge_group / main.
 */
export function shouldRunShellPackage({ eventName, tsFilter, os }) {
    if (!isPullRequest(eventName)) {
        return true;
    }
    if (!pathFilterAllows(tsFilter)) {
        return false;
    }
    return os === "ubuntu-latest";
}

export function resolveScope(ctx) {
    return {
        full: shouldRunBuildTsFull(ctx),
        ratchet: shouldRunBuildTsRatchet(ctx),
        lint: shouldRunBuildTsLint(ctx),
        fetch: shouldFetchPrBase(ctx),
        package: shouldRunShellPackage(ctx),
    };
}

export const BUILD_TS_OS = ["ubuntu-latest", "windows-latest", "macos-latest"];
export const BUILD_TS_VERSIONS = [22, 24];
export const BUILD_PACKAGE_SHELL_OS = [
    "ubuntu-latest",
    "windows-latest",
    "macos-latest",
];

export function countScope(eventName, tsFilter) {
    const tsCells = BUILD_TS_OS.flatMap((os) =>
        BUILD_TS_VERSIONS.map((version) => ({ os, version })),
    );
    const shellCells = BUILD_PACKAGE_SHELL_OS.map((os) => ({
        os,
        version: 22,
    }));
    const ctx = (cell) => ({ eventName, tsFilter, ...cell });
    return {
        tsJobs: tsCells.length,
        tsFull: tsCells.filter((cell) => shouldRunBuildTsFull(ctx(cell)))
            .length,
        tsRatchet: tsCells.filter((cell) => shouldRunBuildTsRatchet(ctx(cell)))
            .length,
        tsLint: tsCells.filter((cell) => shouldRunBuildTsLint(ctx(cell)))
            .length,
        tsFetch: tsCells.filter((cell) => shouldFetchPrBase(ctx(cell))).length,
        shellJobs: shellCells.length,
        shellPackage: shellCells.filter((cell) =>
            shouldRunShellPackage(ctx(cell)),
        ).length,
    };
}

export function formatScopeTable() {
    const rows = [
        ["event", "ts filter", "ts full", "ts ratchet", "shell package"],
        ["pull_request (before)", "ts changed", "6 / 6", "6 / 6", "3 / 3"],
        (() => {
            const c = countScope("pull_request", "true");
            return [
                "pull_request (after)",
                "ts changed",
                `${c.tsFull} / ${c.tsJobs}`,
                `${c.tsRatchet} / ${c.tsJobs}`,
                `${c.shellPackage} / ${c.shellJobs}`,
            ];
        })(),
        (() => {
            const c = countScope("pull_request", "false");
            return [
                "pull_request (after)",
                "no ts change",
                `${c.tsFull} / ${c.tsJobs}`,
                `${c.tsRatchet} / ${c.tsJobs}`,
                `${c.shellPackage} / ${c.shellJobs}`,
            ];
        })(),
        (() => {
            const c = countScope("merge_group", "true");
            return [
                "merge_group / push / main",
                "(ignored)",
                `${c.tsFull} / ${c.tsJobs}`,
                `${c.tsRatchet} / ${c.tsJobs}`,
                `${c.shellPackage} / ${c.shellJobs}`,
            ];
        })(),
    ];
    const widths = rows[0].map((_, i) =>
        Math.max(...rows.map((row) => row[i].length)),
    );
    const line = (row) =>
        `| ${row.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`;
    const sep = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
    return [line(rows[0]), sep, ...rows.slice(1).map(line)].join("\n");
}

function readCtxFromEnv(env = process.env) {
    return {
        eventName: env.EVENT_NAME ?? "",
        tsFilter: env.TS_FILTER ?? "",
        os: env.MATRIX_OS ?? "",
        version: env.MATRIX_VERSION ?? "",
    };
}

export function formatGithubOutput(scope) {
    return (
        `full=${scope.full}\n` +
        `ratchet=${scope.ratchet}\n` +
        `lint=${scope.lint}\n` +
        `fetch=${scope.fetch}\n` +
        `package=${scope.package}\n`
    );
}

export function writeGithubOutput(scope, env = process.env) {
    const text = formatGithubOutput(scope);
    if (env.GITHUB_OUTPUT) {
        fs.appendFileSync(env.GITHUB_OUTPUT, text);
    }
    return text;
}

function main(argv = process.argv.slice(2), env = process.env) {
    if (argv.includes("--table")) {
        process.stdout.write(`${formatScopeTable()}\n`);
        return 0;
    }
    const scope = resolveScope(readCtxFromEnv(env));
    process.stdout.write(writeGithubOutput(scope, env));
    return 0;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    process.exit(main());
}
