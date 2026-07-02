// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEmbeddingModel } from "./models.js";
import { createEmbeddingModel, EnvVars } from "./openai.js";
import { createLocalEmbeddingModel } from "./localEmbedding.js";

/**
 * The configured source of text embeddings.
 * - "local": CPU-only transformers.js model bundled with the app.
 * - "openai" / "azure": hosted embedding endpoints.
 * - "none": embeddings are disabled; consumers must degrade gracefully.
 */
export type EmbeddingProvider = "local" | "openai" | "azure" | "none";

// Flattened form of the config `embedding:` section.
enum EmbeddingEnvVars {
    PROVIDER = "TYPEAGENT_EMBEDDING_PROVIDER",
    MODEL = "TYPEAGENT_EMBEDDING_MODEL",
    CACHE_DIR = "TYPEAGENT_EMBEDDING_CACHE_DIR",
}

function isEmbeddingProvider(value: string): value is EmbeddingProvider {
    return (
        value === "local" ||
        value === "openai" ||
        value === "azure" ||
        value === "none"
    );
}

/**
 * Determine the configured embedding provider using configuration only
 * (no network access, no model loading). An explicit
 * `TYPEAGENT_EMBEDDING_PROVIDER` always wins; otherwise the provider is
 * inferred from the presence of hosted embedding endpoints, defaulting to
 * "none" when nothing is configured.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
    const explicit = process.env[EmbeddingEnvVars.PROVIDER]?.trim();
    if (explicit && isEmbeddingProvider(explicit)) {
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
 * True when an embedding model can be created without a hosted endpoint,
 * i.e. embeddings are available even in Copilot / offline modes.
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
    switch (provider) {
        case "none":
            return undefined;
        case "local":
            return createLocalEmbeddingModel({
                model: process.env[EmbeddingEnvVars.MODEL]?.trim() || undefined,
                cacheDir:
                    process.env[EmbeddingEnvVars.CACHE_DIR]?.trim() ||
                    undefined,
            });
        default:
            return endpoint !== undefined
                ? createEmbeddingModel(endpoint, dimensions)
                : createEmbeddingModel(undefined, dimensions);
    }
}
