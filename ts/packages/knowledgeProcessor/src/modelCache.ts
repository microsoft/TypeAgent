// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEmbeddingModel } from "aiclient";
import { collections } from "typeagent";
import { Result, success, error } from "typechat";

export interface TextEmbeddingModelWithCache extends TextEmbeddingModel {
    readonly cache: collections.Cache<string, number[]>;
}

/**
 * Create an embedding model that leverages a cache to improve performance
 * @param model
 * @param cacheSize
 * @returns
 */
export function createEmbeddingCache(
    model: TextEmbeddingModel,
    cacheSize: number,
): TextEmbeddingModelWithCache {
    const cache: collections.Cache<string, number[]> =
        collections.createLRUCache(cacheSize);
    const modelWithCache: TextEmbeddingModelWithCache = {
        cache,
        generateEmbedding,
        maxBatchSize: model.maxBatchSize,
    };
    if (model.generateEmbeddingBatch) {
        modelWithCache.generateEmbeddingBatch = generateEmbeddingBatch;
    }
    return modelWithCache;

    async function generateEmbedding(input: string): Promise<Result<number[]>> {
        let embedding = cache.get(input);
        if (embedding) {
            return success(embedding);
        }
        const result = await model.generateEmbedding(input);
        if (result.success) {
            cache.put(input, result.data);
        }
        return result;
    }

    async function generateEmbeddingBatch(
        inputs: string[],
    ): Promise<Result<number[][]>> {
        let embeddingBatch: number[][] = new Array(inputs.length);
        let inputBatch: string[] | undefined;
        // First, grab any embeddings we already have
        for (let i = 0; i < inputs.length; ++i) {
            let input = inputs[i];
            let embedding = cache.get(input);
            if (embedding === undefined) {
                // This one needs embeddings
                inputBatch ??= [];
                inputBatch.push(input);
            } else {
                embeddingBatch[i] = embedding;
            }
        }
        if (inputBatch && inputBatch.length > 0) {
            const result = await model.generateEmbeddingBatch!(inputBatch);
            if (!result.success) {
                return result;
            }
            const newEmbeddings = result.data;
            // Merge the batch into results
            let iGenerated = 0;
            embeddingBatch ??= new Array(inputs.length);
            for (let i = 0; i < embeddingBatch.length; ++i) {
                if (embeddingBatch[i] === undefined) {
                    embeddingBatch[i] = newEmbeddings[iGenerated++];
                    cache.put(inputs[i], embeddingBatch[i]);
                }
            }
        }
        return embeddingBatch && embeddingBatch.length > 0
            ? success(embeddingBatch)
            : error("Could not generated embeddings");
    }
}
