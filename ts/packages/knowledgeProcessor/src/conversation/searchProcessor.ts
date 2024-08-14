// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SearchOptions } from "typeagent";
import {
    Conversation,
    ConversationSearchOptions,
    SearchActionResponse,
    SearchResponse,
} from "./conversation.js";
import {
    Filter,
    GetAnswerAction,
    SearchAction,
} from "./knowledgeSearchSchema.js";
import { SetOp } from "../setOperations.js";
import {
    KnowledgeActionTranslator,
    createKnowledgeActionTranslator,
} from "./knowledgeActions.js";
import { AnswerGenerator, createAnswerGenerator } from "./answerGenerator.js";
import { PromptSection } from "typechat";
import { ChatModel } from "aiclient";

export type SearchProcessingOptions = {
    maxMatches: number;
    minScore: number;
    maxMessages: number;
    fallbackSearch?: SearchOptions | undefined;
    includeTimeRange: boolean;
    combinationSetOp?: SetOp;
    includeActions?: boolean;
    actionPreprocess?: (action: SearchAction) => void;
};

export interface ConversationSearchProcessor {
    actions: KnowledgeActionTranslator;
    answers: AnswerGenerator;
    search(
        query: string,
        options: SearchProcessingOptions,
    ): Promise<SearchActionResponse | undefined>;

    buildContext(
        options: SearchProcessingOptions,
    ): Promise<PromptSection[] | undefined>;
}

export function createSearchProcessor(
    conversation: Conversation,
    actionModel: ChatModel,
    answerModel: ChatModel,
    includeActions: boolean = true,
): ConversationSearchProcessor {
    const actions = createKnowledgeActionTranslator(
        actionModel,
        includeActions,
    );
    const answers = createAnswerGenerator(answerModel);

    return {
        actions,
        answers,
        search,
        buildContext,
    };

    async function search(
        query: string,
        options: SearchProcessingOptions,
    ): Promise<SearchActionResponse | undefined> {
        const actionResult = await actions.translateSearch(
            query,
            await buildContext(options),
        );
        if (!actionResult.success) {
            return undefined;
        }
        let action = actionResult.data;
        if (options.actionPreprocess) {
            options.actionPreprocess(action);
        }
        const rr: SearchActionResponse = {
            action,
        };
        switch (rr.action.actionName) {
            case "unknown":
                break;
            case "getAnswer":
                rr.response = await handleGetAnswers(query, rr.action, options);
                break;
        }

        return rr;
    }

    async function buildContext(
        options: SearchProcessingOptions,
    ): Promise<PromptSection[] | undefined> {
        const timeRange = options.includeTimeRange
            ? await conversation.messages.getTimeRange()
            : undefined;
        return timeRange
            ? [
                  {
                      role: "system",
                      content: `ONLY IF user request explicitly asks for time ranges, THEN use the CONVERSATION TIME RANGE: "${timeRange.startDate} to ${timeRange.stopDate}"`,
                  },
              ]
            : undefined;
    }

    async function handleGetAnswers(
        query: string,
        action: GetAnswerAction,
        options: SearchProcessingOptions,
    ): Promise<SearchResponse> {
        const responseType = action.parameters.responseType;
        const topLevelTopicSummary = isTopicSummaryRequest(action);
        const topicLevel = topLevelTopicSummary ? 2 : 1;
        const searchOptions: ConversationSearchOptions = {
            entity: {
                maxMatches: options.maxMatches,
                minScore: options.minScore,
                matchNameToType: true,
                combinationSetOp: options.combinationSetOp,
                loadEntities: true,
            },
            topic: {
                maxMatches: topLevelTopicSummary
                    ? Number.MAX_SAFE_INTEGER
                    : options.maxMatches,
                minScore: options.minScore,
                loadTopics:
                    responseType === "Answer" || responseType === "Topics",
            },
            topicLevel,
            loadMessages: responseType === "Answer", //topicLevel === 1,
        };
        if (options.includeActions) {
            searchOptions.action = {
                maxMatches: options.maxMatches,
                minScore: options.minScore,
                verbSearchOptions: {
                    maxMatches: 1,
                    minScore: options.minScore,
                },
                loadActions:
                    responseType === "Answer" || responseType === "Actions",
            };
            if (searchOptions.action.loadActions) {
                searchOptions.loadMessages = true;
            }
        }

        adjustRequest(query, action, searchOptions);

        const response = await conversation.search(
            action.parameters.filters,
            searchOptions,
        );
        await adjustResponse(query, action, response, options);
        response.answer = await answers.generateAnswer(
            query,
            action,
            response,
            false,
        );
        if (response.answer?.type === "NoAnswer" && options.fallbackSearch) {
            //response.entities = [];
            //response.topics = [];
            // Try an approximate match
            const sResult = await conversation.searchMessages(
                query,
                options.fallbackSearch,
            );
            if (sResult) {
                response.messageIds = sResult.messageIds;
                response.messages = sResult.messages;
                response.answer = await answers.generateAnswer(
                    query,
                    action,
                    response,
                    true,
                );
            }
        }
        return response;
    }

    function isTopicSummaryRequest(action: GetAnswerAction): boolean {
        const params = action.parameters;
        return (
            params.responseType === "Topics" &&
            !params.filters.some((f) => f.filterType !== "Topic")
        );
    }

    function ensureTopicFilter(query: string, filters: Filter[]): void {
        for (const filter of filters) {
            if (filter.filterType === "Topic") {
                if (filter.timeRange || filter.topics) {
                    return;
                }
                filter.topics ??= query;
                return;
            }
        }
        filters.push({
            filterType: "Topic",
            topics: query,
        });
    }

    function ensureEntityFilter(query: string, filters: Filter[]): void {
        for (const filter of filters) {
            if (filter.filterType === "Entity") {
                if (filter.timeRange || filter.name || filter.type) {
                    return;
                }
            }
        }
        filters.push({
            filterType: "Entity",
            name: query,
        });
    }

    function adjustRequest(
        query: string,
        action: GetAnswerAction,
        searchOptions: ConversationSearchOptions,
    ) {
        if (searchOptions.topic.loadTopics) {
            ensureTopicFilter(
                isTopicSummaryRequest(action) ? "*" : query,
                action.parameters.filters,
            );
        }
        if (searchOptions.entity.loadEntities) {
            ensureEntityFilter(query, action.parameters.filters);
        }
    }

    async function adjustResponse(
        query: string,
        action: GetAnswerAction,
        response: SearchResponse,
        options: SearchProcessingOptions,
    ): Promise<void> {
        if (
            action.parameters.responseType == "Topics" &&
            !responseHasTopics(response)
        ) {
            await ensureEntitiesLoaded(response);
        }
        if (
            response.messages &&
            response.messages.length > options.maxMessages
        ) {
            const result = await conversation.searchMessages(
                query,
                {
                    maxMatches: options.maxMessages,
                },
                response.messageIds,
            );
            if (result) {
                response.messageIds = result.messageIds;
                response.messages = result.messages;
            } else {
                response.messageIds = response.messageIds!.slice(
                    0,
                    options.maxMessages,
                );
                response.messages = response.messages.slice(
                    0,
                    options.maxMessages,
                );
            }
        }
    }

    async function ensureEntitiesLoaded(
        response: SearchResponse,
    ): Promise<void> {
        const entityIndex = await conversation.getEntityIndex();
        for (const result of response.entities) {
            if (result.entityIds && !result.entities) {
                result.entities = await entityIndex.getEntities(
                    result.entityIds,
                );
            }
        }
    }

    function responseHasTopics(response: SearchResponse): boolean {
        for (const topic of response.allTopics()) {
            return true;
        }
        return false;
    }
}
