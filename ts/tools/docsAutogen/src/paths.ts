// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

/**
 * Walk upward from `start` looking for the directory containing a
 * `.git` entry (file or directory). Returns the absolute repo root.
 *
 * Throws if no `.git` is found before reaching the filesystem root.
 */
export function findRepoRoot(start: string): string {
    let cur = path.resolve(start);
    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (fs.existsSync(path.join(cur, ".git"))) {
            return cur;
        }
        const parent = path.dirname(cur);
        if (parent === cur) {
            throw new Error(`No .git directory found above ${start}`);
        }
        cur = parent;
    }
}

/**
 * Returns the absolute path of the TypeAgent monorepo root (the `ts/`
 * directory inside the repo, which contains `pnpm-workspace.yaml`).
 *
 * Throws if `pnpm-workspace.yaml` is not found.
 */
export function findMonorepoRoot(start: string): string {
    let cur = path.resolve(start);
    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (fs.existsSync(path.join(cur, "pnpm-workspace.yaml"))) {
            return cur;
        }
        const parent = path.dirname(cur);
        if (parent === cur) {
            throw new Error(`No pnpm-workspace.yaml found above ${start}`);
        }
        cur = parent;
    }
}

/**
 * Convert an absolute path to a POSIX-style path relative to `base`.
 * Returns the path as-is (POSIX-normalised) if it is not under `base`.
 */
export function toPosixRelative(absPath: string, base: string): string {
    const rel = path.relative(base, path.resolve(absPath));
    return rel.split(path.sep).join("/");
}

/**
 * Format a repo-relative POSIX path with a leading `./` (matching the
 * AUTOGEN format spec, which requires every link target to start with
 * `./` or `../`).
 */
export function asLinkTarget(relPath: string): string {
    if (relPath.startsWith("./") || relPath.startsWith("../")) {
        return relPath;
    }
    if (relPath.startsWith("/")) {
        return `.${relPath}`;
    }
    return `./${relPath}`;
}

/**
 * True when `absPath` is inside `base` (or equal to it).
 * Both paths are resolved to absolute form for comparison.
 */
export function isUnder(absPath: string, base: string): boolean {
    const a = path.resolve(absPath);
    const b = path.resolve(base);
    if (a === b) return true;
    const rel = path.relative(b, a);
    return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}
