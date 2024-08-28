// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    FileSystem,
    ObjectFolder,
    ObjectFolderSettings,
    SearchOptions,
    collections,
    createObjectFolder,
    dateTime,
    removeDir,
} from "typeagent";
import { TextBlock, SourceTextBlock, valueToString } from "../text.js";
import { Topic } from "./topicSchema.js";
import { TextStore, createTextStore } from "../textStore.js";
import path from "path";
import {
    TopicIndex,
    TopicMerger,
    TopicSearchOptions,
    TopicSearchResult,
    createTopicIndex,
    createTopicMerger,
} from "./topics.js";
import {
    TextIndexSettings,
    removeSemanticIndexFolder,
} from "../knowledgeIndex.js";
import {
    CompositeEntity,
    EntityIndex,
    EntitySearchOptions,
    EntitySearchResult,
    createEntityIndex,
    mergeEntities,
} from "./entities.js";
import {
    ExtractedKnowledge,
    KnowledgeExtractor,
    extractKnowledgeFromBlock,
} from "./knowledge.js";
import { Filter, SearchAction } from "./knowledgeSearchWebSchema.js";
import { ChatModel } from "aiclient";
import { AnswerResponse } from "./answerSchema.js";
import {
    intersectSets,
    removeUndefined,
    unionSets,
    uniqueFrom,
} from "../setOperations.js";
import { getRangeOfTemporalSequence } from "../temporal.js";
import { Action, ConcreteEntity } from "./knowledgeSchema.js";
import { MessageIndex, createMessageIndex } from "./messages.js";
import {
    ActionIndex,
    ActionSearchOptions,
    ActionSearchResult,
    createActionIndex,
} from "./actions.js";
import { SearchTermsAction, TermFilter } from "./knowledgeTermSearchSchema.js";

export interface RecentItems<T> {
    readonly entries: collections.CircularArray<T>;
    push(items: T | T[]): void;
    getContext(maxContextLength: number): string[];
    getUnique(): T[];
}

export function createRecentItemsWindow<T>(
    windowSize: number,
    stringify?: (value: T) => string,
): RecentItems<T> {
    const entries = new collections.CircularArray<T>(windowSize);
    return {
        entries,
        push,
        getContext,
        getUnique,
    };

    function push(items: T | T[]): void {
        if (Array.isArray(items)) {
            for (const item of items) {
                entries.push(item);
            }
        } else {
            entries.push(items);
        }
    }

    function getContext(maxContextLength: number): string[] {
        let sections: string[] = [];
        let totalLength = 0;
        let i: number = entries.length - 1;
        // Get the range of sections that could be pushed on, NEWEST first
        for (const item of entries.itemsReverse()) {
            const content = valueToString(item, stringify);
            const nextLength = content.length;
            if (nextLength + totalLength > maxContextLength) {
                break;
            }
            sections.push(content);
            totalLength += nextLength;
        }
        sections.reverse();
        return sections;
    }

    function getUnique(): T[] {
        const unique = new Set<T>(entries);
        return unique.size > 0 ? [...unique.values()] : [];
    }
}

export interface Conversation<
    MessageId = any,
    TTopicId = any,
    TEntityId = any,
    TActionId = any,
> {
    readonly messages: TextStore<MessageId>;
    readonly knowledge: ObjectFolder<ExtractedKnowledge>;

    getMessageIndex(): Promise<MessageIndex<MessageId>>;
    getEntityIndex(): Promise<EntityIndex<TEntityId, MessageId>>;
    getTopicsIndex(level?: number): Promise<TopicIndex<TTopicId, MessageId>>;
    getActionIndex(): Promise<ActionIndex<TActionId, MessageId>>;
    removeEntities(): Promise<void>;
    removeTopics(level?: number): Promise<void>;
    removeKnowledge(): Promise<void>;
    removeActions(): Promise<void>;
    removeMessageIndex(): Promise<void>;
    /**
     *
     * @param removeMessages If you want the original messages also removed. Set to false if you just want to rebuild the indexes
     */
    clear(removeMessages: boolean): Promise<void>;

    putIndex(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TTopicId, TEntityId, TActionId>,
    ): Promise<void>;
    putNext(
        message: SourceTextBlock<MessageId>,
        knowledge: ExtractedKnowledge<MessageId>,
    ): Promise<ExtractedKnowledgeIds<TTopicId, TEntityId, TActionId>>;
    search(
        filters: Filter[],
        options: ConversationSearchOptions,
    ): Promise<SearchResponse>;
    searchTerms(
        filters: TermFilter[],
        options: ConversationSearchOptions,
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

export interface SearchResponse<
    TMessageId = any,
    TTopicId = any,
    TEntityId = any,
    TActionId = any,
> {
    entities: EntitySearchResult<TEntityId>[];
    topics: TopicSearchResult<TTopicId>[];
    actions: ActionSearchResult<TActionId>[];
    topicLevel: number;
    messageIds?: TMessageId[] | undefined;
    messages?: dateTime.Timestamped<TextBlock<TMessageId>>[] | undefined;
    answer?: AnswerResponse | undefined;

    allTopics(): IterableIterator<string>;
    allTopicIds(): IterableIterator<TTopicId>;
    mergeAllTopics(): string[];
    topicTimeRanges(): (dateTime.DateRange | undefined)[];
    allEntities(): IterableIterator<ConcreteEntity>;
    allEntityIds(): IterableIterator<TEntityId>;
    allEntityNames(): string[];
    mergeAllEntities(topK: number): CompositeEntity[];
    entityTimeRanges(): (dateTime.DateRange | undefined)[];

    allActions(): IterableIterator<Action>;
    allActionIds(): IterableIterator<TActionId>;
    actionTimeRanges(): (dateTime.DateRange | undefined)[];

    hasTopics(): boolean;
    hasEntities(): boolean;
    hasActions(): boolean;
    hasMessages(): boolean;
    hasHits(): boolean;
}

export function createSearchResponse<
    TMessageId = any,
    TTopicId = any,
    TEntityId = any,
    TActionId = any,
>(topicLevel?: number): SearchResponse<TMessageId, TTopicId, TEntityId> {
    const response: SearchResponse<TMessageId, TTopicId, TEntityId, TActionId> =
        {
            entities: [],
            topics: [],
            actions: [],
            topicLevel: topicLevel ?? 1,
            allTopics,
            allTopicIds,
            mergeAllTopics,
            topicTimeRanges,
            allEntities,
            allEntityIds,
            allEntityNames,
            mergeAllEntities,
            entityTimeRanges,
            allActions,
            allActionIds,
            actionTimeRanges,
            hasTopics,
            hasEntities,
            hasActions,
            hasHits,
            hasMessages,
        };
    return response;

    function* allTopics(): IterableIterator<string> {
        for (const result of response.topics) {
            if (result.topics && result.topics.length > 0) {
                for (const topic of result.topics) {
                    yield topic;
                }
            }
        }
    }

    function* allTopicIds(): IterableIterator<TTopicId> {
        for (const result of response.topics) {
            if (result.topicIds && result.topicIds.length > 0) {
                for (const id of result.topicIds) {
                    yield id;
                }
            }
        }
    }

    function mergeAllTopics(): string[] {
        return uniqueFrom<string, string>(allTopics())!;
    }

    function* allEntityIds(): IterableIterator<TEntityId> {
        for (const result of response.entities) {
            if (result.entityIds && result.entityIds.length > 0) {
                for (const id of result.entityIds) {
                    yield id;
                }
            }
        }
    }

    function* allEntities(): IterableIterator<ConcreteEntity> {
        for (const result of response.entities) {
            if (result.entities && result.entities.length > 0) {
                for (const entity of result.entities) {
                    yield entity;
                }
            }
        }
    }

    function mergeAllEntities(topK: number = 3): CompositeEntity[] {
        const mergedEntities = mergeEntities(allEntities());
        if (mergedEntities.size === 0) {
            return [];
        }
        // Sort in hit count order
        const entities = [...mergedEntities.values()]
            .sort((x, y) => y.count - x.count)
            .map((e) => e.value);
        return topK > 0 ? entities.slice(0, topK) : entities;
    }

    function allEntityNames(): string[] {
        return uniqueFrom<ConcreteEntity, string>(
            allEntities(),
            (e) => e.name,
            true,
        )!;
    }

    function entityTimeRanges(): (dateTime.DateRange | undefined)[] {
        return response.entities.length > 0
            ? response.entities.map((e) => e.getTemporalRange())
            : [];
    }

    function topicTimeRanges(): (dateTime.DateRange | undefined)[] {
        return response.topics.length > 0
            ? response.topics.map((t) =>
                  getRangeOfTemporalSequence(t.temporalSequence),
              )
            : [];
    }

    function* allActions(): IterableIterator<Action> {
        for (const result of response.actions) {
            if (result.actions && result.actions.length > 0) {
                for (const action of result.actions) {
                    yield action;
                }
            }
        }
    }

    function* allActionIds(): IterableIterator<TActionId> {
        for (const result of response.actions) {
            if (result.actionIds) {
                for (const id of result.actionIds) {
                    yield id;
                }
            }
        }
    }

    function actionTimeRanges(): (dateTime.DateRange | undefined)[] {
        return response.actions.length > 0
            ? response.actions.map((a) =>
                  getRangeOfTemporalSequence(a.temporalSequence),
              )
            : [];
    }

    function hasTopics(): boolean {
        for (const topic of allTopics()) {
            return true;
        }
        return false;
    }

    function hasEntities(): boolean {
        for (const entity of allEntities()) {
            return true;
        }
        return false;
    }

    function hasActions(): boolean {
        for (const action of allActions()) {
            return true;
        }
        return false;
    }

    function hasMessages(): boolean {
        return (
            response.messageIds !== undefined && response.messageIds.length > 0
        );
    }

    function hasHits(): boolean {
        return hasMessages() || hasEntities() || hasTopics();
    }
}

export type ConversationSettings = {
    indexSettings: TextIndexSettings;
    indexActions?: boolean;
};

export type ConversationSearchOptions = {
    entity: EntitySearchOptions;
    topic: TopicSearchOptions;
    // Include if you want to use actions in your search
    action?: ActionSearchOptions | undefined;
    topicLevel?: number;
    loadMessages?: boolean;
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
): Promise<Conversation<string, string, string>> {
    type MessageId = string;
    type TopicId = string;
    type EntityId = string;
    type ActionId = string;

    settings.indexActions ??= true;

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

    return {
        messages,
        knowledge: knowledgeStore,
        getMessageIndex,
        getEntityIndex,
        getTopicsIndex,
        getActionIndex,
        removeEntities,
        removeTopics,
        removeKnowledge,
        removeActions,
        removeMessageIndex,
        clear,
        putIndex,
        putNext,
        search,
        searchTerms,
        searchMessages,

        addNextEntities,
        indexEntities,
    };

    async function getMessageIndex(): Promise<MessageIndex<MessageId>> {
        if (!messageIndex) {
            messageIndex = await createMessageIndex(
                rootPath,
                folderSettings,
                fSys,
            );
        }
        return messageIndex;
    }

    async function getEntityIndex(): Promise<EntityIndex> {
        if (!entityIndex) {
            entityIndex = await createEntityIndex<MessageId>(
                settings.indexSettings,
                entityPath,
                folderSettings,
                fSys,
            );
        }
        return entityIndex;
    }

    async function getEntityNameIndex() {
        return (await getEntityIndex()).nameIndex;
    }

    async function getActionIndex(): Promise<ActionIndex> {
        if (!actionIndex) {
            actionIndex = await createActionIndex<MessageId>(
                settings.indexSettings,
                getEntityNameIndex,
                actionPath,
                folderSettings,
                fSys,
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
        await Promise.all([
            knowledgeStore.clear(),
            removeTopics(1),
            removeTopics(2), // TODO: what about topics at other levels?
            removeEntities(),
            removeActions(),
        ]);
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
    }

    async function loadTopicIndex(name: string): Promise<TopicIndex> {
        const index = await createTopicIndex(
            settings.indexSettings,
            path.join(rootPath, name),
            folderSettings,
            fSys,
        );
        return index;
    }

    async function putNext(
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

    async function putIndex(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TopicId, EntityId, ActionId>,
        message?: SourceTextBlock<MessageId>,
    ): Promise<void> {
        // these indexes are independent, they can be updated concurrently.
        await Promise.all([
            indexMessage(message),
            indexTopics(knowledge),
            indexEntities(knowledge, knowledgeIds),
        ]);
        // actions depends on entities
        await indexActions(knowledge, knowledgeIds);
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
            knowledgeIds.topicIds = await topicIndex.putNext(
                knowledge.topics,
                timestamp,
            );
        }
    }

    async function indexTopics(
        knowledge: ExtractedKnowledge<MessageId>,
    ): Promise<void> {
        if (knowledge.topics && knowledge.topics.length > 0) {
            const topicIndex = await getTopicsIndex();
            await topicIndex.putMultiple(knowledge.topics);
        }
    }

    async function addNextEntities(
        knowledge: ExtractedKnowledge<MessageId>,
        knowledgeIds: ExtractedKnowledgeIds<TopicId, EntityId, ActionId>,
        timestamp?: Date | undefined,
    ): Promise<void> {
        if (knowledge.entities && knowledge.entities.length > 0) {
            const entityIndex = await getEntityIndex();
            knowledgeIds.entityIds = await entityIndex.putNext(
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
            await entityIndex.putMultiple(
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
        const results = createSearchResponse<MessageId, TopicId, EntityId>();
        for (const filter of filters) {
            switch (filter.filterType) {
                case "Topic":
                    const topicResult = await topicIndex.search(
                        filter,
                        options.topic,
                    );
                    results.topics.push(topicResult);
                    break;
                case "Entity":
                    const entityResult = await entityIndex.search(
                        filter,
                        options.entity,
                    );
                    results.entities.push(entityResult);
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
        const results = createSearchResponse<MessageId, TopicId, EntityId>();
        for (const filter of filters) {
            // Only search actions if (a) actions are enabled (b) we have an action filter
            const topicResult = await topicIndex.searchTerms(
                filter,
                options.topic,
            );
            results.topics.push(topicResult);

            const entityResult = await entityIndex.searchTerms(
                filter,
                options.entity,
            );
            results.entities.push(entityResult);

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
}

export async function createConversationTopicMerger(
    mergeModel: ChatModel,
    conversation: Conversation,
    baseTopicLevel: number,
    mergeWindow: number,
) {
    const baseTopics = await conversation.getTopicsIndex(baseTopicLevel);
    const topLevelTopics = await conversation.getTopicsIndex(
        baseTopicLevel + 1,
    );
    const topicMerger = await createTopicMerger(
        mergeModel,
        baseTopics,
        mergeWindow,
        topLevelTopics,
    );
    return topicMerger;
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
