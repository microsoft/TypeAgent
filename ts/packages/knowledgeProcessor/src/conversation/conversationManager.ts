// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { ChatModel, openai } from "aiclient";
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
    createKnowledgeExtractorSettings,
    createExtractedKnowledge,
    isMemorizedEntity,
    isKnowledgeEmpty,
    mergeKnowledge,
} from "./knowledge.js";
import {
    ConversationSearchProcessor,
    createSearchProcessor,
    SearchProcessingOptions,
} from "./searchProcessor.js";
import { createEmbeddingCache } from "../modelCache.js";
import { ConcreteEntity, KnowledgeResponse } from "./knowledgeSchema.js";
import { TermFilter } from "./knowledgeTermSearchSchema.js";
import { TopicMerger } from "./topics.js";
import { logError } from "../diagnostics.js";
import assert from "assert";
import { StorageProvider } from "../storageProvider.js";

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
    /**
     * Message header (Optional).
     * No knowledge is extracted from the header
     */
    header?: string | undefined;
    /**
     * Message sender (Optional)
     */
    sender?: string | undefined;
    /**
     * Message recipients (Optional)
     */
    recipients?: string[] | undefined;
};

export type AddMessageTask = {
    type: "addMessage";
    message: ConversationMessage;
    extractKnowledge?: boolean | boolean;
    callback?: ((error?: any | undefined) => void) | undefined;
};

export type ConversationManagerTask = AddMessageTask;

export type ConversationManagerSettings = {
    model?: ChatModel | undefined;
    answerModel?: ChatModel | undefined;
    initializer?: ((cm: ConversationManager) => Promise<void>) | undefined;
};

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
     */
    addMessage(
        message: string | ConversationMessage,
        extractKnowledge?: boolean | undefined,
    ): Promise<void>;
    /**
     * Add a batch message to the conversation
     * @param messages Conversation messages to add
     */
    addMessageBatch(
        messages: ConversationMessage[],
        extractKnowledge?: boolean | undefined,
    ): Promise<void>;
    /**
     * Queue the message for adding to the conversation memory in the background
     * @param message
     * @param knowledge Any pre-extracted knowledge. Merged with knowledge automatically extracted from message.
     * @param timestamp message timestamp
     * @returns true if queued. False if queue is full
     */
    queueAddMessage(
        message: string | ConversationMessage,
        extractKnowledge?: boolean | undefined,
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
 * @param conversationName name of conversation
 * @param conversationPath path to a root folder for this conversation.
 * @param createNew Use existing conversation or create a new one
 * @param existingConversation If using an existing conversation
 * @param model Pass in chat model to use
 * @param initializer Optional initializer
 */
export async function createConversationManager(
    settings: ConversationManagerSettings,
    conversationName: string,
    conversationPath: string,
    createNew: boolean,
    existingConversation?: Conversation | undefined,
): Promise<ConversationManager<string, string>> {
    const conversationSettings = createConversationSettings();
    const chatModel =
        settings.model ?? openai.createChatModelDefault("conversationManager");
    const knowledgeModel = chatModel;
    const answerModel = settings.answerModel ?? chatModel;

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
    );
    const updateTaskQueue = collections.createTaskQueue(async (task) => {
        await handleUpdateTask(task);
    }, 64);

    const thisConversationManager: ConversationManager<string, string> = {
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
    await load();
    return thisConversationManager;

    function addMessage(
        message: string | ConversationMessage,
        extractKnowledge?: boolean,
    ): Promise<void> {
        if (typeof message === "string") {
            message = { text: message };
        }

        return addMessageToConversation(
            conversation,
            knowledgeExtractor,
            topicMerger,
            message,
            extractKnowledge,
        );
    }

    function addMessageBatch(
        messages: ConversationMessage[],
        extractKnowledge?: boolean | undefined,
    ): Promise<void> {
        if (messages.length === 1) {
            const message = messages[0];
            return addMessage(message, extractKnowledge);
        }
        return addMessageBatchToConversation(
            conversation,
            knowledgeExtractor,
            topicMerger,
            messages,
            extractKnowledge,
        );
    }

    function queueAddMessage(
        message: string | ConversationMessage,
        extractKnowledge?: boolean | undefined,
    ): boolean {
        if (typeof message === "string") {
            message = { text: message };
        }
        extractKnowledge ??= true;
        if (message.knowledge) {
            if (Array.isArray(message.knowledge)) {
                message.knowledge = removeMemorizedEntities(message.knowledge);
            } else {
                message.knowledge.entities = removeMemorizedEntities(
                    message.knowledge.entities,
                );
            }
        }
        return updateTaskQueue.push({
            type: "addMessage",
            message,
            extractKnowledge,
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
                        addTask.message,
                        addTask.extractKnowledge,
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

    async function load(): Promise<void> {
        await conversation.getMessageIndex();
        if (settings.initializer) {
            await settings.initializer(thisConversationManager);
        }
    }

    async function clear(removeMessages: boolean): Promise<void> {
        await conversation.clear(removeMessages);
        await topicMerger!.reset();
        await load();
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

export async function createConversationManagerEx(
    settings: ConversationManagerSettings,
    conversationSettings: ConversationSettings,
    name: string,
    rootPath: string,
    storageProvider?: StorageProvider,
) {
    const conversation = await createConversation(
        conversationSettings,
        rootPath,
        undefined,
        undefined,
        storageProvider,
    );
    const cm = await createConversationManager(
        settings,
        name,
        rootPath,
        false,
        conversation,
    );
    return cm;
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
    message: ConversationMessage,
    extractKnowledge: boolean = true,
): Promise<void> {
    const messageBlock = await conversation.addMessage(
        getMessageHeaderAndText(message),
        message.timestamp,
    );

    const messageIndex = await conversation.getMessageIndex();
    await messageIndex.put(messageBlock.value, messageBlock.blockId);

    let extractedKnowledge = await extractKnowledgeFromMessage(
        knowledgeExtractor,
        message,
        messageBlock,
        message.knowledge,
        extractKnowledge,
    );
    if (extractedKnowledge) {
        await indexKnowledge(
            conversation,
            topicMerger,
            messageBlock,
            extractedKnowledge,
            message.timestamp,
        );
    }
}

export async function addMessageBatchToConversation(
    conversation: Conversation,
    knowledgeExtractor: KnowledgeExtractor,
    topicMerger: TopicMerger | undefined,
    messages: ConversationMessage[],
    extractKnowledge: boolean = true,
): Promise<void> {
    const messageBlocks = await asyncArray.mapAsync(messages, 1, (m) =>
        conversation.addMessage(getMessageHeaderAndText(m), m.timestamp),
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
        async (messageBlock, index) => {
            const knowledge = await extractKnowledgeFromMessage(
                knowledgeExtractor,
                messages[index],
                messageBlock,
                messages[index].knowledge,
                extractKnowledge,
            );
            return knowledge;
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
                messages[i].timestamp,
            );
        }
    }
}

async function extractKnowledgeFromMessage(
    knowledgeExtractor: KnowledgeExtractor,
    message: ConversationMessage,
    messageBlock: SourceTextBlock,
    priorKnowledge?: ConcreteEntity[] | KnowledgeResponse | undefined,
    shouldExtractKnowledge: boolean = true,
): Promise<ExtractedKnowledge | undefined> {
    let newKnowledge: ExtractedKnowledge | undefined;
    let knownKnowledge: ExtractedKnowledge | undefined;

    if (hasPriorKnowledge(priorKnowledge)) {
        knownKnowledge = createExtractedKnowledge(
            messageBlock,
            priorKnowledge!,
        );
    }
    // Ignore message header if there is one
    if (message.header) {
        messageBlock = {
            ...messageBlock,
        };
        messageBlock.value = getMessageText(message);
    }

    const knowledgeResult = shouldExtractKnowledge
        ? await extractKnowledgeFromBlock(knowledgeExtractor, messageBlock)
        : undefined;

    if (knowledgeResult) {
        newKnowledge = knowledgeResult[1];
    }
    if (newKnowledge) {
        if (knownKnowledge) {
            newKnowledge = mergeKnowledge(newKnowledge, knownKnowledge);
        }
    } else {
        newKnowledge = knownKnowledge
            ? mergeKnowledge(knownKnowledge) // Eliminates any duplicate information
            : undefined;
    }
    if (newKnowledge) {
        newKnowledge.sourceEntityName = message.sender;
    }
    return newKnowledge;

    function hasPriorKnowledge(
        knowledge: ConcreteEntity[] | KnowledgeResponse | undefined,
    ) {
        if (knowledge) {
            if (Array.isArray(knowledge)) {
                return knowledge.length > 0;
            }
            return !isKnowledgeEmpty(knowledge);
        }
        return false;
    }
}

function removeMemorizedEntities(entities: ConcreteEntity[]): ConcreteEntity[] {
    return entities.filter((e) => !isMemorizedEntity(e.type));
}

async function indexKnowledge(
    conversation: Conversation,
    topicMerger: TopicMerger | undefined,
    messageBlock: SourceTextBlock,
    knowledge: ExtractedKnowledge,
    timestamp: Date | undefined,
): Promise<void> {
    // Add next message... this updates the "sequence"
    const knowledgeIds = await conversation.addKnowledgeForMessage(
        messageBlock,
        knowledge,
    );
    await conversation.addKnowledgeToIndex(knowledge, knowledgeIds);
    if (
        topicMerger &&
        knowledgeIds.topicIds &&
        knowledgeIds.topicIds.length > 0
    ) {
        await topicMerger.next(
            knowledge.topics!,
            knowledgeIds.topicIds,
            timestamp,
            true,
        );
    }
}

function getMessageText(message: ConversationMessage): string {
    return typeof message.text === "string" ? message.text : message.text.value;
}

function getMessageHeaderAndText(
    message: ConversationMessage,
): string | TextBlock {
    if (message.header) {
        if (typeof message.text === "string") {
            return message.header + "\n\n" + message.text;
        }
        let textBlock: TextBlock = {
            type: message.text.type,
            value: message.header + "\n\n" + message.text.value,
            sourceIds: message.text.sourceIds,
        };
        return textBlock;
    }
    return message.text;
}
