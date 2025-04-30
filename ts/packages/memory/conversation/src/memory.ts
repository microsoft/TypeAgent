// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "aiclient";
import * as kp from "knowpro";
import * as kpLib from "knowledge-processor";
import { TypeChatLanguageModel } from "typechat";
import { createEmbeddingModelWithCache } from "./common.js";

export type FileSaveSettings = {
    dirPath: string;
    baseFileName: string;
};

export interface MemorySettings {
    languageModel: TypeChatLanguageModel;
    embeddingModel: kpLib.TextEmbeddingModelWithCache;
    embeddingSize: number;
    conversationSettings: kp.ConversationSettings;
    queryTranslator?: kp.SearchQueryTranslator | undefined;
    fileSaveSettings?: FileSaveSettings | undefined;
}

export function createMemorySettings(
    getCache: () => kpLib.TextEmbeddingCache | undefined,
): MemorySettings {
    const languageModel = openai.createChatModelDefault("conversation-memory");
    /**
     * Our index already has embeddings for every term in the podcast
     * Create a caching embedding model that can just leverage those embeddings
     * @returns embedding model, size of embedding
     */
    const [embeddingModel, embeddingSize] = createEmbeddingModelWithCache(
        64,
        getCache,
    );
    const conversationSettings = kp.createConversationSettings(
        embeddingModel,
        embeddingSize,
    );
    conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
        kp.createKnowledgeExtractor(languageModel);
    const memorySettings: MemorySettings = {
        embeddingModel,
        embeddingSize,
        conversationSettings,
        languageModel,
    };
    return memorySettings;
}

export type IndexingState = {
    lastMessageOrdinal: kp.MessageOrdinal;
    lastSemanticRefOrdinal: kp.SemanticRefOrdinal;
};
