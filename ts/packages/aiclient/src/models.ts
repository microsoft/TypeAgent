// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection, Result, TypeChatLanguageModel } from "typechat";
import { CompletionUsageStats } from "./openai.js";

/**
 * Translation settings for Chat models
 * https://platform.openai.com/docs/api-reference/chat/create
 */
export type CompletionSettings = {
    n?: number;
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: "json_object" };
    // Use fixed seed parameter to improve determinism
    //https://cookbook.openai.com/examples/reproducible_outputs_with_the_seed_parameter
    seed?: number;
    top_p?: number;

    // GPT-5 specific settings
    max_completion_tokens?: number;
    reasoning_effort?: "minimal" | "low" | "medium" | "high";
    verbosity?: "low" | "medium" | "high";
};

export type StructuredOutputJsonSchema = {
    name: string;
    description?: string;
    strict?: true;
    schema: any; // TODO: JsonSchemaType
};

export type FunctionCallingJsonSchema = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: any; // TODO: JsonSchemaType
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

/**
 * A TypeChat language model with greater control on settings
 */
export interface ChatModel extends TypeChatLanguageModel {
    completionSettings: CompletionSettings;
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
        durationInSeconds: number,
        width: number,
        height: number,
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
    n_variants: number;
    n_seconds: number;
    height: number;
    width: number;
    inpaint_items?: ImageInPaintItem[]; // TODO: add support for videos
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
    }
    contents?: string; // base64 encoded image contents
    mime_type?: string
}

