// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TextEmbeddingModel,
    EmbeddingIdentity,
    EmbeddingPart,
    embeddingIdentityKey,
    validateEmbeddingVector,
} from "@typeagent/aiclient";
import { collections } from "@typeagent/agent-runtime";
import { error, Result, success } from "typechat";
import { createHash } from "node:crypto";

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

export function embeddingCacheKey(
    text: string,
    identity?: EmbeddingIdentity,
): string {
    return identity
        ? JSON.stringify([embeddingIdentityKey(identity), text])
        : text;
}

export function mediaEmbeddingCacheKey(
    parts: readonly EmbeddingPart[],
    identity: EmbeddingIdentity,
): string {
    if (!Array.isArray(parts) || parts.length === 0) {
        throw new Error("Media samples must contain ordered parts");
    }
    const orderedParts = Array.from(parts, (part) => {
        if (part.type === "text" && typeof part.text === "string") {
            return ["text", part.text];
        }
        if (
            part.type === "image" &&
            part.bytes instanceof Uint8Array &&
            typeof part.mimeType === "string" &&
            part.mimeType.length > 0
        ) {
            const digest = createHash("sha256")
                .update(part.bytes)
                .digest("hex");
            if (part.sha256 !== digest) {
                throw new Error(
                    "Declared image digest does not match image bytes",
                );
            }
            return ["image", digest, part.mimeType];
        }
        throw new Error("Unsupported media embedding part");
    });
    const canonical = JSON.stringify([
        "media",
        embeddingIdentityKey(identity),
        orderedParts,
    ]);
    return `media:v1:${createHash("sha256").update(canonical).digest("hex")}`;
}

interface MediaEmbeddingCapability {
    generateMediaEmbeddingBatch(
        samples: EmbeddingPart[][],
    ): Promise<Result<number[][]>>;
}

function supportsMedia(
    model: TextEmbeddingModel,
): model is TextEmbeddingModel & MediaEmbeddingCapability {
    return (
        "generateMediaEmbeddingBatch" in model &&
        typeof model.generateMediaEmbeddingBatch === "function"
    );
}

function preserveModelCapabilities<
    T extends TextEmbeddingModel,
    U extends TextEmbeddingModel,
>(innerModel: T, overrides: U): T & U {
    const wrapped = new Proxy(overrides, {
        get(target, property, receiver) {
            if (Reflect.has(target, property)) {
                return Reflect.get(target, property, receiver);
            }
            const value: unknown = Reflect.get(
                innerModel,
                property,
                innerModel,
            );
            if (typeof value !== "function") return value;
            if (property === "resolve") {
                return async (...args: unknown[]) => {
                    const resolved: unknown = await Reflect.apply(
                        value,
                        innerModel,
                        args,
                    );
                    return resolved === innerModel ? wrapped : resolved;
                };
            }
            return value.bind(innerModel);
        },
        has(target, property) {
            return (
                Reflect.has(target, property) ||
                Reflect.has(innerModel, property)
            );
        },
    });
    return wrapped as T & U;
}

/**
 * Create an embedding model that can leverage a cache to improve performance
 * - You supply callbacks to manage the cache
 * Only calls the innerModel for those text items that did not hit the cache
 * Media-capable models share this cache using verified ordered-media keys.
 * @param innerModel Model to invoke when cache is not hit
 * @param getFromCache Callback to lookup embeddings from a cache
 * @param putInCache (Optional) update the cache with embeddings
 * @returns
 */
export function createTextEmbeddingModelWithCache<T extends TextEmbeddingModel>(
    innerModel: T,
    cache: TextEmbeddingCache,
): T {
    const modelWithCache: TextEmbeddingModel &
        Partial<MediaEmbeddingCapability> = {
        generateEmbedding,
        maxBatchSize: innerModel.maxBatchSize,
        get embeddingIdentity() {
            return innerModel.embeddingIdentity;
        },
        ...(innerModel.forRole
            ? {
                  forRole: (role) =>
                      createTextEmbeddingModelWithCache(
                          innerModel.forRole!(role),
                          cache,
                      ),
              }
            : {}),
    };
    if (innerModel.generateEmbeddingBatch) {
        modelWithCache.generateEmbeddingBatch = generateEmbeddingBatch;
    }
    if (supportsMedia(innerModel)) {
        modelWithCache.generateMediaEmbeddingBatch =
            generateMediaEmbeddingBatch;
    }
    return preserveModelCapabilities(innerModel, modelWithCache);

    async function generateEmbedding(input: string): Promise<Result<number[]>> {
        const embedding = getCached(input);
        if (embedding) {
            return success(embedding);
        }
        const result = await innerModel.generateEmbedding(input);
        if (result.success) {
            const invalid = validateBatch([result.data], 1);
            if (invalid) return error(invalid);
            updateCache(input, result.data);
        }
        return result;
    }

    async function generateEmbeddingBatch(
        inputs: string[],
    ): Promise<Result<number[][]>> {
        if (inputs.length === 0) {
            return error("Could not generate embeddings for empty input");
        }
        let embeddingBatch: number[][] = new Array(inputs.length);
        let inputBatch: string[] | undefined;
        // First, grab any embeddings we already have
        for (let i = 0; i < inputs.length; ++i) {
            const input = inputs[i];
            const embedding = getCached(input);
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
            const invalid = validateBatch(newEmbeddings, inputBatch.length);
            if (invalid) return error(invalid);
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
        return success(embeddingBatch);
    }

    async function generateMediaEmbeddingBatch(
        samples: EmbeddingPart[][],
    ): Promise<Result<number[][]>> {
        try {
            if (samples.length === 0)
                return error("Empty media embedding batch");
            if (
                !innerModel.embeddingIdentity &&
                "resolve" in innerModel &&
                typeof innerModel.resolve === "function"
            ) {
                await innerModel.resolve();
            }
            const identity = innerModel.embeddingIdentity;
            if (!identity)
                return error(
                    "Media caching requires a resolved embedding identity",
                );
            const namespace = embeddingIdentityKey(identity);
            const snapshot = Array.from(samples, (parts) =>
                Array.from(parts, (part) => {
                    if (part.type === "image") {
                        if (!(part.bytes instanceof Uint8Array)) {
                            throw new Error("Image parts require bytes");
                        }
                        return { ...part, bytes: Uint8Array.from(part.bytes) };
                    }
                    return { ...part };
                }),
            );
            const keys = snapshot.map((parts) =>
                mediaEmbeddingCacheKey(parts, identity),
            );
            const embeddings: number[][] = new Array(samples.length);
            const missing: number[] = [];
            for (let i = 0; i < keys.length; ++i) {
                const cached = cache.getEmbedding(keys[i]);
                if (cached && !validateBatch([cached], 1)) {
                    embeddings[i] = cached;
                } else {
                    missing.push(i);
                }
            }
            if (missing.length > 0) {
                if (!supportsMedia(innerModel))
                    return error("Media embeddings are unsupported");
                const result = await innerModel.generateMediaEmbeddingBatch(
                    missing.map((i) => snapshot[i]),
                );
                if (!result.success) return result;
                const invalid = validateBatch(result.data, missing.length);
                if (invalid) return error(invalid);
                if (
                    !innerModel.embeddingIdentity ||
                    embeddingIdentityKey(innerModel.embeddingIdentity) !==
                        namespace
                ) {
                    return error(
                        "Media embedding identity changed during generation",
                    );
                }
                for (let i = 0; i < missing.length; ++i) {
                    const position = missing[i];
                    embeddings[position] = result.data[i];
                    cache.putEmbedding?.(keys[position], result.data[i]);
                }
            }
            return success(embeddings);
        } catch (cause) {
            return error(`Media embedding cache failed: ${cause}`);
        }
    }

    function updateCache(text: string, embedding: number[]): void {
        if (innerModel.forRole && !innerModel.embeddingIdentity) return;
        if (cache.putEmbedding !== undefined) {
            cache.putEmbedding(
                embeddingCacheKey(text, innerModel.embeddingIdentity),
                embedding,
            );
        }
    }

    function getCached(text: string): number[] | undefined {
        if (innerModel.forRole && !innerModel.embeddingIdentity)
            return undefined;
        const value = cache.getEmbedding(
            embeddingCacheKey(text, innerModel.embeddingIdentity),
        );
        return value && !validateBatch([value], 1) ? value : undefined;
    }

    function validateBatch(
        values: number[][],
        count: number,
    ): string | undefined {
        try {
            if (!Array.isArray(values) || values.length !== count) {
                throw new Error("Embedding batch cardinality mismatch");
            }
            const identity = innerModel.embeddingIdentity;
            const dimensions = identity?.dimensions ?? values[0]?.length;
            for (const value of values) {
                if (
                    !Array.isArray(value) ||
                    !dimensions ||
                    value.length !== dimensions ||
                    !Array.from(value).every(Number.isFinite)
                ) {
                    throw new Error("Invalid embedding vector");
                }
                if (identity)
                    validateEmbeddingVector(value, identity.dimensions);
            }
        } catch (cause) {
            return `Invalid embedding output: ${cause}`;
        }
        return undefined;
    }
}

export interface TextEmbeddingModelWithCache extends TextEmbeddingModel {
    readonly cache: collections.Cache<string, number[]>;
    cacheEnabled: boolean;
    getPersistentCache?: (() => TextEmbeddingCache | undefined) | undefined;
}

/**
 * Create an embedding model that leverages caches to improve performance
 * - Maintains an in-memory LRU cache
 * - Allows for optional lookup from a persistent cache
 * - Preserves role, descriptor and lifecycle capabilities. Text and ordered
 *   media embeddings share the LRU and persistent cache with separate keys.
 * @param innerModel Model to call when no cache hit
 * @param memCacheSize Size of the memory cache
 * @param persistentCache (Optional) Lookup from persistent cache
 * @returns
 */
export function createEmbeddingCache<T extends TextEmbeddingModel>(
    innerModel: T,
    memCacheSize: number,
    getPersistentCache?: () => TextEmbeddingCache | undefined,
): T & TextEmbeddingModelWithCache {
    const memCache: collections.Cache<string, number[]> =
        collections.createLRUCache(memCacheSize);
    let cacheEnabled: boolean = true;
    const roleModel = innerModel;
    const roles = new Map<string, TextEmbeddingModelWithCache>();
    innerModel = createTextEmbeddingModelWithCache(innerModel, {
        getEmbedding: getFromCache,
        putEmbedding: putInCache,
    });
    const modelWithCache: TextEmbeddingModelWithCache = {
        cache: memCache,
        generateEmbedding,
        maxBatchSize: innerModel.maxBatchSize,
        get embeddingIdentity() {
            return innerModel.embeddingIdentity;
        },
        ...(roleModel.forRole
            ? {
                  forRole: (role) => {
                      if (modelWithCache.embeddingIdentity?.task === role)
                          return wrappedModel;
                      let selected = roles.get(role);
                      if (!selected) {
                          selected = createEmbeddingCache(
                              roleModel.forRole!(role),
                              memCacheSize,
                              () => modelWithCache.getPersistentCache?.(),
                          );
                          selected.cacheEnabled = cacheEnabled;
                          roles.set(role, selected);
                      }
                      return selected;
                  },
              }
            : {}),
        get cacheEnabled() {
            return cacheEnabled;
        },
        set cacheEnabled(value: boolean) {
            cacheEnabled = value;
            for (const selected of roles.values()) {
                selected.cacheEnabled = value;
            }
        },
        getPersistentCache,
    };
    if (innerModel.generateEmbeddingBatch) {
        modelWithCache.generateEmbeddingBatch = generateEmbeddingBatch;
    }
    const wrappedModel = preserveModelCapabilities(innerModel, modelWithCache);
    return wrappedModel;

    async function generateEmbedding(input: string): Promise<Result<number[]>> {
        return innerModel.generateEmbedding(input);
    }

    async function generateEmbeddingBatch(
        inputs: string[],
    ): Promise<Result<number[][]>> {
        return innerModel.generateEmbeddingBatch!(inputs);
    }

    function getFromCache(text: string): number[] | undefined {
        if (!cacheEnabled) {
            return undefined;
        }
        const persistentCache = modelWithCache.getPersistentCache
            ? modelWithCache.getPersistentCache()
            : undefined;
        let embedding = persistentCache
            ? persistentCache.getEmbedding(text)
            : undefined;
        embedding ??= memCache.get(text);
        return embedding;
    }

    function putInCache(text: string, embedding: number[]): void {
        if (!cacheEnabled) return;
        memCache.put(text, embedding);
        const persistentCache = modelWithCache.getPersistentCache
            ? modelWithCache.getPersistentCache()
            : undefined;
        if (persistentCache && persistentCache.putEmbedding) {
            persistentCache.putEmbedding(text, embedding);
        }
    }
}
