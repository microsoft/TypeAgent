// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from "console";
import { asyncArray } from "..";
import { ScoredItem } from "../memory";
import {
    createNormalized,
    SimilarityType,
    NormalizedEmbedding,
    Embedding,
    similarity,
    TopNCollection,
} from "./embeddings";
import { EmbeddingModel, TextEmbeddingModel } from "aiclient";
import { getData } from "typechat";

/**
 * An index that allows lookup of nearest neighbors of T using vector similarity matching
 */
export interface VectorIndex<ID = number> {
    /**
     * Return the nearest neighbor for value
     * @param value
     */
    nearestNeighbor(
        value: Embedding,
        similarity: SimilarityType,
        minScore?: number,
    ): Promise<ScoredItem<ID> | undefined>;
    /**
     * Return upto maxMatches nearest neighbors
     * @param value
     * @param maxMatches
     */
    nearestNeighbors(
        value: Embedding,
        maxMatches: number,
        similarity: SimilarityType,
        minScore?: number,
    ): Promise<ScoredItem<ID>[]>;
}

/**
 * Generates a normalized embedding for the given value from the embedding model
 * @param model embedding model
 * @param value value to generate an embedding for
 * @returns
 */
export async function generateEmbedding<T = string>(
    model: EmbeddingModel<T>,
    value: T | NormalizedEmbedding,
): Promise<NormalizedEmbedding> {
    if (isEmbedding(value)) {
        return value;
    }
    const result = await model.generateEmbedding(value);
    return createNormalized(getData(result));
}

/**
 * Generate embeddings in parallel
 * @param model
 * @param values
 * @param concurrency default is 2
 * @returns
 */
export async function generateEmbeddings<T = string>(
    model: EmbeddingModel<T>,
    values: T[],
    concurrency?: number,
): Promise<NormalizedEmbedding[]> {
    concurrency ??= 2;
    return asyncArray.mapAsync(values, concurrency, (v) =>
        generateEmbedding(model, v),
    );
}

function isEmbedding<T>(
    value: T | NormalizedEmbedding,
): value is NormalizedEmbedding {
    return value instanceof Float32Array;
}

export type EmbeddedValue<T> = {
    value: T;
    embedding: NormalizedEmbedding;
};

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
}

export interface VectorStore<ID = string> extends VectorIndex<ID> {
    exists(id: ID): boolean;
    put(value: Embedding, id?: ID | undefined): Promise<ID>;
    get(id: ID): Promise<Embedding | undefined>;
    remove(id: ID): Promise<void>;
    // TODO: batch operations
}
