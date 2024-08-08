// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection, Result, TypeChatLanguageModel } from "typechat";

/**
 * Translation settings for Chat models
 */
export type CompletionSettings = {
    n?: number;
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: "json_object" };
};

/**
 * A TypeChat language model with greater control on settings
 */
export interface ChatModel extends TypeChatLanguageModel {
    completionSettings: CompletionSettings;
    complete(
        prompt: string | PromptSection[] | ChatMessage[],
    ): Promise<Result<string>>;
}

export interface ChatModelWithStreaming extends ChatModel {
    completeStream(
        prompt: string | PromptSection[] | ChatMessage[],
    ): AsyncIterableIterator<string>;
}

/**
 * A model that returns embeddings for the input K
 */
export interface EmbeddingModel<K> {
    generateEmbedding(input: K): Promise<Result<number[]>>;
    // Future: support batch operations
}

/**
 * A Model that generates embeddings for the given input
 */
export interface TextEmbeddingModel extends EmbeddingModel<string> {}

export type ChatMessage = {
    role: "system" | "user" | "assistant";
    content: ChatMessageContent[];
};

export type ChatMessageContent =
    | string
    | TextMessageContent
    | ImageMessageContent;

export type TextMessageContent = {
    type: "text";
    text: string;
};

export type ImageMessageContent = {
    type: "image_url";
    image_url: ImageUrl;
};

export type ImageUrl = {
    url: string;
    detail?: "auto" | "low" | "high";
};
