// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { error, Result, success } from "typechat";
import { TextEmbeddingModel } from "./models";

/**
 * An embedding cache
 */
export interface TextEmbeddingCache {
    /**
     * Get an embedding from the cache
     * @param text
     * @returns
     */
    getEmbedding: (text: string) => number[] | undefined;
    /**
     * (Optional): Put an embedding in the cache
     * @param text
     * @param value
     * @returns
     */
    putEmbedding?: (text: string, embedding: number[]) => void | undefined;
}

/**
 * Create an embedding model that can leverage a cache to improve performance
 * - You supply callbacks to manage the cache
 * Only calls the innerModel for those text items that did not hit the cache
 * @param innerModel Model to invoke when cache is not hit
 * @param getFromCache Callback to lookup embeddings from a cache
 * @param putInCache (Optional) update the cache with embeddings
 * @returns
 */
export function createTextEmbeddingModelWithCache(
    innerModel: TextEmbeddingModel,
    cache: TextEmbeddingCache,
): TextEmbeddingModel {
    const modelWithCache: TextEmbeddingModel = {
        generateEmbedding,
        maxBatchSize: innerModel.maxBatchSize,
    };
    if (innerModel.generateEmbeddingBatch) {
        modelWithCache.generateEmbeddingBatch = generateEmbeddingBatch;
    }
    return modelWithCache;

    async function generateEmbedding(input: string): Promise<Result<number[]>> {
        let embedding = cache.getEmbedding(input);
        if (embedding) {
            return success(embedding);
        }
        const result = await innerModel.generateEmbedding(input);
        if (result.success) {
            updateCache(input, result.data);
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
            let embedding = cache.getEmbedding(input);
            if (embedding === undefined) {
                // This one needs embeddings
                inputBatch ??= [];
                inputBatch.push(input);
            } else {
                embeddingBatch[i] = embedding;
            }
        }
        if (inputBatch && inputBatch.length > 0) {
            const result = await innerModel.generateEmbeddingBatch!(inputBatch);
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
                    updateCache(inputs[i], embeddingBatch[i]);
                }
            }
        }
        return embeddingBatch && embeddingBatch.length > 0
            ? success(embeddingBatch)
            : error("Could not generated embeddings");
    }

    function updateCache(text: string, embedding: number[]): void {
        if (cache.putEmbedding !== undefined) {
            cache.putEmbedding(text, embedding);
        }
    }
}
