// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEmbeddingModel } from "./models.js";
import { createEmbeddingModel } from "./openai.js";
import { EnvVars } from "./apiTypes.js";
import { createLocalEmbeddingModel } from "./localEmbedding.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
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

// The `embedding:` section of the runtime config.
function getEmbeddingConfig() {
    return getRuntimeConfig().embedding;
}

/**
 * The embedding vector size for the configured provider. An explicit
 * `embedding.size` always wins; otherwise the default model's size is used:
 * `LocalDefaultEmbeddingSize` for the local provider,
 * `HostedDefaultEmbeddingSize` for hosted endpoints. Set `size` when using a
 * non-default model. Configuration only; never loads a model.
 */
export function getEmbeddingSize(): number {
    const configured = getEmbeddingConfig()?.size;
    if (configured !== undefined) return configured;
    return getEmbeddingProvider() === "local"
        ? LocalDefaultEmbeddingSize
        : HostedDefaultEmbeddingSize;
}

/**
 * Determine the configured embedding provider using configuration only
 * (no network access, no model loading). An explicit
 * `embedding.provider` always wins; otherwise the provider is
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
    endpoint?: string,
    dimensions?: number,
): TextEmbeddingModel | undefined {
    const provider = getEmbeddingProvider();
    const config = getEmbeddingConfig();
    switch (provider) {
        case "none":
            return undefined;
        case "local":
            return createLocalEmbeddingModel({
                model: config?.model,
                cacheDir: config?.cacheDir,
                maxBatchSize: config?.maxBatchSize,
            });
        case "copilot":
            return createCopilotEmbeddingModel(
                config?.model ?? DefaultCopilotEmbeddingModel,
                undefined,
                undefined,
                {
                    dimensions: dimensions ?? config?.size,
                    maxBatchSize: config?.maxBatchSize,
                },
            );
        default: {
            dimensions ??= config?.size;
            const options = {
                modelName: config?.model,
                maxBatchSize: config?.maxBatchSize,
            };
            return endpoint !== undefined
                ? createEmbeddingModel(endpoint, dimensions, options)
                : createEmbeddingModel(undefined, dimensions, options);
        }
    }
}
