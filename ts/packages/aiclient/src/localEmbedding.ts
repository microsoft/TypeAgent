// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Result, success, error } from "typechat";
import registerDebug from "debug";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { TextEmbeddingModel } from "./models.js";
import { runWithLocalEmbeddingModelLock } from "./localEmbeddingLock.js";
import { identifyEmbeddingModel } from "./identifiedEmbedding.js";

const debug = registerDebug("typeagent:aiclient:localEmbedding");

/**
 * Default local embedding model. all-MiniLM-L6-v2 produces 384-dimensional
 * embeddings and runs CPU FP32 via onnxruntime-node. Weights are
 * downloaded from the Hugging Face hub on first use (and cached) unless a
 * pre-staged cache directory is provided.
 */
export const DefaultLocalEmbeddingModel = "Xenova/all-MiniLM-L6-v2";

// Batch size kept modest to bound peak memory on CPU-only hosts.
const DefaultMaxBatchSize = 32;

let pipelineInitializationQueue = Promise.resolve();

// Minimal structural type for the transformers.js feature-extraction pipeline
// so we don't take a hard type-level dependency on the package (it is loaded
// lazily via dynamic import).
type FeatureExtractionPipeline = ((
    input: string | string[],
    options?: { pooling?: "mean" | "cls" | "none"; normalize?: boolean },
) => Promise<{ tolist(): number[][] }>) & { dispose(): Promise<void> };

export type LocalEmbeddingModelSettings = {
    revision?: string | undefined;
    dimensions?: number | undefined;
    localFilesOnly?: boolean | undefined;
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

function serializePipelineInitialization<T>(
    operation: () => Promise<T>,
): Promise<T> {
    const result = pipelineInitializationQueue.then(operation, operation);
    pipelineInitializationQueue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

function getModelCacheDir(
    cacheDir: string,
    modelName: string,
): string | undefined {
    const root = path.resolve(cacheDir);
    const modelDir = path.resolve(root, modelName);
    return modelDir.startsWith(`${root}${path.sep}`) ? modelDir : undefined;
}

function isCachedModelLoadFailure(
    failure: unknown,
    modelCacheDir: string,
): boolean {
    const message =
        failure instanceof Error ? failure.message : String(failure);
    return (
        message.includes("Load model from") &&
        message.toLocaleLowerCase().includes(modelCacheDir.toLocaleLowerCase())
    );
}

async function offlineModelSource(
    cacheDir: string | undefined,
    modelName: string,
    revision: string,
): Promise<string> {
    const modelDir = cacheDir && getModelCacheDir(cacheDir, modelName);
    if (!modelDir) {
        throw new Error(
            "Offline MiniLM requires a cacheDir containing the selected model",
        );
    }
    const revisionDir = path.resolve(modelDir, revision);
    if (!revisionDir.startsWith(modelDir + path.sep)) {
        throw new Error("MiniLM revision must resolve inside its model cache");
    }
    const candidates = [
        revisionDir,
        ...(revision === "main" ? [modelDir] : []),
    ];
    for (const candidate of candidates) {
        try {
            await Promise.all(
                [
                    "config.json",
                    "tokenizer.json",
                    "tokenizer_config.json",
                    path.join("onnx", "model.onnx"),
                ].map((file) => access(path.join(candidate, file))),
            );
            return candidate;
        } catch (cause) {
            if (
                cause === null ||
                typeof cause !== "object" ||
                !("code" in cause) ||
                (cause.code !== "ENOENT" && cause.code !== "ENOTDIR")
            ) {
                throw cause;
            }
        }
    }
    throw new Error(
        `Offline MiniLM cache is incomplete for ${modelName}@${revision}; stage the CPU FP32 snapshot under cacheDir`,
    );
}

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
    let disposed = false;

    async function getPipeline(): Promise<FeatureExtractionPipeline> {
        if (disposed) throw new Error("Local embedding model is disposed");
        if (pipelinePromise === undefined) {
            pipelinePromise = serializePipelineInitialization(async () => {
                debug(`Loading local embedding model '${modelName}'`);
                const transformers = await import("@huggingface/transformers");
                const effectiveCacheDir =
                    cacheDir ?? transformers.env.cacheDir ?? undefined;

                const loadPipeline = async () => {
                    const revision = settings?.revision ?? "main";
                    const offline = settings?.localFilesOnly ?? false;
                    const source = offline
                        ? await offlineModelSource(
                              effectiveCacheDir,
                              modelName,
                              revision,
                          )
                        : modelName;
                    const previous = {
                        cacheDir: transformers.env.cacheDir,
                        allowRemoteModels: transformers.env.allowRemoteModels,
                        allowLocalModels: transformers.env.allowLocalModels,
                        fetch: transformers.env.fetch,
                    };
                    if (effectiveCacheDir)
                        transformers.env.cacheDir = effectiveCacheDir;
                    if (offline) {
                        transformers.env.allowRemoteModels = false;
                        transformers.env.allowLocalModels = true;
                        transformers.env.fetch = async () => {
                            throw new Error(
                                "Offline MiniLM loading forbids runtime fetch",
                            );
                        };
                    }
                    try {
                        const extractor = await transformers.pipeline(
                            "feature-extraction",
                            source,
                            {
                                revision,
                                local_files_only: offline,
                                device: "cpu",
                                dtype: "fp32",
                            },
                        );
                        return Object.assign(
                            (
                                input: string | string[],
                                options?: {
                                    pooling?: "mean" | "cls" | "none";
                                    normalize?: boolean;
                                },
                            ) => extractor(input, options),
                            {
                                dispose: async () => {
                                    await extractor.dispose();
                                },
                            },
                        );
                    } finally {
                        Object.assign(transformers.env, previous);
                    }
                };

                const loadWithRecovery = async () => {
                    try {
                        return await loadPipeline();
                    } catch (failure) {
                        if (effectiveCacheDir) {
                            const modelCacheDir = getModelCacheDir(
                                effectiveCacheDir,
                                modelName,
                            );
                            if (
                                !settings?.localFilesOnly &&
                                modelCacheDir &&
                                isCachedModelLoadFailure(failure, modelCacheDir)
                            ) {
                                debug(
                                    `Removing incomplete local embedding cache '${modelCacheDir}' and retrying`,
                                );
                                await rm(modelCacheDir, {
                                    recursive: true,
                                    force: true,
                                });
                                return loadPipeline();
                            }
                        }
                        throw failure;
                    }
                };

                const extractor = effectiveCacheDir
                    ? await runWithLocalEmbeddingModelLock(
                          effectiveCacheDir,
                          modelName,
                          loadWithRecovery,
                      )
                    : await loadWithRecovery();

                debug(`Loaded local embedding model '${modelName}'`);
                return extractor;
            });
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
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return error(
                `Local embedding model '${modelName}' failed: ${message}`,
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
        async resolve() {
            await getPipeline();
            return model;
        },
        async dispose() {
            if (disposed) return;
            disposed = true;
            if (pipelinePromise) await (await pipelinePromise).dispose();
        },
    };
    return identifyEmbeddingModel(model, {
        provider: "local",
        model: modelName,
        revision: settings?.revision ?? "main",
        dimensions: settings?.dimensions ?? 384,
        pooling: "mean",
        normalization: "l2",
        preprocessing:
            "Transformers.js 4.3.1 feature-extraction tokenizer; CPU FP32; no task prefix",
        configuration: { runtime: "transformers.js-4.3.1", model: modelName },
    });
}
