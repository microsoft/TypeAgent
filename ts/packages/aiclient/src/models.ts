// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection, Result, TypeChatLanguageModel } from "typechat";
import { CompletionUsageStats } from "./apiTypes.js";
import {
    EmbeddingIdentity,
    EmbeddingPart,
    EmbeddingRole,
} from "./embeddingIdentity.js";
import type { RequestConstraintReceipt } from "./requestConstraints.js";
import { otel } from "@typeagent/telemetry";

export function isRetryableModelFailure(value: unknown): boolean {
    return otel.readTelemetryErrorClassification(value)?.retryable === true;
}

/**
 * Translation settings for Chat models
 * https://platform.openai.com/docs/api-reference/chat/create
 */
export type CompletionSettings = {
    n?: number;
    temperature?: number;
    response_format?: { type: "json_object" };
    // Use fixed seed parameter to improve determinism
    //https://cookbook.openai.com/examples/reproducible_outputs_with_the_seed_parameter
    seed?: number;
    top_p?: number;

    reasoning_effort?:
        | "none"
        | "minimal"
        | "low"
        | "medium"
        | "high"
        | "xhigh"
        | "max";
    verbosity?: "low" | "medium" | "high";
};

export function rejectCompletionLimits(settings?: CompletionSettings): void {
    for (const key of [
        "max_tokens",
        "max_completion_tokens",
        "max_output_tokens",
    ]) {
        if (settings && key in settings)
            throw new Error(
                `${key} is no longer supported in completion settings; use prompt guidance for final-answer length, excluding reasoning`,
            );
    }
}

// A JSON Schema object passed opaquely to the OpenAI API.
export type JsonSchemaType = Record<string, unknown>;

export type StructuredOutputJsonSchema = {
    name: string;
    description?: string;
    strict?: true;
    schema: JsonSchemaType;
};

export type FunctionCallingJsonSchema = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: JsonSchemaType;
        strict?: true;
    };
};

export type CompletionJsonSchema =
    | StructuredOutputJsonSchema
    | FunctionCallingJsonSchema[];

export type FunctionCallingResult = {
    function: string;
    arguments: any;
};

export type CompleteUsageStatsCallback = (usage: CompletionUsageStats) => void;

/** Offline inspection of the non-streaming wire request. Contains prompt/schema; do not log it. */
export interface ChatRequestInspection {
    serializedRequest: string;
    estimatedInputTokens: number;
    tokenizer: "o200k_base";
    constraints: RequestConstraintReceipt;
}

/**
 * A TypeChat language model with greater control on settings
 */
export interface ChatModel extends TypeChatLanguageModel {
    completionSettings: CompletionSettings;
    /** Available on supported providers; throws when configured request constraints fail. */
    inspectRequest?(
        prompt: string | PromptSection[],
        jsonSchema?: CompletionJsonSchema,
    ): ChatRequestInspection;
    completionCallback?: ((request: any, response: any) => void) | undefined;
    /**
     * Complete the prompt
     * @param prompt prompt or prompt sections to complete
     * @param jsonSchema optional json schema. If the json schema is an object, then it uses structured output. If the json schema is an array, then it is function calling.
     */
    complete(
        prompt: string | PromptSection[],
        usageCallback?: CompleteUsageStatsCallback,
        jsonSchema?: CompletionJsonSchema,
        promptLogFn?: (msg: any) => void,
        signal?: AbortSignal,
    ): Promise<Result<string>>;
}

export interface ChatModelWithStreaming extends ChatModel {
    /**
     * Complete the prompt with streaming
     * @param prompt prompt or prompt sections to complete
     * @param jsonSchema optional json schema. If the json schema is an object, then it uses structured output. If the json schema is an array, then it is function calling.
     */
    completeStream(
        prompt: string | PromptSection[],
        usageCallback?: CompleteUsageStatsCallback,
        jsonSchema?: CompletionJsonSchema,
        promptLogFn?: (msg: any) => void,
        signal?: AbortSignal,
    ): Promise<Result<AsyncIterableIterator<string>>>;
}

/**
 * A model that returns embeddings for the input K
 */
export interface EmbeddingModel<K> {
    /**
     * Generate an embedding for the given input
     * @param input
     */
    generateEmbedding(input: K): Promise<Result<number[]>>;
}

/**
 * A Model that generates embeddings for the given input
 */
export interface TextEmbeddingModel extends EmbeddingModel<string> {
    readonly embeddingIdentity?: EmbeddingIdentity | undefined;
    readonly embeddingCapabilities?: EmbeddingCapabilities | undefined;
    forRole?(role: EmbeddingRole): TextEmbeddingModel;
    resolve?(): Promise<TextEmbeddingModel>;
    dispose?(): Promise<void>;
    generateMediaEmbeddingBatch?(
        samples: EmbeddingPart[][],
    ): Promise<Result<number[][]>>;
    /**
     * Optional: batching support
     * Not all models/apis support batching
     * @param inputs
     */
    generateEmbeddingBatch?(inputs: string[]): Promise<Result<number[][]>>;
    /**
     * Maximum batch size
     * If no batching, maxBatchSize should be 1
     */
    readonly maxBatchSize: number;
}

export interface EmbeddingCapabilities {
    readonly inputModalities: readonly ("text" | "image")[];
    readonly mixedInputs: boolean;
}

export async function resolveEmbeddingModel(
    model: TextEmbeddingModel,
): Promise<TextEmbeddingModel> {
    return model.resolve ? model.resolve() : model;
}

export function supportsImageEmbeddings(model: TextEmbeddingModel): boolean {
    return (
        model.embeddingCapabilities?.inputModalities.includes("image") ===
            true && typeof model.generateMediaEmbeddingBatch === "function"
    );
}

export function embeddingModelForRole(
    model: TextEmbeddingModel,
    role: EmbeddingRole,
): TextEmbeddingModel {
    const selected = model.forRole?.(role) ?? model;
    if (
        selected.embeddingIdentity &&
        selected.embeddingIdentity.task !== role
    ) {
        throw new Error(`Embedding model does not support the ${role} role`);
    }
    return selected;
}

/**
 * A model that generates images given the image prompt/description
 */
export interface ImageModel {
    generateImage(
        prompt: string,
        imageCount: number,
        width: number,
        height: number,
    ): Promise<Result<ImageGeneration>>;

    /**
     * Edit an existing image with a natural-language prompt. The
     * source image is supplied as raw bytes (typically the contents
     * of a PNG / JPG file the user attached). Implementations should
     * route this to the provider's image-edit endpoint
     * (e.g. Azure / OpenAI `/images/edits`).
     */
    editImage?(
        sourceImage: Buffer,
        sourceMimeType: string,
        sourceFileName: string,
        prompt: string,
        imageCount: number,
        width: number,
        height: number,
    ): Promise<Result<ImageGeneration>>;
}

export type ImageGeneration = {
    images: GeneratedImage[];
};

export type GeneratedImage = {
    revised_prompt: string;
    image_url: string;
};

export type EmbeddingModelMetadata = {
    modelName?: string | undefined;
    embeddingSize: number;
};

export function modelMetadata_ada002(): EmbeddingModelMetadata {
    return {
        modelName: "ada-002",
        embeddingSize: 1536,
    };
}

export interface VideoModel {
    generateVideo(
        prompt: string,
        numVariants: number,
        durationInSeconds: 4 | 8 | 12,
        width: number,
        height: number,
        inpaintItems?: ImageInPaintItem[],
    ): Promise<Result<VideoGenerationJob>>;
}

export type VideoGenerationJob = {
    object?: string;
    id?: string;
    status?: string;
    created_at?: number;
    finished_at?: number;
    exipres_at?: number;
    generations?: Array<any>;
    prompt: string;
    model: string;
    n_variants?: number;
    n_seconds?: number;
    height?: number;
    width?: number;
    size?: "720x1280" | "1280x720" | "1024x1792" | "1792x1024";
    seconds?: 4 | 8 | 12;
    input_reference?: ImageInPaintItem[]; // TODO: add support for videos
    failure_reason?: string;
    endpoint?: URL;
    headers?: Record<string, string>;
};

export type GeneratedVideo = {
    revised_prompt: string;
    video_url: string;
};

export type ImageInPaintItem = {
    frame_index: number;
    type: "image";
    file_name: string;
    crop_bounds: {
        left_fraction: number;
        top_fraction: number;
        right_fraction: number;
        bottom_fraction: number;
    };
    contents?: string | undefined; // base64 encoded image contents
    mime_type?: string;
};
