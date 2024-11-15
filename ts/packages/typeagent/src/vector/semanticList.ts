// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEmbeddingModel } from "aiclient";
import { ScoredItem } from "../memory";
import {
    NormalizedEmbedding,
    similarity,
    SimilarityType,
    TopNCollection,
} from "./embeddings";
import { EmbeddedValue, generateEmbedding, VectorIndex } from "./vectorIndex";
import { asyncArray } from "..";
import assert from "assert";

/**
 * An in-memory list of T, {stringValue of T} items that also maintains embeddings of stringValue
 * You can semantic search this list using query stringValues
 *
 * {stringValue could be a Description of T, or any other string forms}
 */
export interface SemanticList<T> extends VectorIndex<T> {
    values: EmbeddedValue<T>[];

    indexOf(value: string | NormalizedEmbedding): Promise<ScoredItem>;
    indexesOf(
        value: string | NormalizedEmbedding,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem[]>;
    nearestNeighbor(
        value: string | NormalizedEmbedding,
    ): Promise<ScoredItem<T>>;
    nearestNeighbors(
        value: string | NormalizedEmbedding,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<T>[]>;

    push(value: T, stringValue?: string): Promise<void>;
    pushMultiple(values: T[], concurrency?: number): Promise<void>;
    pushValue(value: EmbeddedValue<T>): void;
}

export function createSemanticList<T>(
    model: TextEmbeddingModel,
    existingValues?: EmbeddedValue<T>[],
    stringify?: (value: T) => string,
): SemanticList<T> {
    let values = existingValues ?? [];
    return {
        values,
        push,
        pushMultiple,
        pushValue,
        indexOf,
        indexesOf,
        nearestNeighbor,
        nearestNeighbors,
    };

    async function push(value: T, stringValue?: string): Promise<void> {
        const embedding = await generateEmbedding<string>(
            model,
            toString(value, stringValue),
        );
        pushValue({ value, embedding });
    }

    async function pushMultiple(
        values: T[],
        concurrency?: number,
    ): Promise<void> {
        concurrency ??= 2;
        // Generate embeddings in parallel
        const embeddings = await asyncArray.mapAsync(values, concurrency, (v) =>
            generateEmbedding(model, toString(v)),
        );
        assert(values.length === embeddings.length);
        for (let i = 0; i < values.length; ++i) {
            pushValue({ value: values[i], embedding: embeddings[i] });
        }
    }

    function pushValue(value: EmbeddedValue<T>): void {
        values.push(value);
    }

    async function nearestNeighbor(
        value: string | NormalizedEmbedding,
    ): Promise<ScoredItem<T>> {
        const match = await indexOf(value);
        return { score: match.score, item: values[match.item].value };
    }

    async function nearestNeighbors(
        value: string | NormalizedEmbedding,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<T>[]> {
        const matches = await indexesOf(value, maxMatches, minScore);
        return matches.map((m) => {
            return {
                score: m.score,
                item: values[m.item].value,
            };
        });
    }

    async function indexOf(
        value: string | NormalizedEmbedding,
    ): Promise<ScoredItem> {
        const embedding = await generateEmbedding(model, value);
        return indexOfNearest(values, embedding, SimilarityType.Dot);
    }

    async function indexesOf(
        value: string | NormalizedEmbedding,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem[]> {
        minScore ??= 0;
        const embedding = await generateEmbedding(model, value);
        return indexesOfNearest(
            values,
            embedding,
            maxMatches,
            SimilarityType.Dot,
            minScore,
        );
    }

    function toString(value: T, stringValue?: string): string {
        if (!stringValue) {
            if (stringify) {
                stringValue = stringify(value);
            } else if (typeof value === "string") {
                stringValue = value;
            } else {
                stringValue = JSON.stringify(value);
            }
        }
        return stringValue;
    }

    function indexOfNearest<T>(
        list: EmbeddedValue<T>[],
        other: NormalizedEmbedding,
        type: SimilarityType,
    ): ScoredItem {
        let best: ScoredItem = { score: Number.MIN_VALUE, item: -1 };
        for (let i = 0; i < list.length; ++i) {
            const score: number = similarity(list[i].embedding, other, type);
            if (score > best.score) {
                best.score = score;
                best.item = i;
            }
        }
        return best;
    }

    function indexesOfNearest<T>(
        list: EmbeddedValue<T>[],
        other: NormalizedEmbedding,
        maxMatches: number,
        type: SimilarityType,
        minScore: number = 0,
    ): ScoredItem[] {
        const matches = new TopNCollection(maxMatches, -1);
        for (let i = 0; i < list.length; ++i) {
            const score: number = similarity(list[i].embedding, other, type);
            if (score >= minScore) {
                matches.push(i, score);
            }
        }
        return matches.byRank();
    }
}
