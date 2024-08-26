// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { ChatModel, TextEmbeddingModel, openai } from "aiclient";
import { ObjectFolderSettings } from "typeagent";
import { TextBlock, SourceTextBlock } from "../text.js";
import {
    Conversation,
    ConversationSettings,
    createConversation,
    createConversationTopicMerger,
} from "./conversation.js";
import {
    KnowledgeExtractor,
    extractKnowledgeFromBlock,
    KnowledgeExtractorSettings,
    createKnowledgeExtractor,
} from "./knowledge.js";

import { createEmbeddingCache } from "../modelCache.js";

export interface ConversationManager {
    readonly conversationName: string;
    readonly conversation: Conversation<string, string, string, string>;
    addMessage(message: TextBlock, timestamp?: Date): Promise<any>;
    addIndex(message: TextBlock, id: any): Promise<void>;
    //search(query: string): Promise<SearchTermsActionResponse | undefined>;
}

/**
 * Creates a conversation manager with standard defaults.
 */
export async function createConversationManager(
    conversationName: string,
    rootPath: string,
    createNew: boolean,
): Promise<ConversationManager> {
    const embeddingModel = defaultEmbeddingModel();
    const knowledgeModel = defaultKnowledgeModel();

    const conversationSettings = defaultConversationSettings();
    const folderSettings = defaultFolderSettings();
    const topicMergeWindowSize = 4;
    const maxCharsPerChunk = 2048;

    const conversation = await createConversation(
        conversationSettings,
        path.join(rootPath, conversationName),
        folderSettings,
    );
    if (createNew) {
        await conversation.clear(true);
    }
    const knowledgeExtractorSettings = defaultKnowledgeExtractorSettings();
    const knowledgeExtractor = createKnowledgeExtractor(
        knowledgeModel,
        knowledgeExtractorSettings,
    );

    const topicMerger = await createConversationTopicMerger(
        knowledgeModel,
        conversation,
        1, // Merge base topic level 1 into a higher level
        topicMergeWindowSize,
    );

    const messageIndex = await conversation.getMessageIndex();

    return {
        conversationName,
        conversation,
        addMessage,
        addIndex,
    };

    async function addMessage(
        message: TextBlock,
        timestamp?: Date,
    ): Promise<any> {
        timestamp ??= new Date();
        const blockId = await conversation.messages.put(message, timestamp);
        await addIndex({ ...message, blockId, timestamp });
    }

    async function addIndex(message: SourceTextBlock) {
        await messageIndex.put(message.value, message.blockId);
        const knowledgeResult = await extractKnowledgeFromBlock(
            knowledgeExtractor,
            message,
        );
        if (knowledgeResult) {
            if (knowledgeResult) {
                const [_, knowledge] = knowledgeResult;
                // Add next message... this updates the "sequence"
                const knowledgeIds = await conversation.putNext(
                    message,
                    knowledge,
                );
                if (topicMerger) {
                    const mergedTopic = await topicMerger.next(true, true);
                }
                await conversation.putIndex(knowledge, knowledgeIds);
            }
        }
    }

    function defaultConversationSettings(): ConversationSettings {
        return {
            indexSettings: {
                caseSensitive: false,
                concurrency: 2,
                embeddingModel,
            },
        };
    }

    function defaultKnowledgeExtractorSettings(): KnowledgeExtractorSettings {
        return {
            windowSize: 8,
            maxContextLength: maxCharsPerChunk,
            includeSuggestedTopics: false,
            includeActions: true,
        };
    }

    function defaultFolderSettings(): ObjectFolderSettings {
        return {
            cacheNames: true,
            useWeakRefs: true,
        };
    }

    function defaultKnowledgeModel(): ChatModel {
        return openai.createChatModel();
    }

    function defaultEmbeddingModel(): TextEmbeddingModel {
        const model = openai.createEmbeddingModel();
        return createEmbeddingCache(model, 64);
    }
}

/*
import path from "path";
import { ChatModel, TextEmbeddingModel, openai } from "aiclient";
import { ObjectFolderSettings } from "typeagent";
import {
    Conversation,
    ConversationSettings,
    createConversation,
    createConversationManager,
    createConversationTopicMerger,
} from "./conversation.js";
import { createSearchProcessor } from "./searchProcessor.js";
import {
    KnowledgeExtractorSettings,
    createKnowledgeExtractor,
} from "./knowledge.js";
import { KnowledgeSearchMode } from "./knowledgeActions.js";
import { createEmbeddingCache } from "../modelCache.js";

export async function createConversationMemory(
    conversationName: string,
    rootPath: string,
) {
    const knowledgeModel = defaultKnowledgeModel();
    const answerModel = defaultAnswerModel();
    const embeddingModel = defaultEmbeddingModel();

    const maxCharsPerChunk = 2048;
    const topicMergeWindowSize = 4;
    const conversationSettings = defaultConversationSettings();
    const knowledgeExtractorSettings = defaultKnowledgeExtractorSettings();
    const folderSettings = defaultFolderSettings();

    const knowledgeExtractor = createKnowledgeExtractor(
        knowledgeModel,
        knowledgeExtractorSettings,
    );
    const conversation = await createConversation(
        conversationSettings,
        path.join(rootPath, conversationName),
        folderSettings,
    );
    const topicMerger = await createConversationTopicMerger(
        knowledgeModel,
        conversation,
        1, // Merge base topic level 1 into a higher level
        topicMergeWindowSize,
    );
    const memory = await createConversationManager(
        conversationName,
        conversation,
        knowledgeExtractor,
        topicMerger,
    );
    const searchProcessor = createSearchProcessor(
        conversation,
        knowledgeModel,
        answerModel,
        KnowledgeSearchMode.WithActions,
    );
    return [searchMemory, searchProcessor];

    function defaultConversationSettings(): ConversationSettings {
        return {
            indexSettings: {
                caseSensitive: false,
                concurrency: 2,
                embeddingModel,
            },
        };
    }

    function defaultKnowledgeExtractorSettings(): KnowledgeExtractorSettings {
        return {
            windowSize: 8,
            maxContextLength: maxCharsPerChunk,
            includeSuggestedTopics: false,
            includeActions: true,
        };
    }

    function defaultFolderSettings(): ObjectFolderSettings {
        return {
            cacheNames: true,
            useWeakRefs: true,
        };
    }

    function defaultEmbeddingModel(): TextEmbeddingModel {
        const model = openai.createEmbeddingModel();
        return createEmbeddingCache(model, 64);
    }

    function defaultKnowledgeModel(): ChatModel {
        return openai.createChatModel();
    }

    function defaultAnswerModel(): ChatModel {
        return openai.createChatModel();
    }
}
*/
