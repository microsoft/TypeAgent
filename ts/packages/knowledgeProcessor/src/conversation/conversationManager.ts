// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { openai } from "aiclient";
import {
    ObjectFolderSettings,
    SearchOptions,
    asyncArray,
    collections,
} from "typeagent";
import { SourceTextBlock, TextBlock } from "../text.js";
import {
    Conversation,
    ConversationSettings,
    ConversationTopicMerger,
    createConversation,
    createConversationTopicMerger,
    SearchTermsActionResponse,
} from "./conversation.js";
import {
    extractKnowledgeFromBlock,
    KnowledgeExtractor,
    createKnowledgeExtractor,
    ExtractedKnowledge,
    ExtractedEntity,
    createKnowledgeExtractorSettings,
    createExtractedKnowledge,
} from "./knowledge.js";
import {
    ConversationSearchProcessor,
    createSearchProcessor,
    SearchProcessingOptions,
} from "./searchProcessor.js";
import { createEmbeddingCache } from "../modelCache.js";
import { KnowledgeSearchMode } from "./knowledgeActions.js";
import { unionArrays } from "../setOperations.js";
import { ConcreteEntity, KnowledgeResponse } from "./knowledgeSchema.js";
import { TermFilter } from "./knowledgeTermSearchSchema.js";
import { TopicMerger } from "./topics.js";
import { logError } from "../diagnostics.js";
import { mergeEntityFacet } from "./entities.js";
import assert from "assert";

export type ConversationMessage = {
    /**
     * Text of the message
     */
    text: string | TextBlock;
    /**
     * Any pre-extracted knowledge associated with this message
     */
    knowledge?: ConcreteEntity[] | KnowledgeResponse | undefined;
    /**
     * Message timestamp
     */
    timestamp?: Date | undefined;
};

export type AddMessageTask = {
    type: "addMessage";
    message: ConversationMessage;
    callback?: ((error?: any | undefined) => void) | undefined;
};

export type ConversationManagerTask = AddMessageTask;

/**
 * A conversation manager lets you dynamically:
 *  - add and index messages and entities to a conversation
 *  - search the conversation
 */
export interface ConversationManager<TMessageId = any, TTopicId = any> {
    readonly conversationName: string;
    readonly conversation: Conversation<TMessageId, TTopicId, string, string>;
    readonly topicMerger: TopicMerger<TTopicId>;
    readonly knowledgeExtractor: KnowledgeExtractor;
    readonly searchProcessor: ConversationSearchProcessor;
    readonly updateTaskQueue: collections.TaskQueue<ConversationManagerTask>;
    /**
     * Add a message to the conversation
     * @param message
     * @param knowledge Any pre-extracted knowledge. Merged with knowledge automatically extracted from message.
     * @param timestamp message timestamp
     */
    addMessage(
        message: string | TextBlock,
        knowledge?: ConcreteEntity[] | KnowledgeResponse | undefined,
        timestamp?: Date | undefined,
    ): Promise<void>;
    /**
     * Add a batch message to the conversation
     * @param messages Conversation messages to add
     */
    addMessageBatch(messages: ConversationMessage[]): Promise<void>;
    /**
     * Queue the message for adding to the conversation memory in the background
     * @param message
     * @param knowledge Any pre-extracted knowledge. Merged with knowledge automatically extracted from message.
     * @param timestamp message timestamp
     * @returns true if queued. False if queue is full
     */
    queueAddMessage(
        message: string | TextBlock,
        knowledge?: ConcreteEntity[] | KnowledgeResponse | undefined,
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
    /**
     * Clear everything.
     * Note: While this is happening, it is up to you to ensure you are not searching or reading the conversation
     */
    clear(removeMessages: boolean): Promise<void>;
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
): Promise<ConversationManager<string, string>> {
    const conversationSettings = createConversationSettings();
    const knowledgeModel = openai.createChatModel();
    const answerModel = openai.createChatModel();

    const folderSettings = defaultFolderSettings();

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
    const knowledgeExtractor = createKnowledgeExtractor(
        knowledgeModel,
        createKnowledgeExtractorSettings(),
    );

    let topicMerger = await createMerger();

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
        get topicMerger() {
            return topicMerger!;
        },
        knowledgeExtractor,
        searchProcessor,
        updateTaskQueue,
        addMessage,
        addMessageBatch,
        queueAddMessage,
        search,
        getSearchResponse,
        generateAnswerForSearchResponse,
        clear,
    };

    function addMessage(
        message: string | TextBlock,
        knowledge?: ConcreteEntity[] | KnowledgeResponse | undefined,
        timestamp?: Date | undefined,
    ): Promise<void> {
        return addMessageToConversation(
            conversation,
            knowledgeExtractor,
            topicMerger,
            message,
            knowledge,
            timestamp,
        );
    }

    function addMessageBatch(messages: ConversationMessage[]): Promise<void> {
        return addMessageBatchToConversation(
            conversation,
            knowledgeExtractor,
            topicMerger,
            messages,
        );
    }

    function queueAddMessage(
        message: string | TextBlock,
        knowledge?: ConcreteEntity[] | KnowledgeResponse | undefined,
        timestamp?: Date | undefined,
    ): boolean {
        return updateTaskQueue.push({
            type: "addMessage",
            message: {
                text: message,
                knowledge,
                timestamp,
            },
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
                        addTask.message.text,
                        addTask.message.knowledge,
                        addTask.message.timestamp,
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

    async function clear(removeMessages: boolean): Promise<void> {
        await conversation.clear(removeMessages);
        await topicMerger!.reset();
    }

    async function createMerger(): Promise<ConversationTopicMerger> {
        return await createConversationTopicMerger(
            knowledgeModel,
            conversation,
            1, // Merge base topic level 1 into a higher level
        );
    }

    function createConversationSettings(): ConversationSettings {
        if (existingConversation) {
            return existingConversation.settings;
        }
        const embeddingModel = createEmbeddingCache(
            openai.createEmbeddingModel(),
            64,
        );
        return {
            indexSettings: {
                caseSensitive: false,
                concurrency: 2,
                embeddingModel,
                semanticIndex: true,
            },
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
 * @param message message text or message text block to add
 * @param knownKnowledge pre-extracted/known knowledge associated with this message
 * @param timestamp
 */
export async function addMessageToConversation(
    conversation: Conversation,
    knowledgeExtractor: KnowledgeExtractor,
    topicMerger: TopicMerger | undefined,
    message: string | TextBlock,
    knownKnowledge?: ConcreteEntity[] | KnowledgeResponse | undefined,
    timestamp?: Date | undefined,
): Promise<void> {
    const messageBlock = await conversation.addMessage(message, timestamp);

    const messageIndex = await conversation.getMessageIndex();
    await messageIndex.put(messageBlock.value, messageBlock.blockId);

    let extractedKnowledge = await extractKnowledge(
        knowledgeExtractor,
        messageBlock,
        knownKnowledge,
    );
    if (extractedKnowledge) {
        await indexKnowledge(
            conversation,
            topicMerger,
            messageBlock,
            extractedKnowledge,
        );
    }
}

export async function addMessageBatchToConversation(
    conversation: Conversation,
    knowledgeExtractor: KnowledgeExtractor,
    topicMerger: TopicMerger | undefined,
    messages: ConversationMessage[],
): Promise<void> {
    const messageBlocks = await asyncArray.mapAsync(messages, 1, (m) =>
        conversation.addMessage(m.text, m.timestamp),
    );
    assert.ok(messages.length === messageBlocks.length);

    const messageIndex = await conversation.getMessageIndex();
    await messageIndex.putMultiple(
        messageBlocks.map((m) => {
            return [m.value, m.blockId];
        }),
    );
    //
    // Knowledge extraction can be done in parallel
    // But we update the knowledge index sequentially
    //
    const concurrency = conversation.settings.indexSettings.concurrency;
    const extractedKnowledge = await asyncArray.mapAsync(
        messageBlocks,
        concurrency,
        (message, index) => {
            return extractKnowledge(
                knowledgeExtractor,
                message,
                messages[index].knowledge,
            );
        },
    );

    assert.ok(messageBlocks.length === extractedKnowledge.length);
    for (let i = 0; i < extractedKnowledge.length; ++i) {
        const knowledge = extractedKnowledge[i];
        if (knowledge) {
            await indexKnowledge(
                conversation,
                topicMerger,
                messageBlocks[i],
                knowledge,
            );
        }
    }
}

async function extractKnowledge(
    knowledgeExtractor: KnowledgeExtractor,
    message: SourceTextBlock,
    knowledge?: ConcreteEntity[] | KnowledgeResponse | undefined,
): Promise<ExtractedKnowledge | undefined> {
    let extractedKnowledge: ExtractedKnowledge | undefined;
    let knownKnowledge: ExtractedKnowledge | undefined;
    if (knowledge) {
        knownKnowledge = createExtractedKnowledge(message, knowledge);
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
            extractedKnowledge = mergeKnowledge(
                extractedKnowledge,
                knownKnowledge,
            );
        }
    } else {
        extractedKnowledge = knownKnowledge;
    }
    return extractedKnowledge;
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
        const topicCount = knowledgeIds.topicIds?.length ?? 0;
        if (topicCount > 0) {
            await topicMerger.next(true);
        }
    }
    await conversation.addKnowledgeToIndex(knowledge, knowledgeIds);
}

function mergeKnowledge(
    x: ExtractedKnowledge,
    y: ExtractedKnowledge,
): ExtractedKnowledge {
    const merged = new Map<string, ExtractedEntity>();
    if (x.entities && x.entities.length > 0) {
        mergeEntities(x.entities, merged);
    }
    if (y.entities && y.entities.length > 0) {
        mergeEntities(y.entities, merged);
    }

    let topics = collections.concatArrays(x.topics, y.topics);
    let actions = collections.concatArrays(x.actions, y.actions);
    return {
        entities: [...merged.values()],
        topics,
        actions,
    };
}

function mergeEntities(
    entities: ExtractedEntity[],
    merged: Map<string, ExtractedEntity>,
): void {
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
            if (entity.facets && entity.facets.length > 0) {
                for (const f of entity.facets) {
                    mergeEntityFacet(existing.value, f);
                }
            }
        } else {
            merged.set(entity.name, ee);
        }
    }
}
