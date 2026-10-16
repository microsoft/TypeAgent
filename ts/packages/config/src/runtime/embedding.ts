// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    Config,
    EmbeddingConfig,
    EmbeddingModelDefinition,
} from "./types.js";

export const EMBEDDING_MODELS_KEY = "TYPEAGENT_EMBEDDING_MODELS";
export const DEFAULT_EMBEDDING_MODEL_KEY = "TYPEAGENT_DEFAULT_EMBEDDING_MODEL";

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseEmbeddingModels(
    raw: string,
): Readonly<Record<string, EmbeddingModelDefinition>> {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        throw new Error(`${EMBEDDING_MODELS_KEY}: expected a JSON object`);
    }
    if (!object(value)) throw new Error("embeddingModels: expected an object");
    return value as Record<string, EmbeddingModelDefinition>;
}

export function mergeEmbeddingModels(lower: string, upper: string): string {
    const result = { ...parseEmbeddingModels(lower) };
    for (const [alias, definition] of Object.entries(
        parseEmbeddingModels(upper),
    )) {
        const previous = Object.prototype.hasOwnProperty.call(result, alias)
            ? result[alias]
            : undefined;
        Object.defineProperty(result, alias, {
            value:
                object(previous) && object(definition)
                    ? { ...previous, ...definition }
                    : definition,
            enumerable: true,
            configurable: true,
            writable: true,
        });
    }
    return JSON.stringify(result);
}

const DEFINITION_FIELDS = new Set([
    "provider",
    "model",
    "size",
    "modalities",
    "deployment",
    "runtime",
    "revision",
    "localFilesOnly",
    "cacheDir",
    "maxBatchSize",
    "maxPending",
]);

export function resolveEmbeddingConfig(
    config: Config,
): EmbeddingConfig | undefined {
    if (config.embeddingModels !== undefined) {
        if (!object(config.embeddingModels))
            throw new Error("embeddingModels: expected an object");
        for (const [alias, definition] of Object.entries(
            config.embeddingModels,
        )) {
            try {
                validateDefinition(alias, definition, config);
            } catch (error) {
                throw new Error(
                    `embeddingModels.${alias}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    }
    const selector = config.defaultEmbeddingModel;
    if (selector === undefined) return config.embedding;
    if (typeof selector !== "string" || selector.trim() === "") {
        throw new Error(
            "defaultEmbeddingModel: expected a nonempty alias or none",
        );
    }
    if (
        config.embedding &&
        Object.values(config.embedding).some((value) => value !== undefined)
    ) {
        throw new Error(
            "defaultEmbeddingModel cannot be combined with legacy embedding overrides; migrate embedding fields into embeddingModels and remove embedding",
        );
    }
    if (selector === "none") return { provider: "none" };
    if (
        !config.embeddingModels ||
        !Object.prototype.hasOwnProperty.call(config.embeddingModels, selector)
    ) {
        throw new Error(
            `defaultEmbeddingModel: unknown embedding model alias '${selector}'`,
        );
    }
    return config.embeddingModels[selector];
}

function validateDefinition(
    alias: string,
    definition: unknown,
    config: Config,
): void {
    if (!alias.trim() || alias === "none")
        throw new Error(
            "alias must be nonempty and cannot be reserved name none",
        );
    if (!object(definition))
        throw new Error("expected a model definition object");
    validateDefinitionFields(definition);
    const profile = definition as unknown as EmbeddingModelDefinition;
    validateEmbeddingConfig(profile);
    if (profile.provider === "local") {
        validateLocalDefinition(profile);
    } else {
        validateHostedDefinition(profile);
    }
    validateDeploymentReference(profile, config);
}

function validateDefinitionFields(definition: Record<string, unknown>): void {
    for (const key of Object.keys(definition)) {
        if (!DEFINITION_FIELDS.has(key))
            throw new Error(
                `unsupported field '${key}'; credentials and connections remain provider-owned`,
            );
    }
    for (const key of ["provider", "model", "size", "modalities"]) {
        if (definition[key] === undefined)
            throw new Error(`${key} is required`);
    }
    if (
        !["local", "azure", "openai", "copilot"].includes(
            definition.provider as string,
        )
    ) {
        throw new Error("provider must be local, azure, openai, or copilot");
    }
    for (const field of [
        "model",
        "revision",
        "cacheDir",
        "deployment",
    ] as const) {
        const value = definition[field];
        if (
            value !== undefined &&
            (typeof value !== "string" || !value.trim())
        ) {
            throw new Error(`${field}: expected a nonempty string`);
        }
    }
}

function validateLocalDefinition(profile: EmbeddingModelDefinition): void {
    if (!/^[0-9a-f]{40}$/i.test(profile.revision ?? "")) {
        throw new Error(
            "revision: local models require an immutable 40-character commit",
        );
    }
    const gemma = profile.model === GEMMA_MODEL;
    if (!gemma && !MINILM_MODELS.has(profile.model))
        throw new Error("model: unsupported local checkpoint");
    if (profile.size !== (gemma ? 768 : 384))
        throw new Error("size: incompatible with local model dimensions");
    if (
        profile.runtime !== undefined &&
        profile.runtime !== (gemma ? "embeddinggemma" : "minilm")
    ) {
        throw new Error("runtime: incompatible with local checkpoint");
    }
}

function validateHostedDefinition(profile: EmbeddingModelDefinition): void {
    for (const field of [
        "runtime",
        "localFilesOnly",
        "cacheDir",
        "maxPending",
    ] as const) {
        if (profile[field] !== undefined)
            throw new Error(`${field}: only supported by local models`);
    }
}

function validateDeploymentReference(
    profile: EmbeddingModelDefinition,
    config: Config,
): void {
    if (profile.provider === "azure") {
        if (
            profile.deployment !== undefined
                ? !config.azureOpenAI.deployments.has(profile.deployment)
                : config.azureOpenAI.defaultEmbedding === undefined
        ) {
            throw new Error(
                "deployment: must reference an existing azureOpenAI.deployments key, or omit it with azureOpenAI.defaultEmbedding configured",
            );
        }
    } else if (profile.deployment !== undefined) {
        throw new Error("deployment: only supported by azure models");
    }
}

const GEMMA_MODEL = "onnx-community/embeddinggemma-2-ONNX";
const MINILM_MODELS = new Set([
    "Xenova/all-MiniLM-L6-v2",
    "onnx-community/all-MiniLM-L6-v2-ONNX",
]);

export function validateEmbeddingConfig(
    config: EmbeddingConfig,
    partial = false,
): void {
    if (
        config.provider !== undefined &&
        !["local", "openai", "azure", "copilot", "none"].includes(
            config.provider,
        )
    ) {
        throw new Error(
            "embedding.provider: expected local, openai, azure, copilot, or none",
        );
    }
    if (
        config.runtime !== undefined &&
        config.runtime !== "minilm" &&
        config.runtime !== "embeddinggemma"
    ) {
        throw new Error("embedding.runtime: expected minilm or embeddinggemma");
    }
    for (const field of ["size", "maxBatchSize", "maxPending"] as const) {
        const value = config[field];
        if (
            value !== undefined &&
            (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0)
        ) {
            throw new Error(
                `embedding.${field}: expected a positive finite integer`,
            );
        }
    }
    if (
        config.localFilesOnly !== undefined &&
        typeof config.localFilesOnly !== "boolean"
    ) {
        throw new Error("embedding.localFilesOnly: expected a boolean");
    }
    if (
        config.revision !== undefined &&
        (typeof config.revision !== "string" || config.revision.trim() === "")
    ) {
        throw new Error("embedding.revision: expected a nonempty string");
    }
    validateModalities(config.modalities);
    // YAML layers may supply different parts of the same embedding section.
    if (!partial) validateCompatibility(config);
}

function validateCompatibility(config: EmbeddingConfig): void {
    if (
        config.runtime !== undefined &&
        config.provider !== undefined &&
        config.provider !== "local"
    ) {
        throw new Error("embedding.runtime: requires embedding.provider local");
    }
    if (
        (config.runtime === "minilm" && config.model === GEMMA_MODEL) ||
        (config.runtime === "embeddinggemma" &&
            config.model !== undefined &&
            MINILM_MODELS.has(config.model))
    ) {
        throw new Error("embedding.runtime: incompatible with embedding.model");
    }
    if (
        config.modalities?.includes("image") &&
        (config.provider !== "local" ||
            (config.runtime !== "embeddinggemma" &&
                !(
                    config.runtime === undefined && config.model === GEMMA_MODEL
                )))
    ) {
        throw new Error(
            "embedding.modalities: image requires embedding.provider local and embedding.runtime embeddinggemma (or its known ONNX embedding.model)",
        );
    }
}

function validateModalities(modalities: EmbeddingConfig["modalities"]): void {
    if (modalities === undefined) return;
    if (
        !Array.isArray(modalities) ||
        modalities.length === 0 ||
        modalities.some((value) => value !== "text" && value !== "image") ||
        new Set(modalities).size !== modalities.length ||
        !modalities.includes("text")
    ) {
        throw new Error(
            "embedding.modalities: expected a nonempty, duplicate-free array of text and optionally image; text is required",
        );
    }
}
