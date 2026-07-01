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
import { expandPath } from "./paths.js";

// `path` source (design §3, §4.1, §4.2, §12 Q17).
//   find        = fs.stat against the resolved path (cheap, side-effect free)
//   materialize = record data { path, source }, omitting `module` and `name`
// `ref` is a filesystem path: absolute, "~"-relative, or (only when a baseDir
// is configured) relative to that baseDir.
export function createPathSource(config: PathSourceConfig): InstallSource {
    // A relative ref needs a base directory to anchor it. There is deliberately
    // no ambient default: this source may run in a different process (and CWD)
    // than the host app that issued the command (e.g. the agent server), so
    // resolving against the local process.cwd() would be silently wrong. An
    // explicit baseDir (expanded) is the only anchor; without it, only absolute
    // and "~" paths resolve and a bare relative ref is a non-match.
    const baseDir = config.baseDir ? expandPath(config.baseDir) : undefined;

    function resolveRef(ref: string): string | undefined {
        const expanded = expandPath(ref);
        if (path.isAbsolute(expanded)) {
            return path.resolve(expanded);
        }
        if (baseDir === undefined) {
            return undefined; // no base to anchor a relative ref
        }
        return path.resolve(baseDir, expanded);
    }

    return {
        name: config.name,
        kind: "path",
        async find(ref: string): Promise<ResolvedCandidate | undefined> {
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
