// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    generateEmbedding,
    indexesOfNearest,
    NormalizedEmbedding,
    SimilarityType,
} from "@typeagent/agent-runtime";
import {
    TextEmbeddingModel,
    inferenceClient,
    isEmbeddingAvailable,
} from "@typeagent/aiclient";
import registerDebug from "debug";

const debug = registerDebug("agent-server:conversation:nameIndex");
const debugError = registerDebug("agent-server:conversation:nameIndex:error");

/** A conversation matched by name, with a relevance score in [0, 1]. */
export type ConversationNameMatch = {
    conversationId: string;
    score: number;
};

/**
 * Fuzzy index over conversation names. Combines two signals so imprecise
 * queries still match:
 *   - Lexical: exact / substring / edit-distance over the raw name. Always
 *     available; guarantees exact and substring hits rank at the top.
 *   - Embedding: cosine similarity over name embeddings. Catches semantically
 *     close names ("gym music" -> "workout playlist"). Skipped entirely when no
 *     embedding provider is configured, so the index degrades to lexical-only.
 *
 * The index owns embeddings (keyed by conversationId); the caller owns the
 * conversation registry and drives {@link ConversationNameIndex.update} /
 * {@link ConversationNameIndex.remove} as conversations are created, renamed,
 * and deleted. Embeddings are generated lazily by {@link prime} so startup and
 * bulk imports (e.g. `@copilot import`) never block on embedding calls.
 */
export interface ConversationNameIndex {
    /** Add or update a conversation's name. Marks its embedding stale. */
    update(conversationId: string, name: string): void;
    /** Drop a conversation from the index. */
    remove(conversationId: string): void;
    /** Forget everything. */
    reset(): void;
    /** Embed any entries whose embedding is missing or stale. Idempotent. */
    prime(): Promise<void>;
    /**
     * Rank conversations against a query. Returns matches sorted by descending
     * score, capped at maxMatches. Runs {@link prime} first so results reflect
     * every known name.
     */
    search(query: string, maxMatches: number): Promise<ConversationNameMatch[]>;
}

type NameEntry = {
    name: string;
    embedding: NormalizedEmbedding | undefined;
};

// Lexical scores are banded so exact/substring hits always outrank a fuzzy
// edit-distance hit, and edit-distance noise below the floor is dropped.
const SCORE_EXACT = 1;
const SCORE_NAME_CONTAINS_QUERY = 0.9;
const SCORE_QUERY_CONTAINS_NAME = 0.8;
const EDIT_SIMILARITY_FLOOR = 0.6;
const EDIT_SCORE_SCALE = 0.7;
// Embedding cosine below this is treated as noise (short strings sit high).
const EMBEDDING_SCORE_FLOOR = 0.78;

export function createConversationNameIndex(
    modelOverride?: TextEmbeddingModel,
): ConversationNameIndex {
    const entries = new Map<string, NameEntry>();

    // Undefined when no embedding provider is configured; the index then does
    // lexical-only matching instead of failing.
    const embeddingModel: TextEmbeddingModel | undefined =
        modelOverride ??
        (isEmbeddingAvailable()
            ? inferenceClient.createEmbeddingModel(
                  inferenceClient.apiSettingsFromEnv(inferenceClient.ModelType.Embedding),
              )
            : undefined);

    if (embeddingModel === undefined) {
        debug(
            "No embedding provider configured; conversation name search is lexical-only",
        );
    }

    // Single-flight guard so concurrent prime() calls share one pass.
    let primeInFlight: Promise<void> | undefined;

    return { update, remove, reset, prime, search };

    function update(conversationId: string, name: string): void {
        const existing = entries.get(conversationId);
        if (existing !== undefined && existing.name === name) {
            return;
        }
        entries.set(conversationId, { name, embedding: undefined });
    }

    function remove(conversationId: string): void {
        entries.delete(conversationId);
    }

    function reset(): void {
        entries.clear();
    }

    function prime(): Promise<void> {
        if (embeddingModel === undefined) {
            return Promise.resolve();
        }
        if (primeInFlight === undefined) {
            primeInFlight = primeStaleEntries().finally(() => {
                primeInFlight = undefined;
            });
        }
        return primeInFlight;
    }

    async function primeStaleEntries(): Promise<void> {
        for (const [conversationId, entry] of entries) {
            if (entry.embedding !== undefined) {
                continue;
            }
            try {
                entry.embedding = await generateEmbedding(
                    embeddingModel!,
                    entry.name,
                );
            } catch (e: unknown) {
                debugError(
                    `Could not embed name for ${conversationId}: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
        }
    }

    async function search(
        query: string,
        maxMatches: number,
    ): Promise<ConversationNameMatch[]> {
        const trimmed = query.trim();
        if (trimmed.length === 0 || entries.size === 0) {
            return [];
        }
        await prime();

        const scores = new Map<string, number>();
        const q = trimmed.toLowerCase();
        for (const [conversationId, entry] of entries) {
            const score = lexicalScore(q, entry.name.trim().toLowerCase());
            if (score > 0) {
                scores.set(conversationId, score);
            }
        }

        await addEmbeddingScores(trimmed, scores, maxMatches);

        const ranked = [...scores.entries()]
            .map(([conversationId, score]) => ({ conversationId, score }))
            .sort((a, b) => b.score - a.score);
        return ranked.slice(0, maxMatches);
    }

    async function addEmbeddingScores(
        query: string,
        scores: Map<string, number>,
        maxMatches: number,
    ): Promise<void> {
        if (embeddingModel === undefined) {
            return;
        }
        const ids: string[] = [];
        const embeddings: NormalizedEmbedding[] = [];
        for (const [conversationId, entry] of entries) {
            if (entry.embedding !== undefined) {
                ids.push(conversationId);
                embeddings.push(entry.embedding);
            }
        }
        if (embeddings.length === 0) {
            return;
        }
        let queryEmbedding: NormalizedEmbedding;
        try {
            queryEmbedding = await generateEmbedding(embeddingModel, query);
        } catch (e: unknown) {
            debugError(
                `Could not embed query "${query}": ${e instanceof Error ? e.message : String(e)}`,
            );
            return;
        }
        // Pull a few extra candidates beyond maxMatches so the lexical/embedding
        // merge has headroom before the final sort + slice.
        const nearest = indexesOfNearest(
            embeddings,
            queryEmbedding,
            Math.min(ids.length, maxMatches * 3),
            SimilarityType.Dot,
        );
        for (const match of nearest) {
            if (match.score < EMBEDDING_SCORE_FLOOR) {
                continue;
            }
            const conversationId = ids[Number(match.item)];
            const prev = scores.get(conversationId) ?? 0;
            if (match.score > prev) {
                scores.set(conversationId, match.score);
            }
        }
    }
}

// Lexical similarity of a lowercased query against a lowercased name. Returns 0
// when there is no meaningful match so callers can drop the candidate.
function lexicalScore(query: string, name: string): number {
    if (name.length === 0) {
        return 0;
    }
    if (name === query) {
        return SCORE_EXACT;
    }
    if (name.includes(query)) {
        return SCORE_NAME_CONTAINS_QUERY;
    }
    if (query.includes(name)) {
        return SCORE_QUERY_CONTAINS_NAME;
    }
    const distance = levenshtein(query, name);
    const similarity = 1 - distance / Math.max(query.length, name.length);
    return similarity >= EDIT_SIMILARITY_FLOOR
        ? similarity * EDIT_SCORE_SCALE
        : 0;
}

// Iterative two-row Levenshtein edit distance.
function levenshtein(a: string, b: string): number {
    if (a === b) {
        return 0;
    }
    if (a.length === 0) {
        return b.length;
    }
    if (b.length === 0) {
        return a.length;
    }
    let prev = new Array<number>(b.length + 1);
    let curr = new Array<number>(b.length + 1);
    for (let j = 0; j <= b.length; j++) {
        prev[j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + cost,
            );
        }
        [prev, curr] = [curr, prev];
    }
    return prev[b.length];
}
