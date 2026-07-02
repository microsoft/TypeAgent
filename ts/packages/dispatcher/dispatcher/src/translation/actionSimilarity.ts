// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Static cross-schema action-similarity engine, S1.1.
 *
 * Embeds each loaded action under multiple independent vectors and
 * scores cross-schema pairs under one or more **strategies** — named
 * recipes for which vectors contribute to a similarity score.  No
 * single embedding is privileged; the caller picks the strategy whose
 * hypothesis they want to test, or runs several side-by-side.
 *
 * Why multiple vectors instead of one combined string: concatenating
 * `${schemaName}.${actionName}: ${description}` lets the schema name
 * and camelCase action tokens dominate cosine similarity.  Schema name
 * is large signal that has nothing to do with semantic overlap of
 * behavior; camelCase tokenizes unpredictably.  Embedding sources
 * independently lets each signal speak for itself.
 *
 * Why multiple strategies: different signals matter for different
 * agents.  Action descriptions are *optional* — the system routes
 * without them — so a strategy that requires desc on both sides drops
 * a lot of real actions silently.  Better to ship strategies that work
 * with whatever metadata the agent author chose to write, and let the
 * comparison surface where each one over- or under-counts.
 *
 * Vector keys:
 *   - `desc`            — action JSDoc description only
 *   - `params`          — parameter property names + JSDoc, joined
 *   - `combined`        — description + params (when either present)
 *   - `nameShape`       — humanized actionName + params
 *   - `agentContext`    — agent manifest description + humanized
 *                         actionName + params
 *   - `agentAndAction`  — agent manifest description + action
 *                         description + params (kitchen sink when
 *                         everything is documented)
 *
 * Output is JSON-serializable so callers can dump to disk for offline
 * analysis (mirrors `analyze-grammar-collisions`).  Clusters are
 * computed per strategy via union-find on edges meeting threshold.
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
import { TextEmbeddingModel, openai } from "@typeagent/aiclient";
import registerDebug from "debug";
import { ActionSchemaFile } from "./actionConfigProvider.js";
import { ActionConfig } from "./actionConfig.js";

const debug = registerDebug("typeagent:dispatcher:action-similarity");

// ---------------------------------------------------------------------------
// Vector keys & strategies
// ---------------------------------------------------------------------------

export type VectorKey =
    | "desc"
    | "params"
    | "combined"
    | "nameShape"
    | "agentContext"
    | "agentAndAction";

export const ALL_VECTOR_KEYS: readonly VectorKey[] = [
    "desc",
    "params",
    "combined",
    "nameShape",
    "agentContext",
    "agentAndAction",
];

export interface Strategy {
    /** Stable identifier used by `--strategy <name>`. */
    name: string;
    /** Short, human-readable description for `--list-strategies`. */
    description: string;
    /**
     * Reduce a per-vector score map to a single aggregate score, or
     * `undefined` to mean "this strategy can't score this pair (skip)".
     * Strategies that require a specific vector return undefined when
     * that vector is missing on either side.
     */
    score: (scores: Partial<Record<VectorKey, number>>) => number | undefined;
}

const STRATEGIES: Record<string, Strategy> = {
    "desc-only": {
        name: "desc-only",
        description:
            "Only the action JSDoc.  Skips pairs where either side has no description — useful when descriptions are well-curated.",
        score: (s) => s.desc,
    },
    "params-only": {
        name: "params-only",
        description:
            "Only parameter shape (names + JSDoc).  Tests how predictive parameter signature alone is.",
        score: (s) => s.params,
    },
    "name-shape": {
        name: "name-shape",
        description:
            "Humanized action name + parameter shape; no descriptions, no agent context.  Tests whether naming convention carries enough signal on its own.",
        score: (s) => s.nameShape,
    },
    "agent-context": {
        name: "agent-context",
        description:
            "Agent manifest description + humanized action name + params.  Works on undocumented actions because the agent's purpose provides the frame.",
        score: (s) => s.agentContext,
    },
    "agent-and-action": {
        name: "agent-and-action",
        description:
            "Agent manifest description + action description + params.  Kitchen sink when everything is documented.",
        score: (s) => s.agentAndAction,
    },
    balanced: {
        name: "balanced",
        description:
            "max(desc, params, agentContext) over the vectors that are populated.  Score lives on the same 0–1 scale as raw cosines — threshold 0.85 means 'at least one of these signals reaches 0.85 cosine on both sides.'",
        score: (s) => {
            const present: number[] = [];
            if (s.desc !== undefined) present.push(s.desc);
            if (s.params !== undefined) present.push(s.params);
            if (s.agentContext !== undefined) present.push(s.agentContext);
            if (present.length === 0) return undefined;
            return Math.max(...present);
        },
    },
};

export function listStrategies(): Strategy[] {
    return Object.values(STRATEGIES);
}

export function getStrategy(name: string): Strategy | undefined {
    return STRATEGIES[name];
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ActionSimilarityEntry {
    schemaName: string;
    agentName: string;
    /** Agent manifest description, when available. */
    agentDescription?: string | undefined;
    actionName: string;
    description?: string | undefined;
    paramSummary?: string | undefined;
    paramCount: number;
    /** Text we embedded under each vector key (sans embedding payload). */
    vectorTexts: Partial<Record<VectorKey, string>>;
}

export interface ActionSimilarityPair {
    keyA: { schemaName: string; actionName: string };
    keyB: { schemaName: string; actionName: string };
    /** Cosine similarity per vector; undefined when either side lacks that vector. */
    scores: Partial<Record<VectorKey, number>>;
    descriptionA?: string | undefined;
    descriptionB?: string | undefined;
}

export interface ActionSimilarityScanResult {
    scannedAt: string;
    actionCount: number;
    schemaCount: number;
    entries: ActionSimilarityEntry[];
    /**
     * All cross-schema pairs whose strongest single vector score exceeds
     * `keepThreshold`.  Per-strategy filtering is applied on top via
     * `applyStrategy`.
     */
    pairs: ActionSimilarityPair[];
}

export interface ActionSimilarityScanInput {
    schemaName: string;
    agentName: string;
    /** Optional, from manifest. */
    agentDescription?: string | undefined;
    actionSchemaFile: ActionSchemaFile;
}

export interface ActionSimilarityScanOptions {
    /**
     * Pre-filter: pairs are dropped if the strongest single vector
     * score is below this.  Default 0.5 — generous enough that any
     * strategy's downstream threshold (typically ≥ 0.7) is unaffected.
     */
    keepThreshold?: number;
    model?: TextEmbeddingModel;
    /** Path to a JSON file caching individual vectors keyed by content hash. */
    cachePath?: string | undefined;
    onProgress?: (
        phase: "embedding" | "scoring",
        index: number,
        total: number,
        label?: string,
    ) => void;
}

// ---------------------------------------------------------------------------
// Strategy application + clustering
// ---------------------------------------------------------------------------

export interface StrategyPair extends ActionSimilarityPair {
    aggregateScore: number;
}

export interface ActionCluster {
    /** Unique members of the cluster. */
    members: {
        schemaName: string;
        actionName: string;
        description?: string | undefined;
        agentDescription?: string | undefined;
    }[];
    /** Pairs that connect members of this cluster (above threshold). */
    pairs: StrategyPair[];
    /** Pair with the highest aggregate score (cluster representative). */
    topPair: StrategyPair;
}

export interface AppliedStrategy {
    strategy: Strategy;
    threshold: number;
    pairs: StrategyPair[]; // sorted aggregate desc
    clusters: ActionCluster[]; // sorted size desc
    /** How many pairs the strategy could score (i.e. had usable vectors). */
    scoredPairs: number;
}

/**
 * Filter a scan's pairs by a strategy's score function and threshold,
 * then transitively cluster the surviving edges via union-find so each
 * connected component renders as a single card.
 */
export function applyStrategy(
    scan: ActionSimilarityScanResult,
    strategy: Strategy,
    threshold: number,
): AppliedStrategy {
    const pairs: StrategyPair[] = [];
    let scoredPairs = 0;
    for (const pair of scan.pairs) {
        const score = strategy.score(pair.scores);
        if (score === undefined) continue;
        scoredPairs++;
        if (score < threshold) continue;
        pairs.push({ ...pair, aggregateScore: score });
    }
    pairs.sort((a, b) => {
        if (b.aggregateScore !== a.aggregateScore) {
            return b.aggregateScore - a.aggregateScore;
        }
        return canonicalKey(a).localeCompare(canonicalKey(b));
    });

    const clusters = buildClusters(scan.entries, pairs);
    return { strategy, threshold, pairs, clusters, scoredPairs };
}

function canonicalKey(p: { keyA: any; keyB: any }): string {
    return `${p.keyA.schemaName}.${p.keyA.actionName}|${p.keyB.schemaName}.${p.keyB.actionName}`;
}

/**
 * Complete-linkage agglomerative clustering: a cluster of N requires
 * *all* C(N,2) pairs within it to exceed threshold.  Avoids the
 * single-linkage transitive-chain problem (where A↔B and B↔C alone
 * would put A in the same cluster as C even with no direct A↔C edge),
 * which collapses the entire action set into one giant component
 * whenever pairs are dense.
 *
 * Algorithm: start with each entry in its own cluster.  Repeatedly find
 * the cluster pair with the largest *minimum* cross-cluster pair score;
 * if that minimum meets threshold, merge.  Stop when no merge qualifies.
 *
 * O(n² log n) for typical inputs; for the dispatcher's ~500 actions
 * with ~125K pairs, completes in well under a second.
 *
 * Singletons (clusters of size 1) are dropped — caller cares about
 * groups, not isolated points.
 */
function buildClusters(
    entries: ActionSimilarityEntry[],
    pairs: StrategyPair[],
): ActionCluster[] {
    if (pairs.length === 0 || entries.length < 2) return [];

    const n = entries.length;
    const idOf = new Map<string, number>();
    entries.forEach((e, i) => idOf.set(`${e.schemaName}.${e.actionName}`, i));

    // Sparse upper-triangular score matrix for the surviving pairs.
    // We need to know if (a, b) is an edge; if it isn't, that pair fails
    // complete-linkage automatically (it's below threshold).
    const edgeKey = (a: number, b: number) =>
        a < b ? `${a}-${b}` : `${b}-${a}`;
    const scoreOf = new Map<string, StrategyPair>();
    for (const pair of pairs) {
        const a = idOf.get(`${pair.keyA.schemaName}.${pair.keyA.actionName}`);
        const b = idOf.get(`${pair.keyB.schemaName}.${pair.keyB.actionName}`);
        if (a === undefined || b === undefined || a === b) continue;
        scoreOf.set(edgeKey(a, b), pair);
    }

    // Each cluster is represented by its set of member indices.  Map
    // from canonical "owner" (smallest index) → member set.  When we
    // merge two clusters their owners merge; updates touch O(n) maps.
    const cluster = new Map<number, Set<number>>();
    for (let i = 0; i < n; i++) cluster.set(i, new Set([i]));

    // Build the initial candidate edges sorted by aggregate score desc.
    // Only edges connecting distinct singletons at start are candidates;
    // as we merge, candidates get re-evaluated against the new cluster.
    const candidates = pairs
        .slice()
        .sort((a, b) => b.aggregateScore - a.aggregateScore);

    // Track which cluster each entry is in.
    const ownerOf = new Map<number, number>();
    for (let i = 0; i < n; i++) ownerOf.set(i, i);

    /** Min cross-cluster score; undefined if any pair across c1×c2 is absent. */
    const minCrossScore = (
        c1: Set<number>,
        c2: Set<number>,
    ): number | undefined => {
        let min = Infinity;
        for (const a of c1) {
            for (const b of c2) {
                const p = scoreOf.get(edgeKey(a, b));
                if (!p) return undefined; // missing edge → fails complete-linkage
                if (p.aggregateScore < min) min = p.aggregateScore;
            }
        }
        return min === Infinity ? undefined : min;
    };

    // Merge greedily by candidate edge order.  Every pair in
    // `candidates` is already ≥ the user's threshold (applyStrategy
    // filters upstream), so any defined `minCrossScore` is also ≥
    // threshold.  Merge when defined; skip when any cross-pair is
    // missing (below threshold).
    for (const pair of candidates) {
        const aIdx = idOf.get(
            `${pair.keyA.schemaName}.${pair.keyA.actionName}`,
        )!;
        const bIdx = idOf.get(
            `${pair.keyB.schemaName}.${pair.keyB.actionName}`,
        )!;
        const ownerA = ownerOf.get(aIdx)!;
        const ownerB = ownerOf.get(bIdx)!;
        if (ownerA === ownerB) continue; // already in the same cluster

        const c1 = cluster.get(ownerA)!;
        const c2 = cluster.get(ownerB)!;
        const cross = minCrossScore(c1, c2);
        if (cross === undefined) continue; // some cross-pair below threshold

        const mergedSet = new Set([...c1, ...c2]);
        const newOwner = Math.min(ownerA, ownerB);
        cluster.delete(ownerA);
        cluster.delete(ownerB);
        cluster.set(newOwner, mergedSet);
        for (const idx of mergedSet) ownerOf.set(idx, newOwner);
    }

    // Build cluster output.
    const clusters: ActionCluster[] = [];
    for (const [, members] of cluster) {
        if (members.size < 2) continue;
        const memberArr = [...members];
        const clusterPairs: StrategyPair[] = [];
        for (let i = 0; i < memberArr.length; i++) {
            for (let j = i + 1; j < memberArr.length; j++) {
                const p = scoreOf.get(edgeKey(memberArr[i], memberArr[j]));
                if (p) clusterPairs.push(p);
            }
        }
        if (clusterPairs.length === 0) continue;
        clusterPairs.sort((a, b) => b.aggregateScore - a.aggregateScore);
        clusters.push({
            members: memberArr.map((i) => ({
                schemaName: entries[i].schemaName,
                actionName: entries[i].actionName,
                description: entries[i].description,
                agentDescription: entries[i].agentDescription,
            })),
            pairs: clusterPairs,
            topPair: clusterPairs[0],
        });
    }
    clusters.sort((a, b) => {
        if (b.members.length !== a.members.length) {
            return b.members.length - a.members.length;
        }
        return b.topPair.aggregateScore - a.topPair.aggregateScore;
    });
    return clusters;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Run the multi-vector embedding scan.  Returns every cross-schema pair
 * whose strongest single vector clears `keepThreshold`, with full
 * per-vector scores.  Use `applyStrategy` to filter by a named strategy
 * and produce clusters.
 */
export async function computeActionSimilarity(
    inputs: ActionSimilarityScanInput[],
    options: ActionSimilarityScanOptions = {},
): Promise<ActionSimilarityScanResult> {
    const keepThreshold = options.keepThreshold ?? 0.5;
    const model = options.model ?? openai.createEmbeddingModel();
    const onProgress = options.onProgress ?? (() => {});

    const entries: ActionSimilarityEntry[] = [];
    for (const input of inputs) {
        const actionMap =
            input.actionSchemaFile.parsedActionSchema.actionSchemas;
        for (const [actionName, definition] of actionMap) {
            entries.push(buildEntry(input, actionName, definition));
        }
    }
    debug(`Built ${entries.length} entries across ${inputs.length} schema(s).`);

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

    // Pairwise scoring.  Compute every per-vector cosine; keep pairs
    // whose strongest single score clears keepThreshold so downstream
    // strategy threshold (typically ≥ 0.7) sees enough candidates.
    const pairs: ActionSimilarityPair[] = [];
    let pairIndex = 0;
    const totalPairs = (entries.length * (entries.length - 1)) / 2;
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            pairIndex++;
            if (pairIndex % 1000 === 0) {
                onProgress("scoring", pairIndex, totalPairs);
            }
            // Cross-schema only.
            if (entries[i].schemaName === entries[j].schemaName) continue;

            const scores: Partial<Record<VectorKey, number>> = {};
            let bestScore = -Infinity;
            for (const vkey of ALL_VECTOR_KEYS) {
                const textA = entries[i].vectorTexts[vkey];
                const textB = entries[j].vectorTexts[vkey];
                if (!textA || !textB) continue;
                const vecA = cache.get(cacheKey(vkey, textA));
                const vecB = cache.get(cacheKey(vkey, textB));
                if (!vecA || !vecB) continue;
                const sim = similarity(vecA, vecB, SimilarityType.Dot);
                scores[vkey] = sim;
                if (sim > bestScore) bestScore = sim;
            }
            if (bestScore < keepThreshold) continue;
            pairs.push({
                keyA: {
                    schemaName: entries[i].schemaName,
                    actionName: entries[i].actionName,
                },
                keyB: {
                    schemaName: entries[j].schemaName,
                    actionName: entries[j].actionName,
                },
                scores,
                descriptionA: entries[i].description,
                descriptionB: entries[j].description,
            });
        }
    }

    const schemaSet = new Set(entries.map((e) => e.schemaName));
    debug(`Kept ${pairs.length} pair(s) above keepThreshold=${keepThreshold}.`);
    return {
        scannedAt: new Date().toISOString(),
        actionCount: entries.length,
        schemaCount: schemaSet.size,
        entries,
        pairs,
    };
}

// ---------------------------------------------------------------------------
// Vector text derivation
// ---------------------------------------------------------------------------

function buildEntry(
    input: ActionSimilarityScanInput,
    actionName: string,
    definition: ActionSchemaTypeDefinition,
): ActionSimilarityEntry {
    const description = definition.comments?.[0]?.trim() || undefined;
    const paramSummary = describeParameters(definition);
    const paramCount = paramSummary ? countParameters(definition) : 0;
    const humanizedName = humanizeActionName(actionName);

    const vectorTexts: Partial<Record<VectorKey, string>> = {};

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
    }

    // nameShape is always populated — it's the lowest-common-denominator
    // signal that works on undocumented actions and is a useful baseline
    // strategy on its own.
    vectorTexts.nameShape = paramSummary
        ? `${humanizedName}\n${paramSummary}`
        : humanizedName;

    if (input.agentDescription) {
        vectorTexts.agentContext = paramSummary
            ? `${input.agentDescription}\n${humanizedName}\n${paramSummary}`
            : `${input.agentDescription}\n${humanizedName}`;
        if (description) {
            vectorTexts.agentAndAction = paramSummary
                ? `${input.agentDescription}\n${description}\n${paramSummary}`
                : `${input.agentDescription}\n${description}`;
        }
    }

    return {
        schemaName: input.schemaName,
        agentName: input.agentName,
        agentDescription: input.agentDescription,
        actionName,
        description,
        paramSummary,
        paramCount,
        vectorTexts,
    };
}

/**
 * Convert a camelCase / PascalCase action name to space-separated
 * lowercase words.  `deleteWebFlow` → `delete web flow`.  Handles
 * acronym runs (`HTTPRequest` → `http request`) and digit boundaries
 * (`s3Upload` → `s3 upload`).
 */
function humanizeActionName(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase → camel Case
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // ACRONYMUpper → ACRONYM Upper
        .toLowerCase()
        .trim();
}

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
// Embedding cache
// ---------------------------------------------------------------------------

type EmbeddingCacheMap = Map<string, NormalizedEmbedding>;

function cacheKey(vectorKey: VectorKey, text: string): string {
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
    const missingByKey = new Map<string, string>();
    for (const entry of entries) {
        for (const [vectorKey, text] of Object.entries(entry.vectorTexts) as [
            VectorKey,
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
    debug(`Embedding ${missingEntries.length} missing vector(s).`);
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
// Convenience
// ---------------------------------------------------------------------------

export function toScanInput(
    config: ActionConfig,
    actionSchemaFile: ActionSchemaFile,
    agentName: string,
    agentDescription?: string,
): ActionSimilarityScanInput {
    return {
        schemaName: config.schemaName,
        agentName,
        agentDescription,
        actionSchemaFile,
    };
}
