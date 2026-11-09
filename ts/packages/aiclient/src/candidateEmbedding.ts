// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { pathToFileURL } from "node:url";
import { isAbsolute } from "node:path";
import { error, Result, success } from "typechat";
import { EmbeddingCapabilities, TextEmbeddingModel } from "./models.js";
import {
    EmbeddingIdentity,
    EmbeddingPart,
    EmbeddingRole,
    embeddingIdentityKey,
    validateEmbeddingVector,
} from "./embeddingIdentity.js";

export interface CandidateAdapter {
    descriptor: {
        provider: string;
        model: string;
        revision: string;
        dimensions: number;
        query_prompt: string;
        document_prompt: string;
        pooling: string;
        normalization: "l2";
        preprocessing: string;
        artifact_sha256: string;
    };
    embed(texts: string[], role: EmbeddingRole): Promise<number[][]>;
    embedMedia(
        samples: EmbeddingPart[][],
        role: EmbeddingRole,
    ): Promise<number[][]>;
    dispose(): Promise<void>;
    artifacts?: unknown;
    metadata?: unknown;
}

export interface CandidateEmbeddingOptions {
    adapterPath: string;
    runtimeDir: string;
    cacheDir: string;
    revision: string;
    localFilesOnly?: boolean;
    maxBatchSize?: number;
    /** Total active and queued calls across both roles and modalities. */
    maxPending?: number;
}

export interface CandidateEmbeddingModel extends TextEmbeddingModel {
    readonly descriptor?: CandidateAdapter["descriptor"] | undefined;
    readonly artifacts?: unknown;
    readonly metadata?: unknown;
    forRole(role: EmbeddingRole): CandidateEmbeddingModel;
    generateMediaEmbeddingBatch(
        samples: EmbeddingPart[][],
    ): Promise<Result<number[][]>>;
    resolve(): Promise<ResolvedCandidateEmbeddingModel>;
    dispose(): Promise<void>;
}

export interface ResolvedCandidateEmbeddingModel
    extends CandidateEmbeddingModel {
    readonly embeddingIdentity: EmbeddingIdentity;
    readonly descriptor: CandidateAdapter["descriptor"];
    forRole(role: EmbeddingRole): ResolvedCandidateEmbeddingModel;
}

export interface LazyCandidateEmbeddingModel extends CandidateEmbeddingModel {}

/** Shared bounded execution for packaged and experimental local adapters. */
export function createAdapterEmbeddingModel(
    options: Pick<
        CandidateEmbeddingOptions,
        "revision" | "maxBatchSize" | "maxPending"
    >,
    createAdapter: () => Promise<CandidateAdapter>,
    capabilities: EmbeddingCapabilities,
): LazyCandidateEmbeddingModel {
    const maxBatchSize = options.maxBatchSize ?? 8;
    const maxPending = options.maxPending ?? 16;
    if (
        !Number.isSafeInteger(maxBatchSize) ||
        maxBatchSize < 1 ||
        !Number.isSafeInteger(maxPending) ||
        maxPending < 1
    ) {
        throw new Error(
            "Candidate queue and batch limits must be positive integers",
        );
    }
    let adapter: CandidateAdapter | undefined;
    let descriptor: CandidateAdapter["descriptor"] | undefined;
    const identities = new Map<EmbeddingRole, EmbeddingIdentity>();
    let loading: Promise<CandidateAdapter> | undefined;
    let disposed = false;
    let disposal: Promise<void> | undefined;
    let pending = 0;
    let tail = Promise.resolve();
    const models = new Map<EmbeddingRole, CandidateEmbeddingModel>();

    async function load(): Promise<CandidateAdapter> {
        if (disposed) throw new Error("Candidate embedding model is disposed");
        if (!loading) {
            loading = (async () => {
                const instance = await createAdapter();
                try {
                    if (
                        typeof instance.embed !== "function" ||
                        typeof instance.embedMedia !== "function" ||
                        typeof instance.dispose !== "function" ||
                        instance.descriptor.provider !== "local" ||
                        instance.descriptor.revision !== options.revision
                    ) {
                        throw new Error(
                            "Unsupported candidate adapter contract",
                        );
                    }
                    const documentIdentity = identity(instance, "document");
                    const queryIdentity = identity(instance, "query");
                    descriptor = Object.freeze({ ...instance.descriptor });
                    identities.set("document", documentIdentity);
                    identities.set("query", queryIdentity);
                    adapter = instance;
                    return instance;
                } catch (cause) {
                    await instance.dispose?.();
                    throw cause;
                }
            })();
        }
        return loading;
    }

    function identity(
        instance: CandidateAdapter,
        role: EmbeddingRole,
    ): EmbeddingIdentity {
        const d = instance.descriptor;
        const value: EmbeddingIdentity = {
            schemaVersion: 1,
            provider: d.provider,
            model: d.model,
            revision: d.revision,
            dimensions: d.dimensions,
            task: role,
            prompt: role === "query" ? d.query_prompt : d.document_prompt,
            pooling: d.pooling,
            normalization: d.normalization,
            preprocessing: d.preprocessing,
            artifactHash: d.artifact_sha256,
        };
        embeddingIdentityKey(value);
        return Object.freeze(value);
    }

    async function run(
        count: number,
        role: EmbeddingRole,
        operation: (instance: CandidateAdapter) => Promise<number[][]>,
    ): Promise<Result<number[][]>> {
        if (disposed) return error("Candidate embedding model is disposed");
        if (count < 1 || count > maxBatchSize)
            return error("Unsupported candidate batch size");
        if (pending >= maxPending)
            return error("Candidate embedding queue is full");
        ++pending;
        const result = tail.then(async () => {
            try {
                if (disposed)
                    return error("Candidate embedding model is disposed");
                const instance = await load();
                const vectors = await operation(instance);
                if (!Array.isArray(vectors) || vectors.length !== count)
                    throw new Error("Candidate batch cardinality mismatch");
                const dimensions = identities.get(role)!.dimensions;
                for (const vector of vectors) {
                    validateEmbeddingVector(vector, dimensions);
                }
                return success(vectors);
            } catch (cause) {
                return error(`Candidate embedding failed: ${cause}`);
            } finally {
                --pending;
            }
        });
        tail = result.then(() => {});
        return result;
    }

    function forRole(role: EmbeddingRole): CandidateEmbeddingModel {
        if (role !== "query" && role !== "document") {
            throw new Error("Unsupported candidate embedding role");
        }
        let model = models.get(role);
        if (model) return model;
        model = {
            maxBatchSize,
            embeddingCapabilities: capabilities,
            get descriptor() {
                return descriptor;
            },
            get artifacts() {
                return adapter?.artifacts;
            },
            get metadata() {
                return adapter?.metadata;
            },
            get embeddingIdentity() {
                return identities.get(role);
            },
            forRole,
            async resolve() {
                await load();
                return model! as ResolvedCandidateEmbeddingModel;
            },
            async generateEmbedding(text) {
                const result = await model!.generateEmbeddingBatch!([text]);
                return result.success ? success(result.data[0]) : result;
            },
            generateEmbeddingBatch(texts) {
                return run(texts.length, role, (instance) =>
                    instance.embed(texts, role),
                );
            },
            async generateMediaEmbeddingBatch(samples) {
                if (samples.length < 1 || samples.length > maxBatchSize) {
                    return error("Unsupported candidate batch size");
                }
                if (
                    !capabilities.inputModalities.includes("image") &&
                    samples.some((parts) =>
                        parts.some((part) => part.type === "image"),
                    )
                ) {
                    return error(
                        "Image embeddings are disabled by configuration",
                    );
                }
                let byteBudget = 32 * 1024 * 1024;
                const snapshot: EmbeddingPart[][] = [];
                for (const parts of samples) {
                    const copied: EmbeddingPart[] = [];
                    for (const part of parts) {
                        byteBudget -=
                            part.type === "text"
                                ? Buffer.byteLength(part.text)
                                : part.bytes.byteLength;
                        if (byteBudget < 0)
                            return error("Media batch exceeds 32 MiB");
                        copied.push(
                            part.type === "text"
                                ? { ...part }
                                : {
                                      ...part,
                                      bytes: Uint8Array.from(part.bytes),
                                  },
                        );
                    }
                    snapshot.push(copied);
                }
                return run(samples.length, role, (instance) =>
                    instance.embedMedia(snapshot, role),
                );
            },
            dispose() {
                disposed = true;
                disposal ??= (async () => {
                    await tail;
                    if (loading) {
                        const instance = await loading.catch(() => undefined);
                        await instance?.dispose();
                        loading = undefined;
                    }
                })();
                return disposal;
            },
        };
        models.set(role, model);
        return model;
    }
    return forRole("document");
}

export function createLazyCandidateEmbeddingModel(
    options: CandidateEmbeddingOptions,
): LazyCandidateEmbeddingModel {
    return createAdapterEmbeddingModel(
        options,
        async () => {
            if (!isAbsolute(options.adapterPath)) {
                throw new Error("Candidate adapterPath must be absolute");
            }
            const module = await import(
                pathToFileURL(options.adapterPath).href
            );
            if (typeof module.createAdapter !== "function") {
                throw new Error("Candidate adapter must export createAdapter");
            }
            return module.createAdapter({
                runtimeDir: options.runtimeDir,
                cacheDir: options.cacheDir,
                revision: options.revision,
                localFilesOnly: options.localFilesOnly ?? false,
            });
        },
        { inputModalities: ["text", "image"], mixedInputs: true },
    );
}

export async function createCandidateEmbeddingModel(
    options: CandidateEmbeddingOptions,
): Promise<ResolvedCandidateEmbeddingModel> {
    return createLazyCandidateEmbeddingModel(options).resolve();
}
