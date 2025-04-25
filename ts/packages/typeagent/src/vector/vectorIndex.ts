// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { asyncArray, collections } from "../index.js";
import { callWithRetry } from "../async.js";
import { ScoredItem } from "../memory.js";
import {
    createNormalized,
    SimilarityType,
    NormalizedEmbedding,
    Embedding,
} from "./embeddings.js";
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

const DefaultRetryPauseMs = 2500;
const DefaultRetryAttempts = 3;

/**
 * Generates a normalized embedding for the given value from the embedding model
 * Batch support is available for text embeddings (see generateTextEmbeddings)
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
 * Generate an embedding for a single value
 * Batch support is available for text embeddings (see generateTextEmbeddings)
 * @param model embedding model
 * @param value value to generate an embedding for
 */
export async function generateEmbeddingWithRetry<T>(
    model: EmbeddingModel<T>,
    value: T | NormalizedEmbedding,
    retryMaxAttempts: number = DefaultRetryAttempts,
    retryPauseMs: number = DefaultRetryPauseMs,
) {
    return callWithRetry(
        () => generateEmbedding(model, value),
        retryMaxAttempts,
        retryPauseMs,
    );
}

/**
 * Generate embeddings in parallel
 * Uses batching if model supports it
 * @param model
 * @param values strings for which to generate embeddings
 * @param maxCharsPerChunk Models can limit the total # of chars per batch
 * @param concurrency default is 2
 * @returns
 */
export async function generateTextEmbeddings(
    model: TextEmbeddingModel,
    values: string[],
    concurrency?: number,
    maxCharsPerChunk: number = Number.MAX_SAFE_INTEGER,
): Promise<NormalizedEmbedding[]> {
    // Verify that none of the individual strings are too long
    if (values.some((s) => s.length > maxCharsPerChunk)) {
        throw new Error(
            `Values contains string with length > ${maxCharsPerChunk}`,
        );
    }
    concurrency ??= 1;
    if (model.maxBatchSize > 1 && model.generateEmbeddingBatch) {
        const chunks = [
            ...collections.getStringChunks(
                values,
                model.maxBatchSize,
                maxCharsPerChunk,
            ),
        ];
        const embeddingChunks = await asyncArray.mapAsync(
            chunks,
            concurrency,
            (c) => generateEmbeddingBatch(model, c),
        );
        return embeddingChunks.flat();
    } else {
        // Run generateEmbeddings in parallel
        return asyncArray.mapAsync(values, concurrency, (v) =>
            generateEmbedding(model, v),
        );
    }
}

/**
 * Same as generateTextEmbeddings, but with retries
 * @param model
 * @param values
 * @param retryMaxAttempts
 * @param retryPauseMs
 * @param maxCharsPerChunk
 * @returns
 */
export async function generateTextEmbeddingsWithRetry(
    model: TextEmbeddingModel,
    values: string[],
    retryMaxAttempts: number = DefaultRetryAttempts,
    retryPauseMs: number = DefaultRetryPauseMs,
    maxCharsPerChunk: number = Number.MAX_SAFE_INTEGER,
): Promise<NormalizedEmbedding[]> {
    return callWithRetry(
        () => generateTextEmbeddings(model, values, maxCharsPerChunk),
        retryMaxAttempts,
        retryPauseMs,
    );
}

async function generateEmbeddingBatch(
    model: TextEmbeddingModel,
    values: string[],
): Promise<NormalizedEmbedding[]> {
    if (model.generateEmbeddingBatch === undefined) {
        throw new Error("Model does not support batch operations");
    }
    const embeddings = getData(await model.generateEmbeddingBatch(values));
    return embeddings.map((e) => createNormalized(e));
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

export interface VectorStore<ID = string> extends VectorIndex<ID> {
    exists(id: ID): boolean;
    put(value: Embedding, id?: ID | undefined): Promise<ID>;
    get(id: ID): Promise<Embedding | undefined>;
    remove(id: ID): Promise<void>;
    // TODO: batch operations
}
