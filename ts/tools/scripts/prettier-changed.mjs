// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Run prettier on only the files that changed relative to a base branch
// (and, for local development, files in the working tree).  This avoids
// formatting the entire repo, which is slow.
//
// Usage:
//   node tools/scripts/prettier-changed.mjs            # check mode (default)
//   node tools/scripts/prettier-changed.mjs --write    # format in place
//   node tools/scripts/prettier-changed.mjs --base <ref>
//
// The base ref may also be supplied via the PRETTIER_BASE environment
// variable.  It defaults to "origin/main".

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The `ts/` workspace root is two levels up from this script
// (tools/scripts/prettier-changed.mjs).
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const tsRoot = path.resolve(scriptDir, "..", "..");

// Extensions prettier handles in this repo.  Files with other extensions are
// dropped before invoking prettier; `--ignore-unknown` is also passed as a
// second line of defense and to honor .prettierignore.
const SUPPORTED_EXTENSIONS = new Set([
    ".ts",
    ".mts",
    ".cts",
    ".tsx",
    ".js",
    ".mjs",
    ".cjs",
    ".jsx",
    ".json",
    ".jsonc",
    ".css",
    ".scss",
    ".less",
    ".html",
    ".md",
    ".markdown",
    ".yml",
    ".yaml",
]);

// Keep each prettier invocation comfortably below Windows shell length limits.
const MAX_PRETTIER_COMMAND_CHARS = 7000;

function parseArgs(argv) {
    let write = false;
    let base = process.env.PRETTIER_BASE ?? "origin/main";
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--write") {
            write = true;
        } else if (arg === "--base") {
            base = argv[++i];
            if (!base) {
                console.error("error: --base requires a value");
                process.exit(2);
            }
        } else if (arg.startsWith("--base=")) {
            base = arg.slice("--base=".length);
        } else {
            console.error(`error: unknown argument "${arg}"`);
            process.exit(2);
        }
    }
    return { write, base };
}

// Run a git command from a given working directory and return trimmed
// stdout, or null if the command fails (e.g. the base ref does not exist).
function gitFrom(cwd, args) {
    try {
        return execFileSync("git", args, {
            cwd,
            encoding: "utf-8",
        }).trim();
    } catch {
        return null;
    }
}

// Lines of stdout as an array, skipping blanks.
function gitLinesFrom(cwd, args) {
    const out = gitFrom(cwd, args);
    if (out === null) {
        return null;
    }
    return out.length === 0 ? [] : out.split("\n").filter((l) => l.length > 0);
}

// Absolute path to the git repository root.  The git repo root is the parent
// of the `ts/` workspace, so changed paths are repo-relative and must be
// re-based onto the repo root.
function getRepoRoot() {
    const root = gitFrom(tsRoot, ["rev-parse", "--show-toplevel"]);
    if (root === null) {
        console.error("error: not inside a git repository");
        process.exit(2);
    }
    return root;
}

function resolveMergeBase(repoRoot, base) {
    // Prefer the merge-base so we only consider changes introduced on this
    // branch, not changes that landed on the base branch afterwards.
    const mergeBase = gitFrom(repoRoot, ["merge-base", base, "HEAD"]);
    return mergeBase ?? base;
}

function collectChangedFiles(repoRoot, base) {
    const diffBase = resolveMergeBase(repoRoot, base);

    const committed = gitLinesFrom(repoRoot, [
        "diff",
        "--name-only",
        "--diff-filter=ACMR",
        diffBase,
        "HEAD",
    ]);

    if (committed === null) {
        console.error(
            `error: could not diff against base ref "${base}". ` +
                `Make sure it exists (e.g. run "git fetch origin").`,
        );
        process.exit(2);
    }

    // Working-tree changes matter for local development; in CI the tree is
    // clean so these simply return nothing.
    const unstaged =
        gitLinesFrom(repoRoot, ["diff", "--name-only", "--diff-filter=ACMR"]) ??
        [];
    const staged =
        gitLinesFrom(repoRoot, [
            "diff",
            "--name-only",
            "--cached",
            "--diff-filter=ACMR",
        ]) ?? [];
    const untracked =
        gitLinesFrom(repoRoot, [
            "ls-files",
            "--others",
            "--exclude-standard",
        ]) ?? [];

    return new Set([...committed, ...unstaged, ...staged, ...untracked]);
}

function splitIntoBatches(files, staticArgs) {
    const batches = [];
    const staticLength = staticArgs.join(" ").length;

    let current = [];
    let currentLength = staticLength;

    for (const file of files) {
        const addedLength = 1 + file.length;
        if (
            current.length > 0 &&
            currentLength + addedLength > MAX_PRETTIER_COMMAND_CHARS
        ) {
            batches.push(current);
            current = [file];
            currentLength = staticLength + file.length;
        } else {
            current.push(file);
            currentLength += addedLength;
        }
    }

    if (current.length > 0) {
        batches.push(current);
    }

    return batches;
}

function main() {
    const { write, base } = parseArgs(process.argv.slice(2));
    const repoRoot = getRepoRoot();

    const changed = collectChangedFiles(repoRoot, base);

    // Map repo-relative paths to absolute, keep only files under the ts/
    // workspace with a prettier-supported extension.
    const tsRelative = [];
    for (const rel of changed) {
        const abs = path.resolve(repoRoot, rel);
        const within = path.relative(tsRoot, abs);
        if (within.startsWith("..") || path.isAbsolute(within)) {
            continue; // outside the ts/ workspace
        }
        if (!SUPPORTED_EXTENSIONS.has(path.extname(abs).toLowerCase())) {
            continue;
        }
        // Use a path relative to tsRoot with forward slashes so prettier and
        // .prettierignore behave consistently across platforms.
        tsRelative.push(within.split(path.sep).join("/"));
    }

    if (tsRelative.length === 0) {
        console.log("prettier-changed: no changed files to format.");
        return;
    }

    const prettierArgs = [
        "prettier",
        write ? "--write" : "--check",
        "--ignore-unknown",
    ];

    const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const batches = splitIntoBatches(tsRelative, [
        pnpmExecutable,
        "exec",
        ...prettierArgs,
    ]);

    for (const batch of batches) {
        const result = spawnSync(
            pnpmExecutable,
            ["exec", ...prettierArgs, ...batch],
            {
                cwd: tsRoot,
                stdio: "inherit",
            },
        );

        if (result.error) {
            console.error(
                `error: failed to run prettier: ${result.error.message}`,
            );
            process.exit(1);
        }
        if ((result.status ?? 0) !== 0) {
            process.exit(result.status ?? 1);
        }
    }
}

main();
