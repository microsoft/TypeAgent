// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Foundational, dependency-free API types shared across the aiclient
// provider modules. Kept in a leaf module (no intra-package imports) so that
// openai.ts and the provider/settings modules can share these enums and types
// without importing each other, which would form circular dependencies.

export enum ModelType {
    Chat = "chat",
    Embedding = "embedding",
    Image = "image",
    Video = "video",
}

export type ModelInfo<T> = {
    type: ModelType;
    model: T;
    endpointName?: string;
    maxTokens: number;
};

export type ModelProviders = "openai" | "azure" | "ollama" | "copilot";

export type CompletionUsageStats = {
    // Number of tokens in the generated completion
    completion_tokens: number;
    // Number of tokens in the prompt
    prompt_tokens: number;
    // Total tokens (prompt + completion)
    total_tokens: number;
    // Cached tokens are a subset of prompt_tokens (prompt cache hits).
    cached_tokens?: number;
};

/** OpenAI-compatible usage payloads may nest cache stats under details. */
export type OpenAICompatibleCompletionUsageStats = CompletionUsageStats & {
    prompt_tokens_details?: { cached_tokens?: number };
};

/** Flatten provider usage into CompletionUsageStats (cached_tokens only). */
export function normalizeOpenAICompatibleUsage(
    usage: OpenAICompatibleCompletionUsageStats,
): CompletionUsageStats {
    const cachedTokens =
        usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens;
    return {
        completion_tokens: usage.completion_tokens,
        prompt_tokens: usage.prompt_tokens,
        total_tokens: usage.total_tokens,
        ...(cachedTokens !== undefined && { cached_tokens: cachedTokens }),
    };
}

/**
 * Environment variables used to configure OpenAI clients
 */
export enum EnvVars {
    OPENAI_API_KEY = "OPENAI_API_KEY",
    OPENAI_ENDPOINT = "OPENAI_ENDPOINT",
    OPENAI_ENDPOINT_EMBEDDING = "OPENAI_ENDPOINT_EMBEDDING",

    OPENAI_ORGANIZATION = "OPENAI_ORGANIZATION",
    OPENAI_MODEL = "OPENAI_MODEL",
    OPENAI_RESPONSE_FORMAT = "OPENAI_RESPONSE_FORMAT",
    OPENAI_MAX_CONCURRENCY = "AZURE_OPENAI_MAX_CONCURRENCY",
    OPENAI_MAX_TIMEOUT = "OPENAI_MAX_TIMEOUT",
    OPENAI_MAX_RETRYATTEMPTS = "OPENAI_MAX_RETRYATTEMPTS",
    OPENAI_MODEL_EMBEDDING = "OPENAI_MODEL_EMBEDDING",

    AZURE_OPENAI_API_KEY = "AZURE_OPENAI_API_KEY",
    AZURE_OPENAI_ENDPOINT = "AZURE_OPENAI_ENDPOINT",
    AZURE_OPENAI_RESPONSE_FORMAT = "AZURE_OPENAI_RESPONSE_FORMAT",
    AZURE_OPENAI_MAX_CONCURRENCY = "AZURE_OPENAI_MAX_CONCURRENCY",
    AZURE_OPENAI_MAX_TIMEOUT = "AZURE_OPENAI_MAX_TIMEOUT",
    AZURE_OPENAI_MAX_RETRYATTEMPTS = "AZURE_OPENAI_MAX_RETRYATTEMPTS",
    AZURE_OPENAI_MAX_CHARS = "AZURE_OPENAI_MAX_CHARS",

    AZURE_OPENAI_API_KEY_EMBEDDING = "AZURE_OPENAI_API_KEY_EMBEDDING",
    AZURE_OPENAI_ENDPOINT_EMBEDDING = "AZURE_OPENAI_ENDPOINT_EMBEDDING",

    AZURE_OPENAI_API_KEY_GPT_IMAGE_1_5 = "AZURE_OPENAI_API_KEY_GPT_IMAGE_1_5",
    AZURE_OPENAI_ENDPOINT_GPT_IMAGE_1_5 = "AZURE_OPENAI_ENDPOINT_GPT_IMAGE_1_5",
    // Generic fallback for any current/future image model
    AZURE_OPENAI_API_KEY_GPT_IMAGE = "AZURE_OPENAI_API_KEY_GPT_IMAGE",
    AZURE_OPENAI_ENDPOINT_GPT_IMAGE = "AZURE_OPENAI_ENDPOINT_GPT_IMAGE",
    AZURE_OPENAI_API_KEY_SORA_2 = "AZURE_OPENAI_API_KEY_SORA_2",
    AZURE_OPENAI_ENDPOINT_SORA_2 = "AZURE_OPENAI_ENDPOINT_SORA_2",

    OLLAMA_ENDPOINT = "OLLAMA_ENDPOINT",

    AZURE_MAPS_ENDPOINT = "AZURE_MAPS_ENDPOINT",
    AZURE_MAPS_CLIENTID = "AZURE_MAPS_CLIENTID",

    ENABLE_MODEL_REQUEST_LOGGING = "ENABLE_MODEL_REQUEST_LOGGING",

    AZURE_STORAGE_ACCOUNT = "AZURE_STORAGE_ACCOUNT",
    AZURE_STORAGE_CONTAINER = "AZURE_STORAGE_CONTAINER",
}
