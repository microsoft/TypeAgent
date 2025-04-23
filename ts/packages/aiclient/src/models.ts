// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection, Result, TypeChatLanguageModel } from "typechat";
import { CompletionUsageStats } from "./openai.js";

/**
 * Translation settings for Chat models
 */
export type CompletionSettings = {
    n?: number;
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: "json_object" };

    // Use fixed seed parameter to improve determinism
    //https://cookbook.openai.com/examples/reproducible_outputs_with_the_seed_parameter
    seed?: number;
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
