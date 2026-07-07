// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Result, success, error } from "typechat";
import registerDebug from "debug";
import { TextEmbeddingModel } from "./models.js";

const debug = registerDebug("typeagent:aiclient:localEmbedding");

/**
 * Default local embedding model. all-MiniLM-L6-v2 produces 384-dimensional
 * embeddings, is ~23MB, and runs on CPU via onnxruntime-node. Weights are
 * downloaded from the Hugging Face hub on first use (and cached) unless a
 * pre-staged cache directory is provided.
 */
export const DefaultLocalEmbeddingModel = "Xenova/all-MiniLM-L6-v2";

// Batch size kept modest to bound peak memory on CPU-only hosts.
const DefaultMaxBatchSize = 32;

// Minimal structural type for the transformers.js feature-extraction pipeline
// so we don't take a hard type-level dependency on the package (it is loaded
// lazily via dynamic import).
type FeatureExtractionPipeline = (
    input: string | string[],
    options?: { pooling?: "mean" | "cls" | "none"; normalize?: boolean },
) => Promise<{ tolist(): number[][] }>;

export type LocalEmbeddingModelSettings = {
    /** Hugging Face model id (defaults to all-MiniLM-L6-v2). */
    model?: string | undefined;
    /** Maximum number of inputs per batch. */
    maxBatchSize?: number | undefined;
    /**
     * Optional directory used to cache / pre-stage ONNX weights. Maps to the
     * transformers.js `env.cacheDir`. Useful for air-gapped installs.
     */
    cacheDir?: string | undefined;
};

/**
 * Create a CPU-only local text embedding model backed by transformers.js
 * (onnxruntime-node). The underlying runtime and model weights are loaded
 * lazily on first use so that construction never performs I/O and never
 * throws; failures surface as a failed Result from generateEmbedding.
 */
export function createLocalEmbeddingModel(
    settings?: LocalEmbeddingModelSettings,
): TextEmbeddingModel {
    const modelName = settings?.model ?? DefaultLocalEmbeddingModel;
    const maxBatchSize = settings?.maxBatchSize ?? DefaultMaxBatchSize;
    const cacheDir = settings?.cacheDir;

    let pipelinePromise: Promise<FeatureExtractionPipeline> | undefined;

    async function getPipeline(): Promise<FeatureExtractionPipeline> {
        if (pipelinePromise === undefined) {
            pipelinePromise = (async () => {
                debug(`Loading local embedding model '${modelName}'`);
                const transformers = await import("@huggingface/transformers");
                if (cacheDir) {
                    transformers.env.cacheDir = cacheDir;
                }
                const extractor = await transformers.pipeline(
                    "feature-extraction",
                    modelName,
                );
                debug(`Loaded local embedding model '${modelName}'`);
                return extractor as unknown as FeatureExtractionPipeline;
            })();
            // If loading fails, clear the cache so a later call can retry.
            pipelinePromise.catch(() => {
                pipelinePromise = undefined;
            });
        }
        return pipelinePromise;
    }

    async function embed(inputs: string[]): Promise<Result<number[][]>> {
        try {
            const extractor = await getPipeline();
            const output = await extractor(inputs, {
                pooling: "mean",
                normalize: true,
            });
            return success(output.tolist());
        } catch (e: any) {
            return error(
                `Local embedding model '${modelName}' failed: ${e.message ?? e}`,
            );
        }
    }

    async function generateEmbedding(input: string): Promise<Result<number[]>> {
        if (!input) {
            return error("Empty input");
        }
        const result = await embed([input]);
        if (!result.success) {
            return result;
        }
        return success(result.data[0]);
    }

    async function generateEmbeddingBatch(
        inputs: string[],
    ): Promise<Result<number[][]>> {
        if (inputs.length === 0) {
            return error("Empty input array");
        }
        if (inputs.length > maxBatchSize) {
            return error(`Batch size must be <= ${maxBatchSize}`);
        }
        return embed(inputs);
    }

    const model: TextEmbeddingModel = {
        generateEmbedding,
        generateEmbeddingBatch,
        maxBatchSize,
    };
    return model;
}
