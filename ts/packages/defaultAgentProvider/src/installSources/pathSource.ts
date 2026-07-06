// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import {
    InstallSource,
    PathSourceConfig,
    MaterializedInstallRecord,
    ResolvedCandidate,
} from "./config.js";

// `path` source.
//   find        = fs.stat against the resolved path (cheap, side-effect free)
//   materialize = record data { path, source }, omitting `module` and `name`
//   reresolve   = re-stat the record's absolute `path` (its handle)
// `ref` is a filesystem path: absolute or (only when a baseDir is configured)
// relative to that baseDir.
export function createPathSource(config: PathSourceConfig): InstallSource {
    // A relative ref needs a base directory to anchor it. There is no implicit
    // default: this source may run in a different process (and CWD) than the
    // host app that issued the command (e.g. the agent server), so
    // resolving against the local process.cwd() would be silently wrong. An
    // explicit baseDir is the only anchor; without it, only absolute paths
    // resolve and a bare relative ref is a non-match. Source-add persists
    // baseDir as an absolute path.
    const baseDir = config.baseDir;

    function resolveRef(ref: string): string | undefined {
        if (path.isAbsolute(ref)) {
            return path.resolve(ref);
        }
        if (baseDir === undefined) {
            return undefined; // no base to anchor a relative ref
        }
        return path.resolve(baseDir, ref);
    }

    async function find(ref: string): Promise<ResolvedCandidate | undefined> {
        const full = resolveRef(ref);
        if (full === undefined) {
            // Relative ref with no configured baseDir: non-match, so the
            // ordered walk continues to the next source.
            return undefined;
        }
        try {
            await fs.promises.stat(full);
        } catch {
            return undefined; // non-match: the ordered walk continues
        }
        return { source: config.name, path: full };
    }

    return {
        name: config.name,
        kind: "path",
        find,
        async reresolve(
            candidate: ResolvedCandidate,
        ): Promise<ResolvedCandidate | undefined> {
            // The absolute `path` IS the handle; `range` is meaningless for a
            // path install and ignored. A candidate without a path is corrupt.
            if (candidate.path === undefined) {
                throw new Error(
                    `path candidate has no recorded path to refresh (corrupt record).`,
                );
            }
            // Re-stat: a deleted path returns undefined -> host reports it is no
            // longer resolvable, leaving the old agent intact.
            return find(candidate.path);
        },
        async materialize(
            candidate: ResolvedCandidate,
        ): Promise<MaterializedInstallRecord> {
            if (candidate.path === undefined) {
                throw new Error(
                    `path source '${config.name}' got a candidate without a path`,
                );
            }
            const record: MaterializedInstallRecord = {
                kind: "npm",
                path: candidate.path,
                source: config.name,
            };
            if (candidate.loaderConfig !== undefined) {
                record.loaderConfig = candidate.loaderConfig;
            }
            return record;
        },
    };
}
