// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection, Result, TypeChatLanguageModel } from "typechat";

export type JsonSchema = any;

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

/**
 * A TypeChat language model with greater control on settings
 */
export interface ChatModel extends TypeChatLanguageModel {
    completionSettings: CompletionSettings;
    completionCallback?: ((request: any, response: any) => void) | undefined;
    complete(
        prompt: string | PromptSection[],
        jsonSchema?: JsonSchema,
    ): Promise<Result<string>>;
}

export interface ChatModelWithStreaming extends ChatModel {
    completeStream(
        prompt: string | PromptSection[],
        jsonSchema?: JsonSchema,
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
