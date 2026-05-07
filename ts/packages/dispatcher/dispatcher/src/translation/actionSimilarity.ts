// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Static cross-schema action-similarity engine.
 *
 * Embeds each loaded action multiple times — one vector per signal
 * source — instead of one fused string.  Concatenating
 * `${schemaName}.${actionName}: ${description}` lets the schema name
 * tokens (`browser` / `desktop` / `vampire`) and camelCase action name
 * dominate cosine similarity and crowds out the semantic content we
 * actually want.  Embedding sources independently lets each signal
 * speak for itself; the aggregate score combines them.
 *
 * Vectors per action:
 *   - `desc`     — JSDoc description text only.  Captures intent.
 *                  Skipped when an action has no description.
 *   - `params`   — parameter property names + their JSDoc, joined.
 *                  Single-string-input vs structured shape.  Skipped
 *                  when the action takes no parameters.
 *   - `combined` — description + parameter doc as one prose blob.
 *                  Always present (or if both desc and params are
 *                  missing, falls back to action JSDoc + name as a
 *                  last-resort text).  Catches reinforcing signals.
 *
 * Aggregation: `aggregateScore = max(scores) + 0.3 * min(scores)` over
 * the vectors that are present on both sides.  This rewards a strong
 * agreement on at least one signal with a small bonus when other
 * signals also align.  Tunable; calibrate against a labeled pair set
 * once we have one (Phase 5 / S4 cross-pollination).
 *
 * Output is JSON-serializable so callers can dump to disk for offline
 * analysis (mirrors `analyze-grammar-collisions`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { ActionSchemaTypeDefinition } from "@typeagent/action-schema";
import {
    generateTextEmbeddingsWithRetry,
    NormalizedEmbedding,
    similarity,
    SimilarityType,
} from "typeagent";
import { TextEmbeddingModel, openai } from "aiclient";
import registerDebug from "debug";
import { ActionSchemaFile } from "./actionConfigProvider.js";
import { ActionConfig } from "./actionConfig.js";

const debug = registerDebug("typeagent:dispatcher:action-similarity");

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

export type ActionVectorKey = "desc" | "params" | "combined";

export interface ActionSimilarityEntry {
    schemaName: string;
    agentName?: string | undefined;
    actionName: string;
    description?: string | undefined;
    paramSummary?: string | undefined;
    /** Number of top-level parameter fields, or 0 when no params. */
    paramCount: number;
    /** The text we embedded under each vector key (sans embedding payload). */
    vectorTexts: Partial<Record<ActionVectorKey, string>>;
}

export interface ActionSimilarityPair {
    /** Canonical key — alphabetical schema-then-action ordering. */
    keyA: { schemaName: string; actionName: string };
    keyB: { schemaName: string; actionName: string };
    /** Cosine similarity per vector; undefined when either side lacks that vector. */
    scores: Partial<Record<ActionVectorKey, number>>;
    /** Aggregate score across present vectors (see module docstring). */
    aggregateScore: number;
    /** Convenience copies for the report — descriptions of both actions. */
    descriptionA?: string | undefined;
    descriptionB?: string | undefined;
}

export interface ActionSimilarityScanResult {
    scannedAt: string;
    actionCount: number;
    schemaCount: number;
    /** Threshold the caller filtered by. */
    threshold: number;
    entries: ActionSimilarityEntry[];
    /** Pairs where aggregateScore ≥ threshold, sorted descending. */
    pairs: ActionSimilarityPair[];
}

export interface ActionSimilarityScanInput {
    schemaName: string;
    agentName?: string | undefined;
    actionSchemaFile: ActionSchemaFile;
}

export interface ActionSimilarityScanOptions {
    /** Threshold on aggregateScore.  Default 0.7. */
    threshold?: number;
    /** Embedding model to reuse; created on demand if absent. */
    model?: TextEmbeddingModel;
    /**
     * Path to a JSON file caching individual vectors keyed by
     * (vectorKey, textHash).  Persisted across runs so unchanged
     * actions don't re-embed.  Pass undefined to skip caching.
     */
    cachePath?: string | undefined;
    /** Per-step progress callback. */
    onProgress?: (
        phase: "embedding" | "scoring",
        index: number,
        total: number,
        label?: string,
    ) => void;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const AGGREGATE_MIN_BONUS = 0.3;

/**
 * Run a static action-similarity scan across the supplied agents.
 * Returns one entry per action and one pair per cross-schema action
 * pair whose aggregate score meets the threshold.  Pairs are sorted by
 * aggregate score descending; entries are returned in input order.
 */
export async function computeActionSimilarity(
    inputs: ActionSimilarityScanInput[],
    options: ActionSimilarityScanOptions = {},
): Promise<ActionSimilarityScanResult> {
    const threshold = options.threshold ?? 0.7;
    const model = options.model ?? openai.createEmbeddingModel();
    const onProgress = options.onProgress ?? (() => {});

    // ---- Phase 1: enumerate actions and derive vector texts ----

    const entries: ActionSimilarityEntry[] = [];
    for (const input of inputs) {
        const actionMap =
            input.actionSchemaFile.parsedActionSchema.actionSchemas;
        for (const [actionName, definition] of actionMap) {
            entries.push(
                buildEntry(
                    input.schemaName,
                    input.agentName,
                    actionName,
                    definition,
                ),
            );
        }
    }
    debug(
        `Building entries: ${entries.length} action(s) across ${inputs.length} schema(s).`,
    );

    // ---- Phase 2: embed all unique (vectorKey, text) tuples ----

    const cache = await loadEmbeddingCache(options.cachePath);
    const cacheUpdated = await embedAllVectors(
        entries,
        model,
        cache,
        onProgress,
    );
    if (cacheUpdated && options.cachePath) {
        await saveEmbeddingCache(options.cachePath, cache);
    }

    // ---- Phase 3: pairwise scoring across distinct schemas ----

    const pairs: ActionSimilarityPair[] = [];
    let pairIndex = 0;
    const totalPairs = (entries.length * (entries.length - 1)) / 2;
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            pairIndex++;
            if (pairIndex % 500 === 0) {
                onProgress(
                    "scoring",
                    pairIndex,
                    totalPairs,
                    `${entries[i].schemaName}.${entries[i].actionName} × ${entries[j].schemaName}.${entries[j].actionName}`,
                );
            }
            // Cross-schema only — within-schema collisions belong to a
            // different analysis (the agent's own grammar / disambiguation).
            if (entries[i].schemaName === entries[j].schemaName) continue;

            const pair = scorePair(entries[i], entries[j], cache);
            if (pair && pair.aggregateScore >= threshold) {
                pairs.push(pair);
            }
        }
    }

    // Canonical sort: aggregate score descending, then alphabetical for
    // stable diffs across runs.
    pairs.sort((a, b) => {
        if (b.aggregateScore !== a.aggregateScore) {
            return b.aggregateScore - a.aggregateScore;
        }
        const ka = `${a.keyA.schemaName}.${a.keyA.actionName}|${a.keyB.schemaName}.${a.keyB.actionName}`;
        const kb = `${b.keyA.schemaName}.${b.keyA.actionName}|${b.keyB.schemaName}.${b.keyB.actionName}`;
        return ka.localeCompare(kb);
    });

    const schemaSet = new Set(entries.map((e) => e.schemaName));
    return {
        scannedAt: new Date().toISOString(),
        actionCount: entries.length,
        schemaCount: schemaSet.size,
        threshold,
        entries,
        pairs,
    };
}

// ---------------------------------------------------------------------------
// Vector text derivation
// ---------------------------------------------------------------------------

function buildEntry(
    schemaName: string,
    agentName: string | undefined,
    actionName: string,
    definition: ActionSchemaTypeDefinition,
): ActionSimilarityEntry {
    const description = definition.comments?.[0]?.trim() || undefined;
    const paramSummary = describeParameters(definition);
    const paramCount = paramSummary ? countParameters(definition) : 0;

    // Vector texts intentionally omit schemaName and actionName — those
    // tokens dominate cosine similarity (camelCase tokenizes
    // unpredictably; schema names like "browser" / "vampire" are large
    // signal that has nothing to do with semantic overlap of behavior).
    const vectorTexts: Partial<Record<ActionVectorKey, string>> = {};
    if (description) {
        vectorTexts.desc = description;
    }
    if (paramSummary) {
        vectorTexts.params = paramSummary;
    }
    if (description || paramSummary) {
        vectorTexts.combined = [description, paramSummary]
            .filter(Boolean)
            .join("\n");
    } else {
        // Last-resort fallback: at least give the embedding *something*
        // to work with so totally undocumented actions still cluster.
        // This reintroduces actionName tokens for the combined vector
        // only — a deliberate compromise to avoid silently dropping
        // actions from the analysis.
        vectorTexts.combined = `Action ${actionName}`;
    }

    return {
        schemaName,
        agentName,
        actionName,
        description,
        paramSummary,
        paramCount,
        vectorTexts,
    };
}

/**
 * Render the parameter object as `${name}: ${doc}` lines.  Drop names
 * because they often duplicate type structure information; keep both
 * the property name and its JSDoc since that's where authors put real
 * intent ("the URL of the page to open" vs `url: string`).
 */
function describeParameters(
    definition: ActionSchemaTypeDefinition,
): string | undefined {
    const params = definition.type.fields["parameters"];
    if (!params) return undefined;
    const paramType = params.type;
    if (paramType.type !== "object") return undefined;
    const lines: string[] = [];
    for (const [propName, propField] of Object.entries(paramType.fields)) {
        const propDoc = (propField.comments ?? [])
            .map((c) => c.trim())
            .filter(Boolean)
            .join(" ");
        lines.push(propDoc ? `${propName}: ${propDoc}` : propName);
    }
    return lines.length > 0 ? lines.join("\n") : undefined;
}

function countParameters(definition: ActionSchemaTypeDefinition): number {
    const params = definition.type.fields["parameters"];
    if (!params) return 0;
    const paramType = params.type;
    if (paramType.type !== "object") return 0;
    return Object.keys(paramType.fields).length;
}

// ---------------------------------------------------------------------------
// Embedding (with cache)
// ---------------------------------------------------------------------------

type EmbeddingCacheMap = Map<string, NormalizedEmbedding>;

function cacheKey(vectorKey: ActionVectorKey, text: string): string {
    const hash = createHash("sha256")
        .update(`${vectorKey}\n${text}`)
        .digest("hex")
        .slice(0, 16);
    return `${vectorKey}:${hash}`;
}

async function embedAllVectors(
    entries: ActionSimilarityEntry[],
    model: TextEmbeddingModel,
    cache: EmbeddingCacheMap,
    onProgress: NonNullable<ActionSimilarityScanOptions["onProgress"]>,
): Promise<boolean> {
    // Collect every (vectorKey, text) tuple that isn't cached, dedupe
    // by cache key (multiple actions might have the same paramSummary).
    const missingByKey = new Map<string, string>(); // cacheKey → text
    for (const entry of entries) {
        for (const [vectorKey, text] of Object.entries(entry.vectorTexts) as [
            ActionVectorKey,
            string,
        ][]) {
            const key = cacheKey(vectorKey, text);
            if (!cache.has(key)) {
                missingByKey.set(key, text);
            }
        }
    }

    if (missingByKey.size === 0) {
        debug("Embedding cache hit for every vector.");
        return false;
    }

    const missingEntries = Array.from(missingByKey.entries());
    const missingTexts = missingEntries.map(([, text]) => text);
    debug(
        `Embedding ${missingEntries.length} missing vector(s) (cache hit ratio ${(
            ((entries.length * 3 - missingEntries.length) /
                (entries.length * 3)) *
            100
        ).toFixed(1)}%).`,
    );
    onProgress(
        "embedding",
        0,
        missingEntries.length,
        `${missingEntries.length} vectors`,
    );

    const start = Date.now();
    const embeddings = await generateTextEmbeddingsWithRetry(
        model,
        missingTexts,
    );
    debug(
        `Embedded ${embeddings.length} vector(s) in ${Date.now() - start}ms.`,
    );

    for (let i = 0; i < missingEntries.length; i++) {
        cache.set(missingEntries[i][0], embeddings[i]);
    }

    onProgress(
        "embedding",
        missingEntries.length,
        missingEntries.length,
        "done",
    );
    return true;
}

async function loadEmbeddingCache(
    cachePath: string | undefined,
): Promise<EmbeddingCacheMap> {
    const cache: EmbeddingCacheMap = new Map();
    if (!cachePath || !fs.existsSync(cachePath)) return cache;
    try {
        const raw = await fs.promises.readFile(cachePath, "utf8");
        const data = JSON.parse(raw) as [string, string][];
        for (const [key, encoded] of data) {
            cache.set(key, decodeEmbedding(encoded));
        }
        debug(`Loaded ${cache.size} cached embeddings from ${cachePath}.`);
    } catch (err) {
        debug(
            `Failed to load embedding cache at ${cachePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    return cache;
}

async function saveEmbeddingCache(
    cachePath: string,
    cache: EmbeddingCacheMap,
): Promise<void> {
    try {
        await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
        const data: [string, string][] = [];
        for (const [key, vec] of cache) {
            data.push([key, encodeEmbedding(vec)]);
        }
        await fs.promises.writeFile(cachePath, JSON.stringify(data));
        debug(`Saved ${cache.size} embeddings to ${cachePath}.`);
    } catch (err) {
        debug(
            `Failed to save embedding cache: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

function encodeEmbedding(embedding: NormalizedEmbedding): string {
    return Buffer.from(embedding.buffer).toString("base64");
}

function decodeEmbedding(encoded: string): NormalizedEmbedding {
    const buf = Buffer.from(encoded, "base64");
    return new Float32Array(
        buf.buffer,
        buf.byteOffset,
        buf.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
}

// ---------------------------------------------------------------------------
// Pairwise scoring
// ---------------------------------------------------------------------------

function scorePair(
    a: ActionSimilarityEntry,
    b: ActionSimilarityEntry,
    cache: EmbeddingCacheMap,
): ActionSimilarityPair | undefined {
    const scores: Partial<Record<ActionVectorKey, number>> = {};
    for (const vectorKey of ["desc", "params", "combined"] as const) {
        const textA = a.vectorTexts[vectorKey];
        const textB = b.vectorTexts[vectorKey];
        if (!textA || !textB) continue;
        const vecA = cache.get(cacheKey(vectorKey, textA));
        const vecB = cache.get(cacheKey(vectorKey, textB));
        if (!vecA || !vecB) continue;
        scores[vectorKey] = similarity(vecA, vecB, SimilarityType.Dot);
    }
    const present = Object.values(scores) as number[];
    if (present.length === 0) return undefined;
    const aggregate = aggregateScores(present);
    return {
        keyA: { schemaName: a.schemaName, actionName: a.actionName },
        keyB: { schemaName: b.schemaName, actionName: b.actionName },
        scores,
        aggregateScore: aggregate,
        descriptionA: a.description,
        descriptionB: b.description,
    };
}

/**
 * Combine per-vector scores into a single ranking metric.  Rewards a
 * strong agreement on any signal (max), with a small bonus when other
 * signals also align (min).  Tunable; we'll calibrate against a
 * labeled set in Phase 5 / S4.
 */
function aggregateScores(scores: number[]): number {
    if (scores.length === 0) return 0;
    if (scores.length === 1) return scores[0];
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    return max + AGGREGATE_MIN_BONUS * min;
}

// ---------------------------------------------------------------------------
// Convenience for callers that already have ActionConfig + ActionSchemaFile
// ---------------------------------------------------------------------------

/**
 * Build an `ActionSimilarityScanInput` from a dispatcher `ActionConfig`
 * and its already-loaded `ActionSchemaFile`.  Just a tiny adapter so
 * callers don't have to duplicate the field plumbing.
 */
export function toScanInput(
    config: ActionConfig,
    actionSchemaFile: ActionSchemaFile,
    agentName?: string,
): ActionSimilarityScanInput {
    return {
        schemaName: config.schemaName,
        agentName,
        actionSchemaFile,
    };
}
