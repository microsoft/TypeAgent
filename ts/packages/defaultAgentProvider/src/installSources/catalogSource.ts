// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import registerDebug from "debug";
import { NpmAppAgentInfo } from "dispatcher-node-providers";
import {
    InstallSource,
    CatalogSourceConfig,
    MaterializedInstallRecord,
    ResolvedCandidate,
    SourceWarning,
} from "./config.js";

const debug = registerDebug("typeagent:dispatcher:installSource:catalog");

// Catalog data model. A catalog is a JSON file listing the available agents:
// name -> NpmAppAgentInfo. A catalog source resolves an agent short name to a
// record on explicit `@package install`; nothing in a catalog is installed
// automatically. Catalogs are referenced by a local filesystem path; remote
// URLs are not supported.
type AgentCatalog = {
    description?: string;
    agents: Record<string, NpmAppAgentInfo>;
};

// Read + parse a catalog file, wrapping read/parse failures with the file path
// so callers get an actionable message instead of a bare JSON/ENOENT error.
function loadCatalog(file: string): AgentCatalog {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (e: unknown) {
        throw new Error(
            `Could not read catalog '${file}': ${
                e instanceof Error ? e.message : String(e)
            }`,
        );
    }
    try {
        return JSON.parse(text) as AgentCatalog;
    } catch (e: unknown) {
        throw new Error(
            `Catalog '${file}' is not valid JSON: ${
                e instanceof Error ? e.message : String(e)
            }`,
        );
    }
}

// `catalog` source.
//   find        = map lookup in the catalog JSON
//   materialize = record data `path` (relative paths resolve against the
//                 catalog dir) or `module`; carries execMode; stores the key
//                 in `ref` so load can follow the current catalog entry
//   load        = re-look-up the catalog key carried in the record's `ref`
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
    // The source reports each problem (debug trace + the caller's
    // per-command `onWarn` callback, when supplied) every time it is hit; it holds
    // no dedup state of its own. How often to show a repeat - once
    // per command vs. once per process for the server log - is up to the caller
    // (the registry adds process-lifetime console dedup).
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
    // (-> module). A matched entry must carry exactly one handle; an entry
    // with neither is a catalog authoring mistake. Rather than throw (which
    // would break the whole resolve walk) it is warned and dropped, i.e.
    // treated as a non-match - handled the same way as a corrupt file.
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
            // `ref` carries the matched catalog key for installer-level naming
            // and load refresh decisions.
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
        load(
            record: { ref?: string },
            onWarn?: SourceWarning,
        ): MaterializedInstallRecord | undefined {
            if (record.ref === undefined) {
                throw new Error(
                    `catalog record has no key to load from (corrupt record).`,
                );
            }
            const entry = read(onWarn).agents[record.ref];
            if (entry === undefined) {
                return undefined;
            }
            const handle = entryHandle(record.ref, entry, onWarn);
            if (handle === undefined) {
                return undefined;
            }
            const loaded: MaterializedInstallRecord = {
                kind: "npm",
                source: config.name,
                ref: record.ref,
            };
            if (entry.execMode !== undefined) {
                loaded.loaderConfig = { execMode: entry.execMode };
            }
            if (handle.path !== undefined) {
                loaded.path = handle.path;
            } else if (handle.module !== undefined) {
                loaded.module = handle.module;
            }
            return loaded;
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
            // The catalog key is this source's load handle: `find` always sets
            // it, so a candidate
            // without one is an invariant violation - fail fast rather than
            // persist a record `@package update` can never re-look-up. Stored even when
            // the agent was installed under a different dispatcher name than its
            // key (the record's own name is host-assigned, not stored here).
            if (candidate.ref === undefined) {
                throw new Error(
                    `catalog source '${config.name}' got a candidate without a key (ref)`,
                );
            }
            record.ref = candidate.ref;
            // Exactly one resolution handle.
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
