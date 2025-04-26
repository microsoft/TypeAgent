// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEmbeddingModel, openai } from "aiclient";
import { EmbeddedValue } from "./vectorIndex.js";
import { NormalizedEmbedding } from "./embeddings.js";
import { ScoredItem } from "../memory.js";
import { createSemanticList } from "./semanticList.js";

export interface SemanticMap<T> {
    readonly size: number;
    readonly model: TextEmbeddingModel;

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
    model ??= openai.createEmbeddingModel();
    const map = new Map<string, T>();
    const semanticIndex = createSemanticList<string>(model);
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
        for (const key of semanticIndex.values) {
            yield key;
        }
    }

    function* entries(): IterableIterator<[EmbeddedValue<string>, T]> {
        for (const key of semanticIndex.values) {
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
        if (!map.has(text)) {
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
            if (!map.has(text)) {
                newItems ??= [];
                newItems.push(text);
            }
            map.set(text, value);
        }
        if (newItems) {
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
            semanticIndex.pushValue(key);
        }
    }
}

export type SemanticMapEntry<T> = {
    key: EmbeddedValue<string>;
    value: T;
};
