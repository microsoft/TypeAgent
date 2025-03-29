// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createTextEmbeddingModelWithCache,
    TextEmbeddingCache,
    TextEmbeddingModel,
} from "aiclient";
import { collections } from "typeagent";
import { Result } from "typechat";

export interface TextEmbeddingModelWithCache extends TextEmbeddingModel {
    readonly cache: collections.Cache<string, number[]>;
    embeddingLookup?: (text: string) => number[] | undefined;
}

/**
 * Create an embedding model that leverages caches to improve performance
 * - Maintains an in-memory LRU cache
 * - Allows for optional lookup from a persistent cache
 * @param innerModel Model to call when no cache hit
 * @param memCacheSize Size of the memory cache
 * @param lookupInPersistentCache (Optional) Lookup from persistent cache
 * @returns
 */
export function createEmbeddingCache(
    innerModel: TextEmbeddingModel,
    memCacheSize: number,
    persistentCache?: TextEmbeddingCache | undefined,
): TextEmbeddingModelWithCache {
    const memCache: collections.Cache<string, number[]> =
        collections.createLRUCache(memCacheSize);
    innerModel = createTextEmbeddingModelWithCache(innerModel, {
        getEmbedding: getFromCache,
        putEmbedding: putInCache,
    });
    const modelWithCache: TextEmbeddingModelWithCache = {
        cache: memCache,
        generateEmbedding,
        maxBatchSize: innerModel.maxBatchSize,
    };
    if (innerModel.generateEmbeddingBatch) {
        modelWithCache.generateEmbeddingBatch = generateEmbeddingBatch;
    }
    return modelWithCache;

    async function generateEmbedding(input: string): Promise<Result<number[]>> {
        return innerModel.generateEmbedding(input);
    }

    async function generateEmbeddingBatch(
        inputs: string[],
    ): Promise<Result<number[][]>> {
        return innerModel.generateEmbeddingBatch!(inputs);
    }

    function getFromCache(text: string): number[] | undefined {
        let embedding = persistentCache
            ? persistentCache.getEmbedding(text)
            : undefined;
        embedding ??= memCache.get(text);
        return embedding;
    }

    function putInCache(text: string, embedding: number[]): void {
        memCache.put(text, embedding);
        if (persistentCache && persistentCache.putEmbedding) {
            persistentCache.putEmbedding(text, embedding);
        }
    }
}
