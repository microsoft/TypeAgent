// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { openai } from "aiclient";
import { ObjectFolderSettings, SearchOptions } from "typeagent";
import { TextBlock, SourceTextBlock, TextBlockType } from "../text.js";
import {
    Conversation,
    ConversationSettings,
    createConversation,
    createConversationTopicMerger,
    SearchTermsActionResponse,
    ExtractedKnowledgeIds,
} from "./conversation.js";
import {
    extractKnowledgeFromBlock,
    KnowledgeExtractorSettings,
    createKnowledgeExtractor,
    ExtractedKnowledge,
} from "./knowledge.js";
import {
    ConversationSearchProcessor,
    createSearchProcessor,
    SearchProcessingOptions,
} from "./searchProcessor.js";
import { createEmbeddingCache } from "../modelCache.js";
import { KnowledgeSearchMode } from "./knowledgeActions.js";
import { SetOp } from "../setOperations.js";
import { ConcreteEntity } from "./knowledgeSchema.js";
import { mergeEntities } from "./entities.js";

/**
 * A conversation manager lets you dynamically:
 *  - add and index messages and entities to a conversation
 *  - search the conversation
 */
export interface ConversationManager {
    readonly conversationName: string;
    readonly conversation: Conversation<string, string, string, string>;
    readonly searchProcessor: ConversationSearchProcessor;
    /**
     *
     * @param message
     * @param entities If entities is NOT supplied, then will extract knowledge from message
     * @param timestamp
     */
    addMessage(
        messageText: string,
        entities?: ConcreteEntity[] | undefined,
        timestamp?: Date,
    ): Promise<any>;
    search(
        query: string,
        fuzzySearchOptions?: SearchOptions | undefined,
        maxMessages?: number | undefined,
        progress?: ((value: any) => void) | undefined,
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
    type MessageId = string;

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
        search,
    };

    async function addMessage(
        messageText: string,
        knownEntities?: ConcreteEntity[] | undefined,
        timestamp?: Date,
    ): Promise<any> {
        const message: TextBlock = {
            value: messageText,
            type: TextBlockType.Paragraph,
        };
        timestamp ??= new Date();
        const blockId = await conversation.messages.put(message, timestamp);
        await extractKnowledgeAndIndex(
            { ...message, blockId, timestamp },
            knownEntities,
        );
    }

    async function extractKnowledgeAndIndex(
        message: SourceTextBlock,
        knownEntities?: ConcreteEntity[] | undefined,
    ) {
        await messageIndex.put(message.value, message.blockId);
        let extractedKnowledge: ExtractedKnowledge | undefined;
        let knownKnowledge: ExtractedKnowledge | undefined;
        if (knownEntities) {
            knownKnowledge = entitiesToKnowledge(
                message.blockId,
                knownEntities,
            );
        }
        const knowledgeResult = await extractKnowledgeFromBlock(
            knowledgeExtractor,
            message,
        );
        if (knowledgeResult) {
            extractedKnowledge = knowledgeResult[1];
        }
        if (extractedKnowledge) {
            if (knownKnowledge) {
                // TODO: merge entities instead of replace
                extractedKnowledge.entities = knownKnowledge.entities;
            }
        } else {
            extractedKnowledge = knownKnowledge;
        }
        if (extractedKnowledge) {
            await indexKnowledge(message, extractedKnowledge);
        }
    }

    async function indexKnowledge(
        message: SourceTextBlock,
        knowledge: ExtractedKnowledge,
    ): Promise<void> {
        // Add next message... this updates the "sequence"
        const knowledgeIds = await conversation.putNext(message, knowledge);
        if (topicMerger) {
            const mergedTopic = await topicMerger.next(true, true);
        }
        await conversation.putIndex(knowledge, knowledgeIds);
    }

    async function search(
        query: string,
        fuzzySearchOptions?: SearchOptions | undefined,
        maxMessages?: number | undefined,
        progress?: ((value: any) => void) | undefined,
    ): Promise<SearchTermsActionResponse | undefined> {
        return searchProcessor.searchTerms(
            query,
            createSearchProcessingSettings(
                fuzzySearchOptions,
                maxMessages,
                progress,
            ),
        );
    }

    function entitiesToKnowledge(
        sourceId: MessageId,
        entities: ConcreteEntity[],
        timestamp?: Date,
    ): ExtractedKnowledge | undefined {
        if (entities && entities.length > 0) {
            timestamp ??= new Date();
            const sourceIds: MessageId[] = [sourceId];
            const knowledge: ExtractedKnowledge<MessageId> = {
                entities: entities.map((value) => {
                    return { value, sourceIds };
                }),
            };
            return knowledge;
        }
        return undefined;
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

    function createSearchProcessingSettings(
        fuzzySearchOptions?: SearchOptions,
        maxMessages?: number,
        progress?: (value: any) => void,
    ): SearchProcessingOptions {
        fuzzySearchOptions ??= {
            maxMatches: 2,
        };
        fuzzySearchOptions.minScore ??= 0.8;
        maxMessages ??= 10;
        return {
            maxMatches: fuzzySearchOptions.maxMatches,
            minScore: fuzzySearchOptions.minScore,
            maxMessages,
            combinationSetOp: SetOp.IntersectUnion,
            progress,
            fallbackSearch: { maxMatches: maxMessages },
        };
    }
}
