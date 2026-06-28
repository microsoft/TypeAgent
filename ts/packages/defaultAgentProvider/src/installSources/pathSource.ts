// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import {
    InstallSource,
    PathSourceConfig,
    InstalledAgentRecord,
    ResolvedCandidate,
} from "./config.js";
import { expandPath } from "./paths.js";

// `path` source (design §3, §4.1, §4.2, §12 Q17).
//   find        = fs.stat against the resolved path (cheap, side-effect free)
//   materialize = record { path, source }, omitting `module`
// `ref` is a filesystem path (absolute, "~"-relative, or relative to baseDir).
export function createPathSource(config: PathSourceConfig): InstallSource {
    const baseDir = config.baseDir;

    function resolveRef(ref: string): string {
        const expanded = expandPath(ref);
        if (path.isAbsolute(expanded)) {
            return path.resolve(expanded);
        }
        const base = baseDir ? expandPath(baseDir) : process.cwd();
        return path.resolve(base, expanded);
    }

    return {
        name: config.name,
        kind: "path",
        async find(ref: string): Promise<ResolvedCandidate | undefined> {
            const full = resolveRef(ref);
            try {
                await fs.promises.stat(full);
            } catch {
                return undefined; // non-match: the ordered walk continues
            }
            return { source: config.name, path: full };
        },
        async materialize(
            candidate: ResolvedCandidate,
        ): Promise<InstalledAgentRecord> {
            if (candidate.path === undefined) {
                throw new Error(
                    `path source '${config.name}' got a candidate without a path`,
                );
            }
            // The installer assigns the authoritative dispatcher name; default
            // to the directory basename so the record is self-consistent.
            const record: InstalledAgentRecord = {
                name: path.basename(candidate.path),
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
