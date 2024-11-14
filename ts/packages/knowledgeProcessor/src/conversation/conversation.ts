// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    FileSystem,
    ObjectFolder,
    ObjectFolderSettings,
    SearchOptions,
    createObjectFolder,
    dateTime,
    removeDir,
} from "typeagent";
import { TextBlock, SourceTextBlock, TextBlockType } from "../text.js";
import { Topic } from "./topicSchema.js";
import { TextStore, createTextStore } from "../textStore.js";
import path from "path";
import {
    TopicIndex,
    TopicMerger,
    TopicSearchOptions,
    createTopicIndexOnStorage,
    createTopicMerger,
    createTopicSearchOptions,
} from "./topics.js";
import {
    TextIndexSettings,
    removeSemanticIndexFolder,
} from "../knowledgeIndex.js";
import {
    EntityIndex,
    EntitySearchOptions,
    createEntityIndexOnStorage,
    createEntitySearchOptions,
} from "./entities.js";
import { ExtractedKnowledge } from "./knowledge.js";
import { Filter, SearchAction } from "./knowledgeSearchSchema.js";
import { intersectSets, removeUndefined, unionSets } from "../setOperations.js";
import { MessageIndex, createMessageIndex } from "./messages.js";
import {
    ActionIndex,
    ActionSearchOptions,
    createActionIndexOnStorage,
    createActionSearchOptions,
} from "./actions.js";
import { SearchTermsAction, TermFilter } from "./knowledgeTermSearchSchema.js";
import {
    SearchTermsActionV2,
    TermFilterV2,
} from "./knowledgeTermSearchSchema2.js";
import { getAllTermsInFilter } from "./knowledgeTermSearch2.js";
import { TypeChatLanguageModel } from "typechat";
import { TextEmbeddingModel } from "aiclient";
import { createSearchResponse, SearchResponse } from "./searchResponse.js";
import {
    createFileSystemStorageProvider,
    StorageProvider,
} from "../storageProvider.js";
import { RecentItems, createRecentItemsWindow } from "../temporal.js";

export interface ConversationSettings {
    indexSettings: TextIndexSettings;
    entityIndexSettings?: TextIndexSettings | undefined;
    actionIndexSettings?: TextIndexSettings | undefined;
    indexActions?: boolean;
    initializer?: ((conversation: Conversation) => Promise<void>) | undefined;
}

export function createConversationSettings(
    embeddingModel?: TextEmbeddingModel,
): ConversationSettings {
    return {
        indexSettings: {
            caseSensitive: false,
            concurrency: 2,
            embeddingModel,
            semanticIndex: true,
        },
    };
}

export type ConversationSearchOptions = {
    entity?: EntitySearchOptions | undefined;
    topic?: TopicSearchOptions | undefined;
    // Include if you want to use actions in your search
    action?: ActionSearchOptions | undefined;
    topicLevel?: number;
    loadMessages?: boolean;
};

export function createConversationSearchOptions(
    topLevelSummary: boolean = false,
): ConversationSearchOptions {
    const topicLevel = topLevelSummary ? 2 : 1;
    const searchOptions: ConversationSearchOptions = {
        entity: createEntitySearchOptions(true),
        topic: createTopicSearchOptions(topLevelSummary),
        action: createActionSearchOptions(true),
        topicLevel,
        loadMessages: !topLevelSummary,
    };
    return searchOptions;
}

export interface Conversation<
    MessageId = any,
    TTopicId = any,
    TEntityId = any,
    TActionId = any,
> {
    readonly settings: ConversationSettings;
    readonly messages: TextStore<MessageId>;
    readonly knowledge: ObjectFolder<ExtractedKnowledge>;

    getMessageIndex(): Promise<MessageIndex<MessageId>>;
    getEntityIndex(): Promise<EntityIndex<TEntityId, MessageId>>;
    getTopicsIndex(level?: number): Promise<TopicIndex<TTopicId, MessageId>>;
    getActionIndex(): Promise<ActionIndex<TActionId, MessageId>>;
    /**
     *
     * @param removeMessages If you want the original messages also removed. Set to false if you just want to rebuild the indexes
     */
    clear(removeMessages: boolean): Promise<void>;

    addMessage(
        message: string | TextBlock,
        timestamp?: Date,
    ): Promise<SourceTextBlock<MessageId>>;
    addKnowledgeForMessage(
        message: SourceTextBlock<MessageId>,
        knowledge: ExtractedKnowledge<MessageId>,
    ): Promise<ExtractedKnowledgeIds<TTopicId, TEntityId, TActionId>>;
    addKnowledgeToIndex(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TTopicId, TEntityId, TActionId>,
    ): Promise<void>;
    search(
        filters: Filter[],
        options: ConversationSearchOptions,
    ): Promise<SearchResponse>;
    searchTerms(
        filters: TermFilter[],
        options: ConversationSearchOptions,
    ): Promise<SearchResponse>;
    searchTermsV2(
        filters: TermFilterV2[],
        options?: ConversationSearchOptions | undefined,
    ): Promise<SearchResponse>;
    searchMessages(
        query: string,
        options: SearchOptions,
        idsToSearch?: MessageId[],
    ): Promise<
        | {
              messageIds: MessageId[];
              messages: dateTime.Timestamped<TextBlock<MessageId>>[];
          }
        | undefined
    >;
    findMessage(
        messageText: string,
    ): Promise<dateTime.Timestamped<TextBlock<MessageId>> | undefined>;
    addNextEntities(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TTopicId, TEntityId, TActionId>,
        timestamp?: Date | undefined,
    ): Promise<void>;
    indexEntities(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TTopicId, TEntityId, TActionId>,
    ): Promise<void>;
}

export type ExtractedKnowledgeIds<
    TopicId = any,
    TEntityId = any,
    TActionId = any,
> = {
    topicIds?: TopicId[];
    entityIds?: TEntityId[] | undefined;
    actionIds?: TActionId[] | undefined;
};

/**
 * Create or load a persistent conversation, using the given rootPath as the storage root.
 * - The conversation is stored in folders below the given root path
 * - If the rootPath exists, the conversation stored inside it is automatically used.
 * @param settings
 * @param rootPath
 * @param folderSettings (Optional) Flags for object storage
 * @param fSys (Optional) By default, stored on local file system
 * @returns
 */
export async function createConversation(
    settings: ConversationSettings,
    rootPath: string,
    folderSettings?: ObjectFolderSettings | undefined,
    fSys?: FileSystem | undefined,
    storageProvider?: StorageProvider,
): Promise<Conversation<string, string, string>> {
    type MessageId = string;
    type TopicId = string;
    type EntityId = string;
    type ActionId = string;

    settings.indexActions ??= true;
    folderSettings ??= {
        cacheNames: true,
        useWeakRefs: true,
    };
    storageProvider ??= createFileSystemStorageProvider(
        rootPath,
        folderSettings,
        fSys,
    );
    const messages = await createTextStore(
        { concurrency: settings.indexSettings.concurrency },
        path.join(rootPath, "messages"),
        folderSettings,
        fSys,
    );

    let messageIndex: MessageIndex<MessageId> | undefined;
    const knowledgeStore = await createObjectFolder<
        ExtractedKnowledge<MessageId>
    >(path.join(rootPath, "knowledge"), folderSettings, fSys);

    const topics = new Map<string, TopicIndex>();
    const entityPath = path.join(rootPath, "entities");
    let entityIndex: EntityIndex | undefined;
    const actionPath = path.join(rootPath, "actions");
    let actionIndex: ActionIndex | undefined;

    const thisConversation: Conversation<string, string, string> = {
        settings,
        messages,
        knowledge: knowledgeStore,
        getMessageIndex,
        getEntityIndex,
        getTopicsIndex,
        getActionIndex,
        clear,
        addMessage,
        addKnowledgeForMessage,
        addKnowledgeToIndex,
        search,
        searchTerms,
        searchTermsV2,
        searchMessages,
        findMessage,

        addNextEntities,
        indexEntities,
    };
    await load();
    return thisConversation;

    async function getMessageIndex(): Promise<MessageIndex<MessageId>> {
        if (!messageIndex) {
            messageIndex = await createMessageIndex(
                settings.indexSettings,
                rootPath,
                folderSettings,
                fSys,
            );
        }
        return messageIndex;
    }

    async function getEntityIndex(): Promise<EntityIndex> {
        if (!entityIndex) {
            entityIndex = await createEntityIndexOnStorage<MessageId>(
                settings.entityIndexSettings ?? settings.indexSettings,
                entityPath,
                storageProvider!,
            );
        }
        return entityIndex;
    }

    async function getEntityNameIndex() {
        return (await getEntityIndex()).nameIndex;
    }

    async function getActionIndex(): Promise<ActionIndex> {
        if (!actionIndex) {
            actionIndex = await createActionIndexOnStorage<MessageId>(
                settings.actionIndexSettings ?? settings.indexSettings,
                getEntityNameIndex,
                actionPath,
                storageProvider!,
            );
        }
        return actionIndex;
    }

    async function getTopicsIndex(level?: number): Promise<TopicIndex> {
        const name = topicsName(level);
        let topicIndex = topics.get(name);
        if (!topicIndex) {
            topicIndex = await loadTopicIndex(name);
            topics.set(name, topicIndex);
        }
        return topicIndex;
    }

    async function loadKnowledge() {
        await Promise.all([
            getTopicsIndex(1),
            getTopicsIndex(2),
            getEntityIndex(),
            getActionIndex(),
        ]);
    }

    async function removeTopics(level?: number): Promise<void> {
        const name = topicsName(level);
        topics.delete(name);
        await removeDir(path.join(rootPath, name), fSys);
    }

    async function removeEntities(): Promise<void> {
        await removeDir(entityPath, fSys);
        entityIndex = undefined;
    }

    async function removeActions(): Promise<void> {
        await removeDir(actionPath, fSys);
        actionIndex = undefined;
    }

    async function removeKnowledge(): Promise<void> {
        // TODO: Migrate to file system storage provider
        await Promise.all([
            knowledgeStore.clear(),
            removeTopics(1),
            removeTopics(2), // TODO: what about topics at other levels?
            removeEntities(),
            removeActions(),
        ]);
        topics.clear();
        await storageProvider!.clear();
    }

    async function removeMessageIndex(): Promise<void> {
        await removeSemanticIndexFolder(rootPath, fSys);
        messageIndex = undefined;
    }

    async function clear(removeMessages: boolean): Promise<void> {
        await removeMessageIndex();
        await removeKnowledge();
        if (removeMessages) {
            await messages.clear();
        }
        await load();
    }

    async function load() {
        await Promise.all([loadKnowledge(), getMessageIndex()]);
        if (settings.initializer) {
            await settings.initializer(thisConversation);
        }
    }

    async function loadTopicIndex(name: string): Promise<TopicIndex> {
        const index = await createTopicIndexOnStorage<MessageId>(
            settings.indexSettings,
            getEntityNameIndex,
            rootPath,
            name,
            storageProvider!,
            "TEXT",
        );
        return index;
    }

    async function addMessage(
        message: string | TextBlock,
        timestamp?: Date,
    ): Promise<SourceTextBlock<any, MessageId>> {
        const messageBlock: TextBlock =
            typeof message === "string"
                ? {
                      value: message,
                      type: TextBlockType.Paragraph,
                  }
                : message;
        timestamp ??= new Date();
        const blockId = await messages.put(messageBlock, timestamp);
        return { ...messageBlock, blockId, timestamp };
    }

    async function addKnowledgeForMessage(
        message: SourceTextBlock<MessageId>,
        knowledge: ExtractedKnowledge<MessageId>,
    ): Promise<ExtractedKnowledgeIds<TopicId, EntityId, ActionId>> {
        await knowledgeStore.put(knowledge, message.blockId);
        const knowledgeIds: ExtractedKnowledgeIds<TopicId, EntityId, ActionId> =
            {};

        await Promise.all([
            addNextEntities(knowledge, knowledgeIds, message.timestamp),
            addNextTopics(knowledge, knowledgeIds, message.timestamp),
            addNextActions(knowledge, knowledgeIds, message.timestamp),
        ]);
        return knowledgeIds;
    }

    async function addKnowledgeToIndex(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TopicId, EntityId, ActionId>,
        message?: SourceTextBlock<MessageId> | undefined,
    ): Promise<void> {
        // these indexes are independent, they can be updated concurrently.
        await Promise.all([
            indexMessage(message),
            indexEntities(knowledge, knowledgeIds),
        ]);
        // actions and topics depend on entities
        await Promise.all([
            indexTopics(knowledge, knowledgeIds),
            indexActions(knowledge, knowledgeIds),
        ]);
    }

    async function indexMessage(
        message?: SourceTextBlock<MessageId>,
    ): Promise<void> {
        if (message) {
            const messageIndex = await getMessageIndex();
            await messageIndex.put(message.value, message.blockId);
        }
    }

    async function addNextTopics(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TopicId, EntityId, ActionId>,
        timestamp?: Date | undefined,
    ): Promise<void> {
        if (knowledge.topics && knowledge.topics.length > 0) {
            const topicIndex = await getTopicsIndex();
            knowledgeIds.topicIds = await topicIndex.addNext(
                knowledge.topics,
                timestamp,
            );
        }
    }

    async function indexTopics(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TopicId, EntityId, ActionId>,
    ): Promise<void> {
        if (knowledge.topics && knowledge.topics.length > 0) {
            const topicIndex = await getTopicsIndex();
            await topicIndex.addMultiple(
                knowledge.topics,
                knowledge.sourceEntityName,
                knowledgeIds.topicIds,
            );
        }
    }

    async function addNextEntities(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TopicId, EntityId, ActionId>,
        timestamp?: Date | undefined,
    ): Promise<void> {
        if (knowledge.entities && knowledge.entities.length > 0) {
            const entityIndex = await getEntityIndex();
            knowledgeIds.entityIds = await entityIndex.addNext(
                knowledge.entities,
                timestamp,
            );
        }
    }

    async function indexEntities(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TopicId, EntityId, ActionId>,
    ): Promise<void> {
        if (knowledge.entities && knowledge.entities.length > 0) {
            const entityIndex = await getEntityIndex();
            await entityIndex.addMultiple(
                knowledge.entities,
                knowledgeIds.entityIds,
            );
        }
    }

    async function addNextActions(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TopicId, EntityId, ActionId>,
        timestamp?: Date | undefined,
    ): Promise<void> {
        if (
            settings.indexActions &&
            knowledge.actions &&
            knowledge.actions.length > 0
        ) {
            const actionIndex = await getActionIndex();
            knowledgeIds.actionIds = await actionIndex.addNext(
                knowledge.actions,
                timestamp,
            );
        }
    }

    async function indexActions(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TopicId, EntityId, ActionId>,
    ): Promise<void> {
        if (
            settings.indexActions &&
            knowledge.actions &&
            knowledge.actions.length > 0
        ) {
            const actionIndex = await getActionIndex();
            await actionIndex.addMultiple(
                knowledge.actions,
                knowledgeIds.actionIds,
            );
        }
    }

    async function search(
        filters: Filter[],
        options: ConversationSearchOptions,
    ): Promise<SearchResponse> {
        const entityIndex = await getEntityIndex();
        const topicIndex = await getTopicsIndex(options.topicLevel);
        const actionIndex = await getActionIndex();
        const results = createSearchResults();
        for (const filter of filters) {
            switch (filter.filterType) {
                case "Topic":
                    if (options.topic) {
                        const topicResult = await topicIndex.search(
                            filter,
                            options.topic,
                        );
                        results.topics.push(topicResult);
                    }
                    break;
                case "Entity":
                    if (options.entity) {
                        const entityResult = await entityIndex.search(
                            filter,
                            options.entity,
                        );
                        results.entities.push(entityResult);
                    }
                    break;
                case "Action":
                    if (options.action) {
                        const actionResults = await actionIndex.search(
                            filter,
                            options.action,
                        );
                        results.actions.push(actionResults);
                    }
                    break;
            }
        }
        if (options.loadMessages) {
            await resolveMessages(
                results,
                topicIndex,
                entityIndex,
                actionIndex,
            );
        }
        return results;
    }

    async function searchTerms(
        filters: TermFilter[],
        options: ConversationSearchOptions,
    ): Promise<SearchResponse> {
        const [entityIndex, topicIndex, actionIndex] = await Promise.all([
            getEntityIndex(),
            getTopicsIndex(options.topicLevel),
            getActionIndex(),
        ]);
        const results = createSearchResults();
        for (const filter of filters) {
            // Only search actions if (a) actions are enabled (b) we have an action filter
            if (options.topic) {
                const topicResult = await topicIndex.searchTerms(
                    filter,
                    options.topic,
                );
                results.topics.push(topicResult);
            }
            if (options.entity) {
                const entityResult = await entityIndex.searchTerms(
                    filter,
                    options.entity,
                );
                results.entities.push(entityResult);
            }
            if (options.action) {
                const actionResult = await actionIndex.searchTerms(
                    filter,
                    options.action,
                );
                results.actions.push(actionResult);
            }
        }
        if (options.loadMessages) {
            await resolveMessages(
                results,
                topicIndex,
                entityIndex,
                actionIndex,
            );
        }
        return results;
    }

    async function searchTermsV2(
        filters: TermFilterV2[],
        searchOptions?: ConversationSearchOptions | undefined,
    ): Promise<SearchResponse> {
        const options = searchOptions ?? createConversationSearchOptions();
        const [entityIndex, topicIndex, actionIndex] = await Promise.all([
            getEntityIndex(),
            getTopicsIndex(options.topicLevel),
            getActionIndex(),
        ]);
        const results = createSearchResults();
        for (let filter of filters) {
            let topLevelTopicMatches =
                options.topic &&
                options.topic.useHighLevel &&
                options.topicLevel === 1
                    ? await matchTopLevelTopics(
                          options.topicLevel,
                          filter,
                          options.topic,
                      )
                    : undefined;

            const searchTasks = [
                options.action
                    ? await actionIndex.searchTermsV2(filter, options.action)
                    : Promise.resolve(undefined),
                options.topic
                    ? topicIndex.searchTermsV2(
                          filter,
                          options.topic,
                          topLevelTopicMatches,
                      )
                    : Promise.resolve(undefined),
                options.entity
                    ? entityIndex.searchTermsV2(
                          {
                              searchTerms: getAllTermsInFilter(filter, false),
                              timeRange: filter.timeRange,
                          },
                          options.entity,
                      )
                    : Promise.resolve(undefined),
            ];
            const [actionResult, topicResult, entityResult] =
                await Promise.all(searchTasks);
            if (topicResult) {
                results.topics.push(topicResult);
            }
            if (entityResult) {
                results.entities.push(entityResult);
            }
            if (actionResult) {
                results.actions.push(actionResult);
            }
        }
        if (options.loadMessages) {
            await resolveMessages(
                results,
                topicIndex,
                entityIndex,
                actionIndex,
            );
        }
        return results;
    }

    async function matchTopLevelTopics(
        level: number,
        filter: TermFilterV2,
        options: TopicSearchOptions,
    ): Promise<TopicId[] | undefined> {
        const topicIndex = await getTopicsIndex(level + 1);
        const result = await topicIndex.searchTermsV2(filter, options);
        if (result.topicIds && result.topicIds.length > 0) {
            return await topicIndex.getSourceIds(result.topicIds);
        }
        return undefined;
    }

    async function searchMessages(
        query: string,
        options: SearchOptions,
        idsToSearch?: MessageId[],
    ): Promise<
        | {
              messageIds: MessageId[];
              messages: dateTime.Timestamped<TextBlock<MessageId>>[];
          }
        | undefined
    > {
        const messageIndex = await getMessageIndex();
        if (messageIndex) {
            const matches =
                idsToSearch && idsToSearch.length > 0
                    ? await messageIndex.nearestNeighborsInSubset(
                          query,
                          idsToSearch,
                          options.maxMatches,
                          options.minScore,
                      )
                    : await messageIndex.nearestNeighbors(
                          query,
                          options.maxMatches,
                          options.minScore,
                      );
            if (matches.length > 0) {
                const messageIds = matches.map((m) => m.item);
                return { messageIds, messages: await loadMessages(messageIds) };
            }
        }
        return undefined;
    }

    async function resolveMessages(
        results: SearchResponse,
        topicIndex: TopicIndex,
        entityIndex: EntityIndex,
        actionIndex: ActionIndex,
    ): Promise<void> {
        let topicMessageIds: Set<MessageId> | undefined;
        let entityMessageIds: Set<MessageId> | undefined;
        let actionMessageIds: Set<MessageId> | undefined;
        if (results.topics && results.topics.length > 0) {
            topicMessageIds = await topicIndex.loadSourceIds(
                messages,
                results.topics,
            );
        }
        if (results.entities && results.entities.length > 0) {
            entityMessageIds = await entityIndex.loadSourceIds(
                messages,
                results.entities,
            );
        }
        if (results.actions && results.actions.length > 0) {
            actionMessageIds = await actionIndex.loadSourceIds(
                messages,
                results.actions,
            );
        }
        entityMessageIds = intersectSets(entityMessageIds, actionMessageIds);
        if (!entityMessageIds || entityMessageIds.size === 0) {
            entityMessageIds = unionSets(entityMessageIds, actionMessageIds);
        }
        let messageIds = intersectSets(topicMessageIds, entityMessageIds);
        if (!messageIds || messageIds.size === 0) {
            //messageIds = topicMessageIds;
            // If nothing in common, try a union.
            messageIds = unionSets(topicMessageIds, entityMessageIds);
            //messageIds = intersectUnionSets(topicMessageIds, entityMessageIds);
        }
        if (messageIds && messageIds.size > 0) {
            results.messageIds = [...messageIds.values()].sort();
            results.messages = await loadMessages(results.messageIds);
        }
    }

    async function loadMessages(
        ids: MessageId[],
    ): Promise<dateTime.Timestamped<TextBlock<MessageId>>[]> {
        let loadedMessages = (await messages.getMultiple(
            ids,
        )) as dateTime.Timestamped<TextBlock<MessageId>>[];
        loadedMessages = removeUndefined(loadedMessages);
        // Return messages in temporal order
        loadedMessages.sort(
            (x, y) => x.timestamp.getTime() - y.timestamp.getTime(),
        );
        return loadedMessages;
    }

    function topicsName(level?: number): string {
        level ??= 1;
        return `topics_${level}`;
    }

    async function findMessage(
        messageText: string,
    ): Promise<dateTime.Timestamped<TextBlock<MessageId>> | undefined> {
        const existing = await searchMessages(messageText, {
            maxMatches: 1,
        });
        if (existing && existing.messages && existing.messages.length > 0) {
            const messageBlock = existing.messages[0];
            if (messageText === messageBlock.value.value) {
                return messageBlock;
            }
        }
        return undefined;
    }

    function createSearchResults() {
        return createSearchResponse<MessageId, TopicId, EntityId>();
    }
}

export interface ConversationTopicMerger<TTopicId = any>
    extends TopicMerger<TTopicId> {
    reset(): Promise<void>;
}

export async function createConversationTopicMerger<TTopicId = string>(
    mergeModel: TypeChatLanguageModel,
    conversation: Conversation,
    baseTopicLevel: number,
    mergeWindowSize: number = 4,
): Promise<ConversationTopicMerger<TTopicId>> {
    let baseTopics: TopicIndex | undefined;
    let topLevelTopics: TopicIndex | undefined;
    let topicMerger: TopicMerger | undefined;
    await init();

    return {
        get settings() {
            return topicMerger!.settings;
        },
        next,
        mergeWindow,
        clearRecent,
        reset,
    };

    function next(
        lastTopics: TextBlock[],
        lastTopicIds: TTopicId[],
        timestamp: Date | undefined,
        updateIndex: boolean,
    ) {
        return topicMerger!.next(
            lastTopics,
            lastTopicIds,
            timestamp,
            updateIndex,
        );
    }

    function mergeWindow(
        lastTopics: TextBlock[],
        lastTopicIds: TTopicId[],
        timestamp: Date | undefined,
        windowSize: number,
        updateIndex: boolean,
    ) {
        return topicMerger!.mergeWindow(
            lastTopics,
            lastTopicIds,
            timestamp,
            windowSize,
            updateIndex,
        );
    }

    function clearRecent(): void {
        topicMerger!.clearRecent();
    }

    function reset(): Promise<void> {
        return init();
    }

    async function init() {
        baseTopics = await conversation.getTopicsIndex(baseTopicLevel);
        topLevelTopics = await conversation.getTopicsIndex(baseTopicLevel + 1);
        topicMerger = await createTopicMerger(
            mergeModel,
            baseTopics,
            { mergeWindowSize, trackRecent: true },
            topLevelTopics,
        );
    }
}

export interface RecentConversation {
    readonly turns: RecentItems<SourceTextBlock>;
    readonly topics: RecentItems<Topic>;
}

export function createRecentConversationWindow(
    windowSize: number,
): RecentConversation {
    return {
        turns: createRecentItemsWindow<SourceTextBlock>(
            windowSize,
            (b) => b.value,
        ),
        topics: createRecentItemsWindow<Topic>(windowSize),
    };
}

export type SearchActionResponse = {
    action: SearchAction;
    response?: SearchResponse | undefined;
};

export type SearchTermsActionResponse = {
    action: SearchTermsAction;
    response?: SearchResponse | undefined;
};

export type SearchTermsActionResponseV2 = {
    action: SearchTermsActionV2;
    response?: SearchResponse | undefined;
};
