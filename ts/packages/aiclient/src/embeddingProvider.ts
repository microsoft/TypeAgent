// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEmbeddingModel } from "./models.js";
import {
    resolveEmbeddingConfig,
    type EmbeddingConfig,
} from "@typeagent/config";
import { createEmbeddingModel } from "./openai.js";
import { EnvVars } from "./apiTypes.js";
import { createLocalEmbeddingModel } from "./localEmbedding.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
    createGemmaEmbeddingModel,
    DefaultGemmaEmbeddingModel,
    GemmaEmbeddingDimensions,
} from "./gemmaEmbedding.js";
import { identifyEmbeddingModel } from "./identifiedEmbedding.js";
import {
    CandidateEmbeddingOptions,
    createLazyCandidateEmbeddingModel,
    LazyCandidateEmbeddingModel,
} from "./candidateEmbedding.js";
import {
    createCopilotEmbeddingModel,
    DefaultCopilotEmbeddingModel,
} from "./copilotEmbedding.js";

/**
 * The configured source of text embeddings.
 * - "local": CPU-only transformers.js model bundled with the app.
 * - "openai" / "azure" / "copilot": hosted embedding endpoints.
 * - "none": embeddings are disabled; consumers must degrade gracefully.
 */
export type EmbeddingProvider =
    | "local"
    | "openai"
    | "azure"
    | "copilot"
    | "none";

// Embedding sizes of well-known defaults, used when no size is configured.
const LocalDefaultEmbeddingSize = 384; // Xenova/all-MiniLM-L6-v2
const HostedDefaultEmbeddingSize = 1536; // ada-002 / text-embedding-3-small

function getEmbeddingConfig() {
    return resolveEmbeddingConfig(getRuntimeConfig());
}

/**
 * The embedding vector size for the selected catalog or legacy profile.
 * Its explicit size wins; otherwise the default model's size is used:
 * `LocalDefaultEmbeddingSize` for the local provider,
 * `HostedDefaultEmbeddingSize` for hosted endpoints. Set `size` when using a
 * non-default model. Configuration only; never loads a model.
 */
export function getEmbeddingSize(): number {
    const config = getEmbeddingConfig();
    const configured = config?.size;
    if (configured !== undefined) return configured;
    if (usesGemma()) return GemmaEmbeddingDimensions;
    if (config?.model === "text-embedding-3-large") return 3072;
    return getEmbeddingProvider() === "local"
        ? LocalDefaultEmbeddingSize
        : HostedDefaultEmbeddingSize;
}

function usesGemma(): boolean {
    const config = getEmbeddingConfig();
    return (
        getEmbeddingProvider() === "local" &&
        (config?.runtime === "embeddinggemma" ||
            (config?.runtime === undefined &&
                config?.model === DefaultGemmaEmbeddingModel))
    );
}

function createConfiguredLocalModel(
    config: EmbeddingConfig | undefined,
    dimensions: number | undefined,
): TextEmbeddingModel {
    if (usesGemma()) {
        if ((dimensions ?? getEmbeddingSize()) !== GemmaEmbeddingDimensions) {
            throw new Error("EmbeddingGemma requires embedding.size: 768");
        }
        return createGemmaEmbeddingModel(config);
    }
    return createLocalEmbeddingModel({
        model: config?.model,
        cacheDir: config?.cacheDir,
        maxBatchSize: config?.maxBatchSize,
        revision: config?.revision,
        dimensions: dimensions ?? getEmbeddingSize(),
        localFilesOnly: config?.localFilesOnly,
    });
}

function createConfiguredCopilotModel(
    config: EmbeddingConfig | undefined,
    dimensions: number | undefined,
): TextEmbeddingModel {
    const name = config?.model ?? DefaultCopilotEmbeddingModel;
    const size = dimensions ?? getEmbeddingSize();
    const model = createCopilotEmbeddingModel(name, undefined, undefined, {
        dimensions: size,
        maxBatchSize: config?.maxBatchSize,
    });
    return identifyEmbeddingModel(model, {
        provider: "copilot",
        model: name,
        revision: config?.revision ?? "provider-managed-unversioned",
        dimensions: size,
        pooling: "provider-managed",
        normalization: "l2",
        preprocessing: "provider-managed text embedding",
        configuration: { model: name },
    });
}

function createConfiguredHostedModel(
    provider: "azure" | "openai",
    config: EmbeddingConfig | undefined,
    endpoint: string | undefined,
    dimensions: number | undefined,
    named: boolean,
): TextEmbeddingModel {
    const expectedDimensions = dimensions ?? config?.size;
    const options = {
        provider,
        modelName: config?.model,
        maxBatchSize: config?.maxBatchSize,
        revision: config?.revision,
        expectedDimensions,
    };
    const target = endpoint ?? config?.deployment;
    // Ada and unknown catalog models only validate size; embedding-3 models
    // also support requesting that size from the endpoint.
    const supportsDimensions =
        config?.model === "text-embedding-3-large" ||
        config?.model === "text-embedding-3-small";
    const requestedDimensions =
        !named || supportsDimensions ? expectedDimensions : dimensions;
    return target !== undefined
        ? createEmbeddingModel(target, requestedDimensions, options)
        : createEmbeddingModel(undefined, requestedDimensions, options);
}

/**
 * Determine the configured embedding provider using configuration only
 * (no network access, no model loading). The selected catalog profile or
 * legacy `embedding.provider` wins; otherwise the provider is
 * inferred from the presence of hosted embedding endpoints, defaulting to
 * "none" when nothing is configured.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
    const explicit = getEmbeddingConfig()?.provider;
    if (explicit !== undefined) {
        return explicit;
    }
    if (
        EnvVars.OPENAI_API_KEY in process.env &&
        EnvVars.OPENAI_ENDPOINT_EMBEDDING in process.env
    ) {
        return "openai";
    }
    if (EnvVars.AZURE_OPENAI_ENDPOINT_EMBEDDING in process.env) {
        return "azure";
    }
    return "none";
}

/**
 * True when the configured embedding provider can construct a model.
 * Hosted providers perform endpoint acquisition on first use.
 */
export function isEmbeddingAvailable(): boolean {
    return getEmbeddingProvider() !== "none";
}

/**
 * Create an embedding model for the configured provider, or return
 * `undefined` when embeddings are disabled ("none"). Construction never
 * performs network I/O; hosted providers fail lazily on first use and the
 * local provider loads its runtime lazily on first use.
 *
 * Callers that cannot function without embeddings should treat `undefined`
 * as "feature disabled" and degrade gracefully.
 */
export function tryCreateEmbeddingModel(
    endpoint: string | undefined,
    dimensions: number | undefined,
    options: { candidate: CandidateEmbeddingOptions },
): LazyCandidateEmbeddingModel;
export function tryCreateEmbeddingModel(
    endpoint?: string,
    dimensions?: number,
    options?: { candidate?: CandidateEmbeddingOptions },
): TextEmbeddingModel | undefined;
export function tryCreateEmbeddingModel(
    endpoint?: string,
    dimensions?: number,
    options?: { candidate?: CandidateEmbeddingOptions },
): TextEmbeddingModel | undefined {
    if (options?.candidate) {
        return createLazyCandidateEmbeddingModel(options.candidate);
    }
    const provider = getEmbeddingProvider();
    const config = getEmbeddingConfig();
    if (config?.modalities?.includes("image") && !usesGemma()) {
        throw new Error(
            "Image embeddings require the local EmbeddingGemma runtime",
        );
    }
    if (
        config?.runtime === "minilm" &&
        config?.model === DefaultGemmaEmbeddingModel
    ) {
        throw new Error("EmbeddingGemma cannot use the MiniLM runtime");
    }
    const named = getRuntimeConfig().defaultEmbeddingModel !== undefined;
    if (named && provider !== "none") {
        if (dimensions !== undefined && dimensions !== config?.size) {
            throw new Error(
                "Named embedding model dimensions cannot be overridden; select a different embedding profile",
            );
        }
        if (endpoint !== undefined && endpoint !== config?.deployment) {
            throw new Error(
                "Named embedding model deployment cannot be overridden; select a different embedding profile",
            );
        }
    }
    switch (provider) {
        case "none":
            return undefined;
        case "local":
            return createConfiguredLocalModel(config, dimensions);
        case "copilot":
            return createConfiguredCopilotModel(config, dimensions);
        default:
            return createConfiguredHostedModel(
                provider,
                config,
                endpoint,
                dimensions,
                named,
            );
    }
}
