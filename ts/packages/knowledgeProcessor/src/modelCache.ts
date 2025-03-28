// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createTextEmbeddingModelWithCache,
    TextEmbeddingModel,
} from "aiclient";
import { collections } from "typeagent";
import { Result } from "typechat";

export interface TextEmbeddingModelWithCache extends TextEmbeddingModel {
    readonly cache: collections.Cache<string, number[]>;
    embeddingLookup?: (text: string) => number[] | undefined;
}

/**
 * Create an embedding model that leverages a cache to improve performance
 * @param innerModel
 * @param cacheSize
 * @returns
 */
export function createEmbeddingCache(
    innerModel: TextEmbeddingModel,
    cacheSize: number,
    embeddingLookup?: (text: string) => number[] | undefined,
): TextEmbeddingModelWithCache {
    const cache: collections.Cache<string, number[]> =
        collections.createLRUCache(cacheSize);
    innerModel = createTextEmbeddingModelWithCache(
        innerModel,
        getFromCache,
        putInCache,
    );
    const modelWithCache: TextEmbeddingModelWithCache = {
        cache,
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
        let embedding = embeddingLookup ? embeddingLookup(text) : undefined;
        embedding ??= cache.get(text);
        return embedding;
    }

    function putInCache(text: string, embedding: number[]): void {
        cache.put(text, embedding);
    }
}
