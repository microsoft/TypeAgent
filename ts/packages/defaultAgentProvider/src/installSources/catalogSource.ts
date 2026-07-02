// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import registerDebug from "debug";
import {
    InstallSource,
    CatalogSourceConfig,
    MaterializedInstallRecord,
    ResolvedCandidate,
    SourceWarning,
} from "./config.js";
import { AgentCatalog, loadCatalog } from "./catalog.js";

const debug = registerDebug("typeagent:dispatcher:installSource:catalog");

// `catalog` source (design §3, §4.1, §4.2, §12 Q6, Q17, Q19).
//   find        = map lookup in the catalog JSON
//   materialize = record data `path` (relative paths resolve against the
//                 catalog dir) or `module`; carries execMode
// `ref` is an agent short name (the catalog key).
//
// A catalog entry with a `path` becomes a path-resolved record (omits
// `module`); an entry with only a package `name` becomes a module-resolved
// record (resolved at load time against the app bundle / install root).
export function createCatalogSource(
    config: CatalogSourceConfig,
): InstallSource {
    // The directory relative catalog `path` entries resolve against.
    const catalogDir = path.dirname(path.resolve(config.catalog));

    // Catalog problems (a corrupt/unreadable file, a malformed entry) degrade
    // to "no agents" / a dropped entry so the ordered resolve walk continues.
    // The source just *reports* each problem (debug trace + the caller's
    // per-command `onWarn` sink, when supplied) every time it is hit; it holds
    // no dedup state of its own. Deciding how often to surface a repeat - once
    // per command vs. once per process for the server log - is the caller's
    // policy (the registry adds the process-lifetime console dedup; §4.1).
    function warn(message: string, onWarn?: SourceWarning): void {
        debug(message);
        onWarn?.(message);
    }

    // Re-read on each access so an edited catalog is picked up. A
    // corrupt/unreadable catalog degrades to "no agents" so the ordered resolve
    // walk in the registry continues to the next source instead of hard-failing.
    function read(onWarn?: SourceWarning): AgentCatalog {
        try {
            return loadCatalog(config.catalog);
        } catch (e) {
            warn(
                `catalog source '${config.name}': ${(e as Error).message}`,
                onWarn,
            );
            return { agents: {} };
        }
    }

    // Resolve a catalog entry to its single resolution handle - a `path`
    // (relative paths resolve against the catalog dir) or a package `name`
    // (-> module). A matched entry must carry exactly one (§4.2, Q17); an entry
    // with neither is a catalog authoring mistake. Rather than throw (which
    // would break the whole resolve walk) it is warned and dropped, i.e.
    // treated as a non-match - the same degrade philosophy as a corrupt file.
    // Returns undefined for a dropped entry.
    function entryHandle(
        ref: string,
        entry: { path?: string; name?: string },
        onWarn?: SourceWarning,
    ): { path?: string; module?: string } | undefined {
        const resolvedPath = entry.path
            ? path.resolve(catalogDir, entry.path)
            : undefined;
        if (resolvedPath === undefined && entry.name === undefined) {
            warn(
                `catalog source '${config.name}': entry '${ref}' has neither 'path' nor 'name' - dropped`,
                onWarn,
            );
            return undefined;
        }
        return resolvedPath !== undefined
            ? { path: resolvedPath }
            : { module: entry.name! };
    }

    return {
        name: config.name,
        kind: "catalog",
        async find(
            ref: string,
            onWarn?: SourceWarning,
        ): Promise<ResolvedCandidate | undefined> {
            const entry = read(onWarn).agents[ref];
            if (entry === undefined) {
                return undefined; // non-match: the ordered walk continues
            }
            const handle = entryHandle(ref, entry, onWarn);
            if (handle === undefined) {
                return undefined; // malformed entry dropped -> non-match
            }
            // `ref` carries the matched catalog key for installer-level
            // naming/re-resolution decisions (catalog records have no `ref`).
            const candidate: ResolvedCandidate = { source: config.name, ref };
            if (handle.path !== undefined) {
                candidate.path = handle.path;
            } else if (handle.module !== undefined) {
                candidate.module = handle.module;
            }
            if (entry.execMode !== undefined) {
                candidate.loaderConfig = { execMode: entry.execMode };
            }
            return candidate;
        },
        async materialize(
            candidate: ResolvedCandidate,
        ): Promise<MaterializedInstallRecord> {
            const record: MaterializedInstallRecord = {
                kind: "npm",
                source: config.name,
            };
            if (candidate.loaderConfig !== undefined) {
                record.loaderConfig = candidate.loaderConfig;
            }
            // Exactly one resolution handle (§4.2, Q17).
            if (candidate.path !== undefined) {
                record.path = candidate.path;
            } else if (candidate.module !== undefined) {
                record.module = candidate.module;
            }
            return record;
        },
        async listAgents(onWarn?: SourceWarning): Promise<string[]> {
            // Only advertise entries with a valid resolution handle; malformed
            // entries are warned + dropped here too (same as find), never listed.
            const agents = read(onWarn).agents;
            return Object.keys(agents).filter(
                (ref) => entryHandle(ref, agents[ref], onWarn) !== undefined,
            );
        },
    };
}
