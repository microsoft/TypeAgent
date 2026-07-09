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
    AvailableInstallRow,
} from "./config.js";
import { readPackageMeta, ambiguousDefaultNameError } from "./packageMeta.js";

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
//   find        = package-name lookup in the in-memory catalog snapshot
//   materialize = record data `path` (relative paths resolve against the
//                 catalog dir) or `module`; carries execMode; stores the key
//                 in `ref` so load can follow the catalog entry
//   load        = re-look-up the catalog key carried in the record's `ref`
// `ref` is an agent short name (the catalog key).
//
// A catalog entry with a `path` becomes a path-resolved record (omits
// `module`); an entry with only a package `name` becomes a module-resolved
// record (resolved at load time against the app bundle / install root).
//
// The catalog file and every `path` entry's package.json are read exactly ONCE,
// when the source is built, into an in-memory snapshot. There is no live reload:
// an edit to the catalog after startup is not picked up until the process
// restarts. Reading once keeps `find` / `findName` / `listAgents` off the
// filesystem entirely and avoids re-parsing every entry's package.json on each
// resolve walk.
export function createCatalogSource(
    config: CatalogSourceConfig,
): InstallSource {
    // The directory relative catalog `path` entries resolve against.
    const catalogDir = path.dirname(path.resolve(config.catalog));

    // Build the resolved candidate for one catalog entry, reading a `path`
    // entry's package.json (once, at build time) so the candidate carries the
    // user-facing package name and (when legal) the declared
    // `typeagent.defaultAgentName`. The catalog key stays the durable `ref`
    // (internal load handle). A malformed entry (neither `path` nor `name`)
    // pushes a warning and returns undefined so it is dropped from the snapshot.
    //
    // `module` vs `packageName`: a `path` entry sets `packageName` (its display
    // identity) but leaves `module` undefined - it is a path-resolved record. A
    // `name`-only entry sets both to the same value (`module` is the load handle
    // AND the display identity). They are kept as two fields so a path entry can
    // still advertise its package identity without becoming module-resolved.
    function buildCandidate(
        key: string,
        entry: { path?: string; name?: string; execMode?: string },
        warnings: string[],
    ): ResolvedCandidate | undefined {
        const resolvedPath = entry.path
            ? path.resolve(catalogDir, entry.path)
            : undefined;
        if (resolvedPath === undefined && entry.name === undefined) {
            warnings.push(
                `catalog source '${config.name}': entry '${key}' has neither 'path' nor 'name' - dropped`,
            );
            return undefined;
        }
        const candidate: ResolvedCandidate = { source: config.name, ref: key };
        if (resolvedPath !== undefined) {
            candidate.path = resolvedPath;
            const meta = readPackageMeta(resolvedPath);
            if (meta.packageName !== undefined) {
                candidate.packageName = meta.packageName;
            }
            if (meta.defaultAgentName !== undefined) {
                candidate.defaultAgentName = meta.defaultAgentName;
            } else if (meta.illegalDefaultAgentName !== undefined) {
                warnings.push(
                    `catalog source '${config.name}': entry '${key}' declares an illegal default agent name '${meta.illegalDefaultAgentName}' - ignored`,
                );
            }
        } else {
            // A module-only entry has no local package.json to read before
            // install, so it participates only in package-name (find) lookup.
            candidate.module = entry.name!;
            candidate.packageName = entry.name!;
        }
        if (entry.execMode !== undefined) {
            candidate.loaderConfig = { execMode: entry.execMode };
        }
        return candidate;
    }

    // The in-memory catalog snapshot, built once at startup. A
    // corrupt/unreadable catalog degrades to an empty snapshot (with a
    // `loadWarning`) so the ordered resolve walk in the registry continues to
    // the next source instead of hard-failing.
    interface CatalogSnapshot {
        // Resolved candidate per catalog key (only entries with a valid handle).
        readonly candidatesByKey: Map<string, ResolvedCandidate>;
        // Whole-file corruption/unreadable message, when the catalog failed to
        // load. Surfaced by every command (find/findName/listAgents).
        readonly loadWarning?: string;
        // Per-entry problems (a dropped malformed entry, an illegal declared
        // default name). Surfaced only by enumeration (listAgents), matching the
        // prior behavior where find/findName suppressed per-entry noise.
        readonly entryWarnings: readonly string[];
    }

    function buildSnapshot(): CatalogSnapshot {
        const entryWarnings: string[] = [];
        let catalog: AgentCatalog;
        try {
            catalog = loadCatalog(config.catalog);
        } catch (e) {
            return {
                candidatesByKey: new Map(),
                loadWarning: `catalog source '${config.name}': ${(e as Error).message}`,
                entryWarnings,
            };
        }
        const candidatesByKey = new Map<string, ResolvedCandidate>();
        for (const [key, entry] of Object.entries(catalog.agents)) {
            const candidate = buildCandidate(key, entry, entryWarnings);
            if (candidate !== undefined) {
                candidatesByKey.set(key, candidate);
            }
        }
        return { candidatesByKey, entryWarnings };
    }

    const snapshot = buildSnapshot();

    // Surface the whole-file corruption warning (if any) to the triggering
    // command. debug-trace it too so the server log shows it once per command
    // (the registry adds process-lifetime dedup). Used by find/findName.
    function warnLoad(onWarn?: SourceWarning): void {
        if (snapshot.loadWarning !== undefined) {
            debug(snapshot.loadWarning);
            onWarn?.(snapshot.loadWarning);
        }
    }

    // Surface the whole-file warning plus every per-entry warning. Used by
    // enumeration (listAgents), where per-entry problems are worth reporting.
    function warnAll(onWarn?: SourceWarning): void {
        warnLoad(onWarn);
        for (const message of snapshot.entryWarnings) {
            debug(message);
            onWarn?.(message);
        }
    }

    return {
        name: config.name,
        kind: "catalog",
        async find(
            ref: string,
            onWarn?: SourceWarning,
        ): Promise<ResolvedCandidate | undefined> {
            // `find` matches the entry's PACKAGE NAME (not the internal catalog
            // key, not the entry path). The key stays the durable load handle.
            // Only the whole-file corruption warning surfaces here; per-entry
            // problems are reported by enumeration (listAgents).
            warnLoad(onWarn);
            for (const candidate of snapshot.candidatesByKey.values()) {
                if (candidate.packageName === ref) {
                    return candidate;
                }
            }
            return undefined; // non-match: the ordered walk continues
        },
        async findName(
            name: string,
            onWarn?: SourceWarning,
        ): Promise<ResolvedCandidate | undefined> {
            // Phase-1 lookup: match the entry's declared
            // `typeagent.defaultAgentName`. Two entries declaring the same
            // default agent name is a same-source ambiguity (fail, list the
            // candidate packages).
            warnLoad(onWarn);
            const matches: ResolvedCandidate[] = [];
            for (const candidate of snapshot.candidatesByKey.values()) {
                if (candidate.defaultAgentName === name) {
                    matches.push(candidate);
                }
            }
            if (matches.length === 0) {
                return undefined; // non-match: the ordered walk continues
            }
            if (matches.length > 1) {
                const labels = matches.map(
                    (c) => c.packageName ?? c.path ?? c.ref ?? "?",
                );
                throw ambiguousDefaultNameError(config.name, name, labels);
            }
            return matches[0];
        },
        load(
            record: { ref?: string },
            onWarn?: SourceWarning,
        ): MaterializedInstallRecord | undefined {
            warnLoad(onWarn);
            if (record.ref === undefined) {
                throw new Error(
                    `catalog record has no key to load from (corrupt record).`,
                );
            }
            // Re-look-up the catalog key in the snapshot. A key that is no longer
            // present (or was dropped as malformed) resolves to undefined so the
            // provider reports the record unresolved.
            const candidate = snapshot.candidatesByKey.get(record.ref);
            if (candidate === undefined) {
                return undefined;
            }
            const loaded: MaterializedInstallRecord = {
                kind: "npm",
                source: config.name,
                ref: record.ref,
            };
            if (candidate.loaderConfig !== undefined) {
                loaded.loaderConfig = candidate.loaderConfig;
            }
            if (candidate.path !== undefined) {
                loaded.path = candidate.path;
            } else if (candidate.module !== undefined) {
                loaded.module = candidate.module;
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
        async listAgents(
            onWarn?: SourceWarning,
        ): Promise<AvailableInstallRow[]> {
            // Only advertise entries with a valid resolution handle; malformed
            // entries were warned + dropped when the snapshot was built and are
            // reported here (warnAll). Each row carries the default agent name
            // and/or package name a user can type; the catalog key rides along
            // only as the dedup `ref`.
            warnAll(onWarn);
            const rows: AvailableInstallRow[] = [];
            for (const [key, candidate] of snapshot.candidatesByKey) {
                if (
                    candidate.defaultAgentName === undefined &&
                    candidate.packageName === undefined
                ) {
                    continue;
                }
                rows.push({
                    source: config.name,
                    ref: key,
                    defaultAgentName: candidate.defaultAgentName,
                    packageName: candidate.packageName,
                });
            }
            return rows;
        },
    };
}
