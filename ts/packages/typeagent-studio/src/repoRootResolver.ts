// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Resolves the monorepo root that the health, corpus, and collision services
 * expect — i.e. the directory that contains `packages/agents`. The TypeAgent
 * sources live under `ts/`, so opening the git root (which has no
 * `packages/agents` directly) would otherwise make every agent report
 * unknown health and empty grammars. This walks each workspace folder, its
 * `ts/` subdirectory, and ancestor directories to find the right root.
 */

import * as path from "node:path";
import { existsSync } from "node:fs";

export interface RepoRootResolution {
    /** Directory used as the repo root for agent discovery. */
    repoRoot: string;
    /** True when a directory containing `packages/agents` was located. */
    agentsDirFound: boolean;
}

/** Default predicate: a directory is a repo root if it has `packages/agents`. */
export function hasAgentsDir(root: string): boolean {
    return existsSync(path.join(root, "packages", "agents"));
}

/**
 * Yield candidate repo roots derived from a single workspace folder: the
 * folder itself, its `ts/` subdirectory, then the same pair for each ancestor
 * directory up to the filesystem root.
 */
function* repoRootProbes(candidate: string): Generator<string> {
    let current = candidate;
    const seen = new Set<string>();
    while (current.length > 0 && !seen.has(current)) {
        seen.add(current);
        yield current;
        yield path.join(current, "ts");
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
}

/**
 * Find the directory containing `packages/agents` among the given workspace
 * folders (and their `ts/` subdirs / ancestors). Falls back to the first
 * candidate (or `fallback` when there are none) with `agentsDirFound: false`
 * so callers can surface a clear warning.
 */
export function resolveRepoRoot(
    candidates: readonly string[],
    fallback: string,
    dirHasAgents: (root: string) => boolean = hasAgentsDir,
): RepoRootResolution {
    for (const candidate of candidates) {
        for (const probe of repoRootProbes(candidate)) {
            if (dirHasAgents(probe)) {
                return { repoRoot: probe, agentsDirFound: true };
            }
        }
    }
    return {
        repoRoot: candidates[0] ?? fallback,
        agentsDirFound: false,
    };
}
