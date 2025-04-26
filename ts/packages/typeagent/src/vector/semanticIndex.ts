// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEmbeddingModel, openai } from "aiclient";
import { ScoredItem } from "../memory.js";
import {
    VectorStore,
    generateEmbedding,
    generateEmbeddingWithRetry,
    generateTextEmbeddingsWithRetry,
} from "./vectorIndex.js";
import { NormalizedEmbedding, SimilarityType } from "./embeddings.js";

export interface SemanticIndex<ID = string> {
    readonly store: VectorStore<ID>;
    /**
     * Return an embedding for the given text
     * @param text
     */
    getEmbedding(text: string): Promise<NormalizedEmbedding>;
    /**
     *
     * @param text
     * @param id
     * @param onlyIfNew Only update the embedding if the "id" does not exist
     */
    put(text: string, id?: ID | undefined, onlyIfNew?: boolean): Promise<ID>;
    putMultiple(
        items: [string, ID | undefined][],
        onlyIfNew?: boolean,
        concurrency?: number,
    ): Promise<[string, ID][]>;
    /**
     * Return the nearest neighbor of value
     * @param value
     * @param minScore
     */
    nearestNeighbor(
        value: string,
        minScore?: number,
    ): Promise<ScoredItem<ID> | undefined>;
    /**
     * Return upto maxMatches nearest neighbors
     * @param value
     * @param maxMatches
     */
    nearestNeighbors(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<ID>[]>;
}

/**
 * Creates a SemanticIndex OVER an implementation of a VectorStore but does embedding generation itself.
 * Automatically creates embeddings for text... both at time of put and at time of nearestNeighbor
 * The store can be in-memory (such as in this library), local, remote (Azure) etc.
 * @param store vector store to use
 * @param model model to embed with
 * @returns
 */
export function createSemanticIndex<ID = string>(
    store: VectorStore<ID>,
    model?: TextEmbeddingModel,
): SemanticIndex<ID> {
    model ??= openai.createEmbeddingModel();
    return {
        store,
        getEmbedding,
        put,
        putMultiple,
        nearestNeighbor,
        nearestNeighbors,
    };

    async function getEmbedding(text: string): Promise<NormalizedEmbedding> {
        return generateEmbedding(model!, text);
    }

    async function put(
        text: string,
        id?: ID | undefined,
        onlyIfNew?: boolean,
    ): Promise<ID> {
        if (id && onlyIfNew) {
            if (store.exists(id)) {
                return id;
            }
        }
        const embedding: NormalizedEmbedding = await generateEmbeddingWithRetry(
            model!,
            text,
        );
        return store.put(embedding, id);
    }

    async function putMultiple(
        items: [string, ID | undefined][],
        onlyIfNew?: boolean,
        concurrency?: number,
    ): Promise<[string, ID][]> {
        concurrency ??= 1;
        let pendingPositions: number[] | undefined;
        let textBatch: string[] | undefined;
        // First, collect the texts that need embeddings
        for (let i = 0; i < items.length; ++i) {
            const [text, id] = items[i];
            if (id && onlyIfNew) {
                if (store.exists(id)) {
                    continue;
                }
            }
            pendingPositions ??= [];
            textBatch ??= [];
            pendingPositions.push(i);
            textBatch.push(text);
        }
        if (
            pendingPositions &&
            pendingPositions.length > 0 &&
            textBatch &&
            textBatch.length > 0
        ) {
            const embeddings = await generateTextEmbeddingsWithRetry(
                model!,
                textBatch,
            );
            // Add them
            for (let i = 0; i < textBatch.length; ++i) {
                const index = pendingPositions[i];
                let id = items[index][1];
                id = await store.put(embeddings[i], id);
                items[index][1] = id;
            }
        }
        return items as [string, ID][];
    }

    async function nearestNeighbor(
        value: string,
        minScore?: number,
    ): Promise<ScoredItem<ID> | undefined> {
        const embedding: NormalizedEmbedding = await generateEmbedding(
            model!,
            value,
        );

        // Since we normalize our embeddings, Dot is faster
        return store.nearestNeighbor(embedding, SimilarityType.Dot, minScore);
    }

    async function nearestNeighbors(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<ID>[]> {
        const embedding: NormalizedEmbedding = await generateEmbedding(
            model!,
            value,
        );
        // Since we normalize our embeddings, Dot is faster
        return store.nearestNeighbors(
            embedding,
            maxMatches,
            SimilarityType.Dot,
            minScore,
        );
    }
}
