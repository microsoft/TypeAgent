// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TextEmbeddingModel,
    tryCreateEmbeddingModel,
} from "@typeagent/aiclient";
import { EmbeddedValue } from "./vectorIndex.js";
import { NormalizedEmbedding } from "./embeddings.js";
import { ScoredItem } from "../memory.js";
import { createSemanticList, SemanticList } from "./semanticList.js";

export interface SemanticMap<T> {
    readonly size: number;
    /**
     * The embedding model backing semantic (nearest-neighbor) lookups, or
     * `undefined` when embeddings are unavailable. In that case the map
     * operates in exact-match-only mode.
     */
    readonly model: TextEmbeddingModel | undefined;

    keys(): IterableIterator<EmbeddedValue<string>>;
    values(): IterableIterator<T>;
    entries(): IterableIterator<[EmbeddedValue<string>, T]>;
    has(text: string): boolean;
    get(text: string): T | undefined;
    getNearest(
        text: string | NormalizedEmbedding,
    ): Promise<ScoredItem<T> | undefined>;
    set(
        text: string,
        value: T,
        retryMaxAttempts?: number,
        retryPauseMs?: number,
    ): Promise<void>;
    setMultiple(
        items: [string, T][],
        retryMaxAttempts?: number,
        retryPauseMs?: number,
        concurrency?: number,
    ): Promise<void>;
    nearestNeighbors(
        value: string | NormalizedEmbedding,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<T>[]>;
}

export async function createSemanticMap<T = any>(
    model?: TextEmbeddingModel,
    existingValues?: [EmbeddedValue<string>, T][],
): Promise<SemanticMap<T>> {
    // Fall back to the configured embedding provider. When none is
    // available, the map runs in exact-match-only mode (no semanticIndex).
    model ??= tryCreateEmbeddingModel();
    const map = new Map<string, T>();
    const semanticIndex: SemanticList<string> | undefined =
        model !== undefined ? createSemanticList<string>(model) : undefined;
    if (existingValues) {
        init(existingValues);
    }
    return {
        model,
        get size() {
            return map.size;
        },
        entries,
        keys,
        values: () => map.values(),
        has: (text: string) => map.has(text),
        get,
        set,
        setMultiple,
        getNearest,
        nearestNeighbors,
    };

    function* keys(): IterableIterator<EmbeddedValue<string>> {
        if (semanticIndex !== undefined) {
            for (const key of semanticIndex.values) {
                yield key;
            }
        } else {
            // Exact-match-only mode: no embeddings are available.
            for (const key of map.keys()) {
                yield { value: key, embedding: new Float32Array() };
            }
        }
    }

    function* entries(): IterableIterator<[EmbeddedValue<string>, T]> {
        for (const key of keys()) {
            yield [key, map.get(key.value)!];
        }
    }

    function get(text: string): T | undefined {
        return map.get(text);
    }

    async function set(
        text: string,
        value: T,
        retryMaxAttempts?: number,
        retryPauseMs?: number,
    ): Promise<void> {
        // If new item, have to embed.
        if (semanticIndex !== undefined && !map.has(text)) {
            // New item. Must embed
            await semanticIndex.push(
                text,
                text,
                retryMaxAttempts,
                retryPauseMs,
            );
        }
        map.set(text, value);
    }

    async function setMultiple(
        items: [string, T][],
        retryMaxAttempts?: number,
        retryPauseMs?: number,
        concurrency?: number,
    ): Promise<void> {
        let newItems: string[] | undefined;
        for (const item of items) {
            let [text, value] = item;
            if (semanticIndex !== undefined && !map.has(text)) {
                newItems ??= [];
                newItems.push(text);
            }
            map.set(text, value);
        }
        if (semanticIndex !== undefined && newItems) {
            await semanticIndex.pushMultiple(
                newItems,
                retryMaxAttempts,
                retryPauseMs,
                concurrency,
            );
        }
    }

    async function getNearest(
        text: string | NormalizedEmbedding,
    ): Promise<ScoredItem<T> | undefined> {
        // First try an exact match
        if (typeof text === "string") {
            const exactMatch = map.get(text);
            if (exactMatch) {
                return {
                    score: 1,
                    item: exactMatch,
                };
            }
        }
        // Without an embedding model we can only do exact matches.
        if (semanticIndex === undefined) {
            return undefined;
        }
        const key = await semanticIndex.nearestNeighbor(text);
        if (key !== undefined) {
            return valueFromScoredKey(key);
        } else {
            return undefined;
        }
    }

    async function nearestNeighbors(
        value: string | NormalizedEmbedding,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<T>[]> {
        // Without an embedding model we can only do exact matches.
        if (semanticIndex === undefined) {
            if (typeof value === "string") {
                const exactMatch = map.get(value);
                if (exactMatch) {
                    return [{ score: 1, item: exactMatch }];
                }
            }
            return [];
        }
        const keys = await semanticIndex.nearestNeighbors(
            value,
            maxMatches,
            minScore,
        );
        return keys.map((k) => valueFromScoredKey(k));
    }

    function valueFromScoredKey(match: ScoredItem<string>): ScoredItem<T> {
        return {
            score: match.score,
            item: map.get(match.item)!,
        };
    }

    function init(entries: [EmbeddedValue<string>, T][]): void {
        for (const [key, value] of entries) {
            map.set(key.value, value);
            semanticIndex?.pushValue(key);
        }
    }
}

export type SemanticMapEntry<T> = {
    key: EmbeddedValue<string>;
    value: T;
};
