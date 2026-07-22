// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Construction-cache layer for the live (working-tree) replay side.
 *
 * Where the grammar resolver answers "does the agent's grammar resolve this
 * utterance," this answers the dispatcher's *first* question: "does the agent's
 * live construction cache already resolve it." The default dispatcher is
 * completion-based — it consults the construction store before the grammar — so
 * a faithful replay of the working-tree side should report a construction
 * `hit` distinct from a grammar-only resolution.
 *
 * **Live-side only, by design.** Construction caches are runtime artifacts: the
 * dispatcher writes them per session under the instance dir and they are never
 * committed. So a cache can only be consulted for the working-tree side, never
 * read at an arbitrary git ref. This sharpens the "did my edit change what the
 * cache already resolves" story without pretending to generalize to ref-vs-ref.
 *
 * **Faithful hash gate.** The dispatcher namespaces constructions by
 * `schemaName,<schemaFileHash>` and refuses to match a construction whose hash
 * no longer equals the current schema's (`isValidActionSchemaFileHash`). We
 * reproduce that exactly: {@link reproduceSchemaSourceHash} recomputes the
 * schema-file hash the dispatcher would compute for the working tree, and the
 * layer only matches when it equals the hash stored in the cache's namespace.
 * A schema edit changes the hash → the cached constructions go `stale` → the
 * live side falls back to the grammar path, which is precisely the regression
 * signal. When the cache file is missing (the agent was never run) the status
 * is `absent` and the resolver degrades cleanly to the grammar match.
 */

import { readFile } from "node:fs/promises";
import {
    computeActionSchemaFileHash,
    loadConstructionCacheFile,
    type ConstructionCache,
    type MatchResult,
} from "agent-cache";
import { normalizeAction } from "./replayActionShape.js";
import type { ConstructionCacheEntryDto } from "./resolutionTrace.js";

/**
 * Inputs to the dispatcher's schema-file hash. Mirrors
 * `ActionSchemaFileCache.getActionSchemaFile`: the hash is
 * `sha256_base64(JSON.stringify(schemaType), source[, config])`, where `source`
 * is the schema artifact the dispatcher loads (the built `.pas.json` when the
 * manifest has a `schemaFile`, otherwise the `.ts`) and `config` is the sidecar
 * paramSpec JSON — present only for `.ts` schemas (`.pas.json` carries no
 * sidecar; see `loadSchemaFile`).
 */
export interface SchemaHashInput {
    /** The manifest's `schema.schemaType` (`{ action, entity? }`). */
    schemaType: Record<string, unknown>;
    /** Raw content of the schema artifact the dispatcher hashes. */
    source: string;
    /** Sidecar paramSpec config content; omit for `.pas.json` schemas. */
    config?: string;
}

/**
 * Recompute the dispatcher's schema-file `sourceHash` so the resulting namespace
 * key equals the one the dispatcher stamped into the cache. Delegates to the
 * shared {@link computeActionSchemaFileHash}, the single source of truth the
 * dispatcher's schema cache also uses, so the two cannot drift.
 */
export function reproduceSchemaSourceHash(input: SchemaHashInput): string {
    return computeActionSchemaFileHash(
        input.schemaType,
        input.source,
        input.config,
    );
}

export type ConstructionCacheStatus =
    /** The cache has a namespace for this schema whose hash matches the working
     *  tree — constructions are consulted. */
    | "valid"
    /** The cache has a namespace for this schema but its hash no longer matches
     *  (the schema was edited/rebuilt since the cache was written). */
    | "stale"
    /** No cache file, or no namespace for this schema in it. */
    | "absent";

export interface ConstructionCacheLayer {
    readonly status: ConstructionCacheStatus;
    readonly cacheFilePath: string;
    readonly schemaName: string;
    /** Working-tree schema-file hash we computed. */
    readonly currentHash: string;
    /** Schema-file hash stored in the cache's namespace, when present. */
    readonly cachedHash: string | undefined;
    /**
     * Match an utterance against the live construction cache. Returns the
     * normalized action when a construction matches AND the cache is `valid`;
     * otherwise `undefined` (the caller falls back to the grammar path).
     */
    match(utterance: string): Record<string, unknown> | undefined;
    /**
     * As {@link match}, but returns the matched construction's inspectable
     * identity (id, namespace, rendered parts, ranking scores) alongside the
     * action, so a trace can show which cache entry resolved the utterance.
     * `undefined` on the same conditions as {@link match}.
     */
    matchEntry(utterance: string): ConstructionCacheEntryDto | undefined;
}

/**
 * Resolve the dispatcher-faithful schema-file hash for the working tree.
 * Mirrors `loadSchemaFile`: when a built `.pas.json` exists it is hashed with no
 * sidecar config; otherwise the `.ts` source is hashed together with its sibling
 * paramSpec config (when present). Returns `undefined` when the artifact can't be
 * read, which leaves replay at the grammar match (no construction-cache consult).
 */
export interface WorkingTreeSchemaHashInput {
    /** Manifest's raw `schema.schemaType` (`{ action, entity? }`). */
    schemaType: Record<string, unknown>;
    /** Absolute path to the built `.pas.json`, when the manifest declares one. */
    builtSchemaFilePath?: string;
    /** Absolute path to the `.ts` source (fallback when no built schema). */
    sourceFilePath: string;
    /** Absolute path to the sibling paramSpec config (`.ts` path only). */
    paramSpecConfigPath?: string;
}

export async function computeWorkingTreeSchemaHash(
    input: WorkingTreeSchemaHashInput,
): Promise<string | undefined> {
    try {
        if (input.builtSchemaFilePath !== undefined) {
            const source = await readFile(input.builtSchemaFilePath, "utf8");
            return reproduceSchemaSourceHash({
                schemaType: input.schemaType,
                source,
            });
        }
        const source = await readFile(input.sourceFilePath, "utf8");
        const config =
            input.paramSpecConfigPath !== undefined
                ? await readFile(input.paramSpecConfigPath, "utf8")
                : undefined;
        return reproduceSchemaSourceHash({
            schemaType: input.schemaType,
            source,
            ...(config !== undefined ? { config } : {}),
        });
    } catch {
        return undefined;
    }
}

interface ConstructionCacheFileJSON {
    constructionNamespaces?: { name?: unknown }[];
}

/**
 * Find the stored namespace for `schemaName` in a parsed cache file and extract
 * its schema-file hash. Cache namespaces are keyed as
 * `schemaName,<hash>,<activityName>`; the activity portion may be empty. Only
 * single-schema namespaces (not combined `a,..|b,..` namespaces) are
 * considered — the single-grammar replay resolver targets standalone agents,
 * and a combined namespace would require validating every member's hash.
 */
function findSchemaNamespace(
    json: ConstructionCacheFileJSON,
    schemaName: string,
): { namespaceName: string; hash: string | undefined } | undefined {
    const namespaces = json.constructionNamespaces;
    if (!Array.isArray(namespaces)) {
        return undefined;
    }
    for (const ns of namespaces) {
        const name = ns?.name;
        if (typeof name !== "string") {
            continue;
        }
        // Skip combined multi-schema namespaces.
        if (name.includes("|")) {
            continue;
        }
        const [foundSchemaName, hash, activityName] = name.split(",", 3);
        // Activity can be empty; only the schema and hash gate cache validity.
        void activityName;
        if (foundSchemaName === schemaName) {
            return {
                namespaceName: name,
                hash: hash !== "" ? hash : undefined,
            };
        }
    }
    return undefined;
}

/** Pull the underlying action object out of the top construction match. */
function topConstructionAction(results: MatchResult[]): unknown {
    const top = results[0];
    if (top === undefined) {
        return undefined;
    }
    const actions = top.match.actions;
    return actions.length > 0 ? actions[0].action : undefined;
}

export interface LoadConstructionCacheLayerOptions {
    cacheFilePath: string;
    schemaName: string;
    /** Working-tree schema-file hash (via {@link reproduceSchemaSourceHash}). */
    currentHash: string;
}

/**
 * Load a {@link ConstructionCacheLayer} for one agent from a construction cache
 * file. Resolves to an `absent` layer (never throws) when the file is missing or
 * unparseable, so a missing live cache degrades replay to the grammar match rather than failing
 * the run. The heavier {@link ConstructionCache} is materialized only when the
 * namespace hash validates, so a stale cache costs only a JSON read.
 */
export async function loadConstructionCacheLayer(
    opts: LoadConstructionCacheLayerOptions,
): Promise<ConstructionCacheLayer> {
    const { cacheFilePath, schemaName, currentHash } = opts;

    const absent = (cachedHash?: string): ConstructionCacheLayer => ({
        status: "absent",
        cacheFilePath,
        schemaName,
        currentHash,
        cachedHash,
        match: () => undefined,
        matchEntry: () => undefined,
    });

    let json: ConstructionCacheFileJSON;
    try {
        json = JSON.parse(
            await readFile(cacheFilePath, "utf8"),
        ) as ConstructionCacheFileJSON;
    } catch {
        return absent();
    }

    const found = findSchemaNamespace(json, schemaName);
    if (found === undefined) {
        return absent();
    }
    if (found.hash !== currentHash) {
        return {
            status: "stale",
            cacheFilePath,
            schemaName,
            currentHash,
            cachedHash: found.hash,
            match: () => undefined,
            matchEntry: () => undefined,
        };
    }

    let cache: ConstructionCache | undefined;
    try {
        cache = await loadConstructionCacheFile(cacheFilePath);
    } catch {
        // The namespace metadata parsed but the cache body did not load —
        // degrade rather than fail the run.
        return absent(found.hash);
    }
    if (cache === undefined) {
        return absent(found.hash);
    }
    const loadedCache = cache;

    const namespaceKeys = [found.namespaceName];
    const namespaceName = found.namespaceName;
    return {
        status: "valid",
        cacheFilePath,
        schemaName,
        currentHash,
        cachedHash: found.hash,
        match(utterance: string): Record<string, unknown> | undefined {
            const results = loadedCache.match(utterance, { namespaceKeys });
            if (results.length === 0) {
                return undefined;
            }
            return normalizeAction(schemaName, topConstructionAction(results));
        },
        matchEntry(utterance: string): ConstructionCacheEntryDto | undefined {
            const results = loadedCache.match(utterance, { namespaceKeys });
            const top = results[0];
            if (top === undefined) {
                return undefined;
            }
            const action = normalizeAction(
                schemaName,
                topConstructionAction(results),
            );
            if (action === undefined) {
                return undefined;
            }
            return {
                action,
                constructionId: top.construction.id.toString(),
                namespace: namespaceName,
                parts: top.construction.parts.map((part) => part.toString()),
                scores: {
                    matchedCount: top.matchedCount,
                    wildcardCharCount: top.wildcardCharCount,
                    nonOptionalCount: top.nonOptionalCount,
                },
                cacheFileId: cacheFilePath,
            };
        },
    };
}
