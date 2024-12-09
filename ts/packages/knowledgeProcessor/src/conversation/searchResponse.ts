// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, dateTime, ScoredItem } from "typeagent";
import { ActionGroup, ActionSearchResult, mergeActions } from "./actions.js";
import {
    CompositeEntity,
    EntitySearchResult,
    getTopMergedEntities,
} from "./entities.js";
import { TopicSearchResult } from "./topics.js";
import { TextBlock } from "../text.js";
import { AnswerResponse } from "./answerSchema.js";
import { Action, ConcreteEntity } from "./knowledgeSchema.js";
import { uniqueFrom } from "../setOperations.js";

export type TopKSettings = {
    topicsTopK: number;
    entitiesTopK: number;
    actionsTopK: number;
};

export interface SearchResponse<
    TMessageId = any,
    TTopicId = any,
    TEntityId = any,
    TActionId = any,
> {
    readonly entities: EntitySearchResult<TEntityId>[];
    //
    // The following properties are all the RAW matches found by search
    //
    topics: TopicSearchResult<TTopicId>[];
    actions: ActionSearchResult<TActionId>[];
    topicLevel: number;
    messageIds?: TMessageId[] | undefined;
    messages?: dateTime.Timestamped<TextBlock<TMessageId>>[] | undefined;
    fallbackUsed?: boolean | undefined;
    //
    // Any actually generated answer response
    //
    answer?: AnswerResponse | undefined;

    responseStyle?: string;
    /**
     * Did we get a valid answer?
     */
    hasAnswer(): boolean;
    getAnswer(): string;
    getTopics(): string[];

    // Default TopK settings used by methods below
    topKSettings?: TopKSettings | undefined;

    /**
     * Get the topK matched and *loaded* entities.
     * Composites all raw matched entities - which are very granular - into a whole
     * Entities are loaded only if search options said so
     * @param topK
     */
    getEntities(topK?: number | undefined): CompositeEntity[];
    getActions(topK?: number | undefined): ActionGroup[];

    allTopics(): IterableIterator<string>;
    allTopicIds(): IterableIterator<TTopicId>;

    topicTimeRanges(): (dateTime.DateRange | undefined)[];

    allRawEntities(): IterableIterator<ConcreteEntity>;
    allEntityIds(): IterableIterator<TEntityId>;
    allEntityNames(): string[];
    entityTimeRanges(): (dateTime.DateRange | undefined)[];

    allActions(): IterableIterator<Action>;
    allActionIds(): IterableIterator<TActionId>;
    actionTimeRanges(): (dateTime.DateRange | undefined)[];

    getTotalMessageLength(): number;

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

            hasAnswer,
            getAnswer,
            getTopics,
            getEntities,
            getActions,

            allTopics,
            allTopicIds,
            topicTimeRanges,

            allRawEntities,
            allEntityIds,
            allEntityNames,
            entityTimeRanges,

            allActions,
            allActionIds,
            actionTimeRanges,
            getTotalMessageLength,

            hasTopics,
            hasEntities,
            hasActions,
            hasHits,
            hasMessages,
        };

    let lastEntities: ScoredItem<CompositeEntity[]> | undefined;

    return response;

    function hasAnswer(): boolean {
        return (
            response.answer !== undefined &&
            response.answer.answer !== undefined &&
            response.answer.answer.length > 0
        );
    }

    function getAnswer(): string {
        return response.answer?.answer ?? "";
    }

    function getTopics(): string[] {
        return uniqueFrom<string, string>(allTopics())!;
    }

    function getEntities(topK?: number | undefined): CompositeEntity[] {
        topK = topK ?? response.topKSettings?.entitiesTopK ?? 3;

        if (lastEntities && lastEntities.score === topK) {
            return lastEntities.item;
        }
        let entities = getTopMergedEntities(allRawEntities(), topK);
        entities ??= [];
        lastEntities = { score: topK, item: entities };
        return entities;
    }

    function getActions(topK?: number | undefined): ActionGroup[] {
        topK = topK ?? response.topKSettings?.actionsTopK ?? 3;
        // Returned ranked by most relevant
        const actionGroups = mergeActions(allActions(), false);
        return topK > 0 ? actionGroups.slice(0, topK) : actionGroups;
    }

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

    function* allEntityIds(): IterableIterator<TEntityId> {
        for (const result of response.entities) {
            if (result.entityIds && result.entityIds.length > 0) {
                for (const id of result.entityIds) {
                    yield id;
                }
            }
        }
    }

    function* allRawEntities(): IterableIterator<ConcreteEntity> {
        for (const result of response.entities) {
            if (result.entities && result.entities.length > 0) {
                for (const entity of result.entities) {
                    yield entity;
                }
            }
        }
    }

    function allEntityNames(): string[] {
        return uniqueFrom<ConcreteEntity, string>(
            allRawEntities(),
            (e) => e.name,
            true,
        )!;
    }

    function entityTimeRanges(): (dateTime.DateRange | undefined)[] {
        return response.entities.length > 0
            ? collections.mapAndFilter(response.entities, (e) =>
                  e.getTemporalRange(),
              )
            : [];
    }

    function topicTimeRanges(): (dateTime.DateRange | undefined)[] {
        return response.topics.length > 0
            ? collections.mapAndFilter(response.topics, (t) =>
                  t.getTemporalRange(),
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
            ? collections.mapAndFilter(response.actions, (a) =>
                  a.getTemporalRange(),
              )
            : [];
    }

    function getTotalMessageLength(): number {
        let length = 0;
        if (response.messages) {
            for (const message of response.messages) {
                length += message.value.value.length;
            }
        }
        return length;
    }

    function hasTopics(): boolean {
        for (const _ of allTopics()) {
            return true;
        }
        return false;
    }

    function hasEntities(): boolean {
        for (const _ of allRawEntities()) {
            return true;
        }
        return false;
    }

    function hasActions(): boolean {
        for (const _ of allActions()) {
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
