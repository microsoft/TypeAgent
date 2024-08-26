// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { openai } from "aiclient";
import { ObjectFolderSettings } from "typeagent";
import { TextBlock, SourceTextBlock } from "../text.js";
import {
    Conversation,
    ConversationSettings,
    createConversation,
    createConversationTopicMerger,
    SearchTermsActionResponse,
} from "./conversation.js";
import {
    extractKnowledgeFromBlock,
    KnowledgeExtractorSettings,
    createKnowledgeExtractor,
} from "./knowledge.js";
import {
    ConversationSearchProcessor,
    createSearchProcessor,
    SearchProcessingOptions,
} from "./searchProcessor.js";
import { createEmbeddingCache } from "../modelCache.js";
import { KnowledgeSearchMode } from "./knowledgeActions.js";

export interface ConversationManager {
    readonly conversationName: string;
    readonly conversation: Conversation<string, string, string, string>;
    readonly searchProcessor: ConversationSearchProcessor;
    addMessage(message: TextBlock, timestamp?: Date): Promise<any>;
    addIndex(message: TextBlock, id: any): Promise<void>;
    search(
        query: string,
        options: SearchProcessingOptions,
    ): Promise<SearchTermsActionResponse | undefined>;
}

/**
 * Creates a conversation manager with standard defaults.
 */
export async function createConversationManager(
    conversationName: string,
    rootPath: string,
    createNew: boolean,
): Promise<ConversationManager> {
    const embeddingModel = createEmbeddingCache(
        openai.createEmbeddingModel(),
        64,
    );
    const knowledgeModel = openai.createChatModel();
    const answerModel = openai.createChatModel();

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

    const searchProcessor = createSearchProcessor(
        conversation,
        knowledgeModel,
        answerModel,
        KnowledgeSearchMode.WithActions,
    );

    const messageIndex = await conversation.getMessageIndex();

    return {
        conversationName,
        conversation,
        searchProcessor,
        addMessage,
        addIndex,
        search,
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

    async function search(
        query: string,
        options: SearchProcessingOptions,
    ): Promise<SearchTermsActionResponse | undefined> {
        return searchProcessor.searchTerms(query, options);
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
}
