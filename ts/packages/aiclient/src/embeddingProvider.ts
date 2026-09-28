// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEmbeddingModel } from "./models.js";
import { createEmbeddingModel } from "./openai.js";
import { EnvVars } from "./apiTypes.js";
import { createLocalEmbeddingModel } from "./localEmbedding.js";
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

// Flattened form of the config `embedding:` section.
enum EmbeddingEnvVars {
    PROVIDER = "TYPEAGENT_EMBEDDING_PROVIDER",
    MODEL = "TYPEAGENT_EMBEDDING_MODEL",
    CACHE_DIR = "TYPEAGENT_EMBEDDING_CACHE_DIR",
    SIZE = "TYPEAGENT_EMBEDDING_SIZE",
    MAX_BATCH_SIZE = "TYPEAGENT_EMBEDDING_MAX_BATCH_SIZE",
}

// Embedding sizes of well-known defaults, used when no size is configured.
const LocalDefaultEmbeddingSize = 384; // Xenova/all-MiniLM-L6-v2
const HostedDefaultEmbeddingSize = 1536; // ada-002 / text-embedding-3-small

function readPositiveInt(name: string): number | undefined {
    const raw = process.env[name]?.trim();
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * The embedding vector size for the configured provider. An explicit
 * `embedding.size` (`TYPEAGENT_EMBEDDING_SIZE`) always wins; otherwise the
 * default model's size is used (set `size` when using a non-default model) (384 for the local MiniLM model, 1536 for
 * hosted endpoints). Configuration only; never loads a model.
 */
export function getEmbeddingSize(): number {
    const configured = readPositiveInt(EmbeddingEnvVars.SIZE);
    if (configured !== undefined) return configured;
    return getEmbeddingProvider() === "local"
        ? LocalDefaultEmbeddingSize
        : HostedDefaultEmbeddingSize;
}

function isEmbeddingProvider(value: string): value is EmbeddingProvider {
    return (
        value === "local" ||
        value === "openai" ||
        value === "azure" ||
        value === "copilot" ||
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
    switch (provider) {
        case "none":
            return undefined;
        case "local":
            return createLocalEmbeddingModel({
                model: process.env[EmbeddingEnvVars.MODEL]?.trim() || undefined,
                cacheDir:
                    process.env[EmbeddingEnvVars.CACHE_DIR]?.trim() ||
                    undefined,
                maxBatchSize: readPositiveInt(EmbeddingEnvVars.MAX_BATCH_SIZE),
            });
        case "copilot":
            return createCopilotEmbeddingModel(
                process.env[EmbeddingEnvVars.MODEL]?.trim() ||
                    DefaultCopilotEmbeddingModel,
            );
        default:
            dimensions ??= readPositiveInt(EmbeddingEnvVars.SIZE);
            return endpoint !== undefined
                ? createEmbeddingModel(endpoint, dimensions)
                : createEmbeddingModel(undefined, dimensions);
    }
}
