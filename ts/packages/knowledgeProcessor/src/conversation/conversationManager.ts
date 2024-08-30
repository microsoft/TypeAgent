// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { openai } from "aiclient";
import { ObjectFolderSettings, SearchOptions, collections } from "typeagent";
import { TextBlock, SourceTextBlock, TextBlockType } from "../text.js";
import {
    Conversation,
    ConversationSettings,
    createConversation,
    createConversationTopicMerger,
    SearchTermsActionResponse,
} from "./conversation.js";
import {
    extractKnowledgeFromBlock,
    KnowledgeExtractor,
    KnowledgeExtractorSettings,
    createKnowledgeExtractor,
    ExtractedKnowledge,
    ExtractedEntity,
} from "./knowledge.js";
import {
    ConversationSearchProcessor,
    createSearchProcessor,
    SearchProcessingOptions,
} from "./searchProcessor.js";
import { createEmbeddingCache } from "../modelCache.js";
import { KnowledgeSearchMode } from "./knowledgeActions.js";
import { SetOp, unionArrays } from "../setOperations.js";
import { ConcreteEntity } from "./knowledgeSchema.js";
import { TermFilter } from "./knowledgeTermSearchSchema.js";
import { TopicMerger } from "./topics.js";
import { open } from "fs";

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
    /**
     * Search the conversation and return an answer
     * @param query
     * @param termFilters
     * @param fuzzySearchOptions
     * @param maxMessages
     * @param progress
     */
    search(
        query: string,
        termFilters?: TermFilter[] | undefined,
        fuzzySearchOptions?: SearchOptions | undefined,
        maxMessages?: number | undefined,
        progress?: ((value: any) => void) | undefined,
    ): Promise<SearchTermsActionResponse | undefined>;
    /**
     * Search without generating an answer
     * @param query
     * @param termFilters
     * @param fuzzySearchOptions
     * @param maxMessages
     * @param progress
     */
    getSearchResponse(
        query: string,
        termFilters?: TermFilter[] | undefined,
        fuzzySearchOptions?: SearchOptions | undefined,
        maxMessages?: number | undefined,
        progress?: ((value: any) => void) | undefined,
    ): Promise<SearchTermsActionResponse | undefined>;
    /**
     * Generate an answer for a response received from getSearchResponse
     * @param query
     * @param searchResponse
     * @param fuzzySearchOptions
     * @param maxMessages
     */
    generateAnswerForSearchResponse(
        query: string,
        searchResponse: SearchTermsActionResponse,
        fuzzySearchOptions?: SearchOptions | undefined,
        maxMessages?: number | undefined,
    ): Promise<SearchTermsActionResponse>;
}

/**
 * Creates a conversation manager with standard defaults.
 * @param conversationOrPath either a path to a root folder for this conversation. Or a conversation object
 */
export async function createConversationManager(
    conversationName: string,
    conversationOrPath: string | Conversation,
    createNew: boolean,
): Promise<ConversationManager> {
    /*const embeddingModel = createEmbeddingCache(
        openai.createEmbeddingModel(),
        64,
    );*/
    const embeddingModel = openai.createEmbeddingModel();
    const knowledgeModel = openai.createChatModel();
    const answerModel = openai.createChatModel();

    const conversationSettings = defaultConversationSettings();
    const folderSettings = defaultFolderSettings();
    const topicMergeWindowSize = 4;
    const maxCharsPerChunk = 2048;

    const conversation =
        typeof conversationOrPath === "string"
            ? await createConversation(
                  conversationSettings,
                  path.join(conversationOrPath, conversationName),
                  folderSettings,
              )
            : conversationOrPath;
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
        getSearchResponse,
        generateAnswerForSearchResponse,
    };

    async function addMessage(
        messageText: string,
        knownEntities?: ConcreteEntity[] | undefined,
        timestamp?: Date,
    ): Promise<any> {
        return addMessageToConversation(
            conversation,
            knowledgeExtractor,
            topicMerger,
            messageText,
            knownEntities,
            timestamp,
        );
    }

    async function search(
        query: string,
        termFilters?: TermFilter[] | undefined,
        fuzzySearchOptions?: SearchOptions | undefined,
        maxMessages?: number | undefined,
        progress?: ((value: any) => void) | undefined,
    ): Promise<SearchTermsActionResponse | undefined> {
        return searchProcessor.searchTerms(
            query,
            termFilters,
            createSearchProcessingSettings(
                fuzzySearchOptions,
                maxMessages,
                progress,
            ),
        );
    }

    async function getSearchResponse(
        query: string,
        termFilters?: TermFilter[] | undefined,
        fuzzySearchOptions?: SearchOptions | undefined,
        maxMessages?: number | undefined,
        progress?: ((value: any) => void) | undefined,
    ): Promise<SearchTermsActionResponse | undefined> {
        const options = createSearchProcessingSettings(
            fuzzySearchOptions,
            maxMessages,
            progress,
        );
        options.skipAnswerGeneration = true;
        return searchProcessor.searchTerms(query, termFilters, options);
    }

    async function generateAnswerForSearchResponse(
        query: string,
        searchResponse: SearchTermsActionResponse,
        fuzzySearchOptions?: SearchOptions | undefined,
        maxMessages?: number | undefined,
    ): Promise<SearchTermsActionResponse> {
        const options = createSearchProcessingSettings(
            fuzzySearchOptions,
            maxMessages,
        );
        return searchProcessor.generateAnswer(query, searchResponse, options);
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

/**
 * Add a new message to the given conversation, extracting knowledge using the given knowledge extractor.
 * @param conversation
 * @param knowledgeExtractor
 * @param topicMerger (Optional)
 * @param messageText
 * @param knownEntities
 * @param timestamp
 */
export async function addMessageToConversation(
    conversation: Conversation,
    knowledgeExtractor: KnowledgeExtractor,
    topicMerger: TopicMerger | undefined,
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
        conversation,
        knowledgeExtractor,
        topicMerger,
        { ...message, blockId, timestamp },
        knownEntities,
    );
}

async function extractKnowledgeAndIndex(
    conversation: Conversation,
    knowledgeExtractor: KnowledgeExtractor,
    topicMerger: TopicMerger | undefined,
    message: SourceTextBlock,
    knownEntities?: ConcreteEntity[] | undefined,
) {
    const messageIndex = await conversation.getMessageIndex();
    await messageIndex.put(message.value, message.blockId);
    let extractedKnowledge: ExtractedKnowledge | undefined;
    let knownKnowledge: ExtractedKnowledge | undefined;
    if (knownEntities) {
        knownKnowledge = entitiesToKnowledge(message.blockId, knownEntities);
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
            const merged = new Map<string, ExtractedEntity>();
            mergeEntities(extractedKnowledge.entities, merged);
            mergeEntities(knownKnowledge.entities, merged);
            extractedKnowledge.entities = [...merged.values()];
        }
    } else {
        extractedKnowledge = knownKnowledge;
    }
    if (extractedKnowledge) {
        await indexKnowledge(
            conversation,
            topicMerger,
            message,
            extractedKnowledge,
        );
    }
}

function entitiesToKnowledge(
    sourceId: any,
    entities: ConcreteEntity[],
    timestamp?: Date,
): ExtractedKnowledge | undefined {
    if (entities && entities.length > 0) {
        timestamp ??= new Date();
        const sourceIds = [sourceId];
        const knowledge: ExtractedKnowledge = {
            entities: entities.map((value) => {
                return { value, sourceIds };
            }),
        };
        return knowledge;
    }
    return undefined;
}

async function indexKnowledge(
    conversation: Conversation,
    topicMerger: TopicMerger | undefined,
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

function mergeEntities(
    entities: ExtractedEntity[] | undefined,
    merged: Map<string, ExtractedEntity>,
): void {
    if (entities) {
        for (const ee of entities) {
            const entity = ee.value;
            entity.name = entity.name.toLowerCase();
            collections.lowerAndSort(entity.type);
            const existing = merged.get(entity.name);
            if (existing) {
                existing.value.type = unionArrays(
                    existing.value.type,
                    entity.type,
                )!;
            } else {
                merged.set(entity.name, ee);
            }
        }
    }
}
