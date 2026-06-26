// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import registerDebug from "debug";
import {
    InstallSource,
    InstalledAgentRecord,
    CatalogSourceConfig,
    ResolvedCandidate,
} from "agent-dispatcher";
import {
    AgentCatalog,
    BUNDLED_CATALOG,
    getBundledCatalogPath,
    loadCatalog,
} from "./catalog.js";

const debug = registerDebug("typeagent:dispatcher:installSource:catalog");

// `catalog` source (design §3, §4.1, §4.2, §12 Q6, Q17, Q19).
//   find        = map lookup in the catalog JSON (incl. "<bundled>")
//   materialize = record `path` (relative paths resolve against the catalog
//                 dir) or `module`; carries execMode
// `ref` is an agent short name (the catalog key).
//
// A catalog entry with a `path` becomes a path-resolved record (omits
// `module`); an entry with only a package `name` becomes a module-resolved
// record (resolved at load time against the app bundle / install root).
export function createCatalogSource(
    config: CatalogSourceConfig,
): InstallSource {
    // The directory relative catalog `path` entries resolve against.
    const catalogDir =
        config.catalog === BUNDLED_CATALOG
            ? path.dirname(getBundledCatalogPath())
            : path.dirname(path.resolve(config.catalog));

    // Re-read on each access so an edited workspace catalog is picked up; the
    // bundled catalog is memoized inside loadCatalog. A corrupt/unreadable
    // *user* catalog degrades to "no agents" (logged) so the ordered resolve
    // walk in the registry continues to the next source instead of hard-
    // failing. The bundled catalog is a build artifact, so a failure there is a
    // packaging bug and is surfaced loudly rather than masked.
    function read(): AgentCatalog {
        if (config.catalog === BUNDLED_CATALOG) {
            return loadCatalog(config.catalog);
        }
        try {
            return loadCatalog(config.catalog);
        } catch (e) {
            debug(`catalog source '${config.name}': ${(e as Error).message}`);
            return { agents: {} };
        }
    }

    return {
        name: config.name,
        kind: "catalog",
        async find(ref: string): Promise<ResolvedCandidate | undefined> {
            const entry = read().agents[ref];
            if (entry === undefined) {
                return undefined; // non-match: the ordered walk continues
            }
            const resolvedPath = entry.path
                ? path.resolve(catalogDir, entry.path)
                : undefined;
            // `ref` carries the matched catalog key so materialize can use it
            // as the default dispatcher name (not propagated to the record;
            // catalog records have no `ref`).
            const candidate: ResolvedCandidate = { source: config.name, ref };
            if (resolvedPath !== undefined) {
                candidate.path = resolvedPath;
            } else {
                candidate.module = entry.name;
            }
            if (entry.execMode !== undefined) {
                candidate.execMode = entry.execMode;
            }
            return candidate;
        },
        async materialize(
            candidate: ResolvedCandidate,
        ): Promise<InstalledAgentRecord> {
            const name = candidate.ref ?? candidate.module ?? config.name;
            const record: InstalledAgentRecord = {
                name,
                kind: "npm",
                source: config.name,
            };
            if (candidate.execMode !== undefined) {
                record.execMode = candidate.execMode;
            }
            // Exactly one resolution handle (§4.2, Q17).
            if (candidate.path !== undefined) {
                record.path = candidate.path;
            } else if (candidate.module !== undefined) {
                record.module = candidate.module;
            }
            return record;
        },
        async listAgents(): Promise<string[]> {
            return Object.keys(read().agents);
        },
    };
}
