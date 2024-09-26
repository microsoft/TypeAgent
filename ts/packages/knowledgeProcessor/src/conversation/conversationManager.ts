// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { openai } from "aiclient";
import { ObjectFolderSettings, SearchOptions, collections } from "typeagent";
import { SourceTextBlock } from "../text.js";
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
import { logError } from "../diagnostics.js";

export type AddMessageTask = {
    type: "addMessage";
    messageText: string;
    knownEntities?: ConcreteEntity[] | undefined;
    timestamp?: Date | undefined;
    callback?: ((error?: any | undefined) => void) | undefined;
};

export type ConversationManagerTask = AddMessageTask;

/**
 * A conversation manager lets you dynamically:
 *  - add and index messages and entities to a conversation
 *  - search the conversation
 */
export interface ConversationManager {
    readonly conversationName: string;
    readonly conversation: Conversation<string, string, string, string>;
    readonly searchProcessor: ConversationSearchProcessor;
    readonly updateTaskQueue: collections.TaskQueue<ConversationManagerTask>;
    /**
     * Add a message to the conversation
     * @param message
     * @param entities If entities is NOT supplied, then will extract knowledge from message
     * @param timestamp message timestamp
     */
    addMessage(
        messageText: string,
        entities?: ConcreteEntity[] | undefined,
        timestamp?: Date | undefined,
    ): Promise<void>;
    /**
     * Queue the message for adding to the conversation memory in the background
     * @param message
     * @param entities If entities is NOT supplied, then will extract knowledge from message
     * @param timestamp message timestamp
     * @returns true if queued. False if queue is full
     */
    queueAddMessage(
        messageText: string,
        entities?: ConcreteEntity[] | undefined,
        timestamp?: Date | undefined,
    ): boolean;
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
 * @param conversationPath path to a root folder for this conversation.
 * @param existingConversation If using an existing conversation
 */
export async function createConversationManager(
    conversationName: string,
    conversationPath: string,
    createNew: boolean,
    existingConversation?: Conversation | undefined,
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

    const conversation =
        existingConversation === undefined
            ? await createConversation(
                  conversationSettings,
                  path.join(conversationPath, conversationName),
                  folderSettings,
              )
            : existingConversation;
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
    const updateTaskQueue = collections.createTaskQueue(async (task) => {
        await handleUpdateTask(task);
    }, 64);
    await conversation.getMessageIndex();

    return {
        conversationName,
        conversation,
        searchProcessor,
        updateTaskQueue,
        addMessage,
        queueAddMessage,
        search,
        getSearchResponse,
        generateAnswerForSearchResponse,
    };

    function addMessage(
        messageText: string,
        knownEntities?: ConcreteEntity[] | undefined,
        timestamp?: Date | undefined,
    ): Promise<void> {
        return addMessageToConversation(
            conversation,
            knowledgeExtractor,
            topicMerger,
            messageText,
            knownEntities,
            timestamp,
        );
    }

    function queueAddMessage(
        messageText: string,
        knownEntities?: ConcreteEntity[] | undefined,
        timestamp?: Date | undefined,
    ): boolean {
        return updateTaskQueue.push({
            type: "addMessage",
            messageText,
            knownEntities,
            timestamp,
        });
    }

    async function handleUpdateTask(
        task: ConversationManagerTask,
    ): Promise<void> {
        let callback: ((error?: any | undefined) => void) | undefined;
        try {
            switch (task.type) {
                default:
                    break;
                case "addMessage":
                    const addTask: AddMessageTask = task;
                    callback = addTask.callback;
                    await addMessageToConversation(
                        conversation,
                        knowledgeExtractor,
                        topicMerger,
                        addTask.messageText,
                        addTask.knownEntities,
                        addTask.timestamp,
                    );
                    break;
            }
            if (callback) {
                callback();
            }
        } catch (error: any) {
            logError(`${conversationName}:writeMessage\n${error}`);
            if (callback) {
                callback(error);
            }
        }
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
                semanticIndex: true,
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
    timestamp?: Date | undefined,
): Promise<void> {
    const block = await conversation.addMessage(messageText, timestamp);
    await extractKnowledgeAndIndex(
        conversation,
        knowledgeExtractor,
        topicMerger,
        block,
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
): ExtractedKnowledge | undefined {
    if (entities && entities.length > 0) {
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
    const knowledgeIds = await conversation.addKnowledgeForMessage(
        message,
        knowledge,
    );
    if (topicMerger) {
        await topicMerger.next(true, true);
    }
    await conversation.addKnowledgeToIndex(knowledge, knowledgeIds);
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
