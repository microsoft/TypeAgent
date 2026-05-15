// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import type { WorkspacePackage } from "./workspaceGraph.js";

/**
 * Directories within a package that count as "source" for the purpose
 * of triggering a regeneration. A change anywhere else (e.g. the
 * existing README, test fixtures, dist/) does not retrigger docs.
 *
 * package.json is also watched: a description or dependency change is
 * a real signal for the README.
 */
export const DEFAULT_WATCHED_DIRS: readonly string[] = ["src"];
export const DEFAULT_WATCHED_FILES: readonly string[] = ["package.json"];

/**
 * Result of attributing a changed file to a package.
 */
export interface FileAttribution {
    /** Path of the file relative to the monorepo root, POSIX-style. */
    readonly path: string;
    /**
     * The owning workspace package, or null when the file is not part
     * of any tracked workspace package (e.g. tooling outside packages/).
     */
    readonly pkg: WorkspacePackage | null;
    /**
     * True when the file falls inside a watched path of its owning
     * package and therefore should trigger regeneration.
     */
    readonly triggers: boolean;
}

/**
 * Given the list of workspace packages and a set of changed files
 * (relative to monorepo root, POSIX-style), return:
 *  - the deduplicated list of packages whose docs should regenerate
 *  - the per-file attribution (useful for verbose / dry-run logging)
 *
 * Pure function: no I/O. Caller is responsible for sourcing the file
 * list (typically `git diff --name-only since..HEAD`).
 */
export function detectChangedPackages(
    packages: readonly WorkspacePackage[],
    changedFiles: readonly string[],
    options: {
        watchedDirs?: readonly string[];
        watchedFiles?: readonly string[];
    } = {},
): {
    packages: WorkspacePackage[];
    attributions: FileAttribution[];
} {
    const watchedDirs = options.watchedDirs ?? DEFAULT_WATCHED_DIRS;
    const watchedFiles = options.watchedFiles ?? DEFAULT_WATCHED_FILES;

    // Sort packages by relDir descending so that nested packages match
    // before their ancestors (e.g. packages/dispatcher/dispatcher
    // matches before packages/dispatcher).
    const sorted = [...packages].sort(
        (a, b) => b.relDir.length - a.relDir.length,
    );

    const triggered = new Map<string, WorkspacePackage>();
    const attributions: FileAttribution[] = [];

    for (const file of changedFiles) {
        const norm = file.split(path.sep).join("/");
        const owner = findOwningPackage(sorted, norm);
        if (owner === null) {
            attributions.push({ path: norm, pkg: null, triggers: false });
            continue;
        }
        const relWithin = norm.slice(owner.relDir.length + 1);
        const triggers = isWatched(relWithin, watchedDirs, watchedFiles);
        attributions.push({ path: norm, pkg: owner, triggers });
        if (triggers) {
            triggered.set(owner.name, owner);
        }
    }

    return {
        packages: [...triggered.values()].sort((a, b) =>
            a.name.localeCompare(b.name),
        ),
        attributions,
    };
}

function findOwningPackage(
    packagesSortedByDepth: readonly WorkspacePackage[],
    file: string,
): WorkspacePackage | null {
    for (const pkg of packagesSortedByDepth) {
        if (file === pkg.relDir || file.startsWith(`${pkg.relDir}/`)) {
            return pkg;
        }
    }
    return null;
}

function isWatched(
    relWithin: string,
    watchedDirs: readonly string[],
    watchedFiles: readonly string[],
): boolean {
    if (relWithin.length === 0) return false;
    for (const f of watchedFiles) {
        if (relWithin === f) return true;
    }
    for (const d of watchedDirs) {
        if (relWithin === d || relWithin.startsWith(`${d}/`)) {
            return true;
        }
    }
    return false;
}
