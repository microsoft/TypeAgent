// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SearchOptions, lookupAnswersOnWeb } from "typeagent";
import {
    Conversation,
    ConversationSearchOptions,
    SearchActionResponse,
    SearchResponse,
    SearchTermsActionResponse,
    createSearchResponse,
} from "./conversation.js";
import {
    Filter,
    GetAnswerAction,
    SearchAction,
    WebLookupAction,
    ResponseStyle,
} from "./knowledgeSearchWebSchema.js";
import { SetOp } from "../setOperations.js";
import {
    KnowledgeSearchMode,
    KnowledgeActionTranslator,
    createKnowledgeActionTranslator,
} from "./knowledgeActions.js";
import { AnswerGenerator, createAnswerGenerator } from "./answerGenerator.js";
import { PromptSection } from "typechat";
import { ChatModel } from "aiclient";
import { GetAnswerWithTermsAction } from "./knowledgeTermSearchSchema.js";

export type SearchProcessingOptions = {
    maxMatches: number;
    minScore: number;
    maxMessages: number;
    fallbackSearch?: SearchOptions | undefined;
    includeTimeRange: boolean;
    combinationSetOp?: SetOp;
    includeActions?: boolean;
    actionPreprocess?: (action: any) => void;
};

export interface ConversationSearchProcessor {
    searchMode: KnowledgeSearchMode;
    actions: KnowledgeActionTranslator;
    answers: AnswerGenerator;
    search(
        query: string,
        options: SearchProcessingOptions,
    ): Promise<SearchActionResponse | undefined>;
    searchTerms(
        query: string,
        options: SearchProcessingOptions,
    ): Promise<SearchTermsActionResponse | undefined>;
    buildContext(
        options: SearchProcessingOptions,
    ): Promise<PromptSection[] | undefined>;
}

export function createSearchProcessor(
    conversation: Conversation,
    actionModel: ChatModel,
    answerModel: ChatModel,
    searchMode: KnowledgeSearchMode = KnowledgeSearchMode.Default,
): ConversationSearchProcessor {
    const searchTranslator = createKnowledgeActionTranslator(
        actionModel,
        searchMode,
    );
    const searchTranslator_NoActions = createKnowledgeActionTranslator(
        actionModel,
        KnowledgeSearchMode.Default,
    );
    const answers = createAnswerGenerator(answerModel);

    return {
        searchMode,
        actions: searchTranslator,
        answers,
        search,
        searchTerms,
        buildContext,
    };

    async function search(
        query: string,
        options: SearchProcessingOptions,
    ): Promise<SearchActionResponse | undefined> {
        const context = await buildContext(options);
        const actionResult = options.includeActions
            ? await searchTranslator.translateSearch(query, context)
            : await searchTranslator_NoActions.translateSearch(query, context);
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
            case "webLookup":
                rr.response = await handleLookup(query, rr.action, options);
                break;
        }

        return rr;
    }

    async function searchTerms(
        query: string,
        options: SearchProcessingOptions,
    ): Promise<SearchTermsActionResponse | undefined> {
        const context = await buildContext(options);
        const actionResult = await searchTranslator.translateSearchTerms(
            query,
            context,
        );
        if (!actionResult.success) {
            return undefined;
        }
        let action = actionResult.data;
        if (options.actionPreprocess) {
            options.actionPreprocess(action);
        }
        const rr: SearchTermsActionResponse = {
            action,
        };
        if (rr.action.actionName !== "unknown") {
            rr.response = await handleGetAnswersTerms(
                query,
                rr.action,
                options,
            );
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
            loadMessages: responseType === "Answer" || hasActionFilter(action),
        };
        if (options.includeActions) {
            searchOptions.action = {
                maxMatches: options.maxMatches,
                minScore: options.minScore,
                verbSearchOptions: {
                    maxMatches: 1,
                    minScore: options.minScore,
                },
                loadActions: false,
            };
        }

        adjustRequest(query, action, searchOptions);

        const response = await conversation.search(
            action.parameters.filters,
            searchOptions,
        );
        await adjustResponse(query, action, response, searchOptions, options);
        response.answer = await answers.generateAnswer(
            query,
            action.parameters.responseStyle,
            response,
            false,
        );
        if (response.answer?.type === "NoAnswer" && options.fallbackSearch) {
            await fallbackSearch(
                query,
                action.parameters.responseStyle,
                response,
                options.fallbackSearch,
            );
        }
        return response;
    }

    async function handleGetAnswersTerms(
        query: string,
        action: GetAnswerWithTermsAction,
        options: SearchProcessingOptions,
    ): Promise<SearchResponse> {
        const topLevelTopicSummary = isSummaryRequest(action);
        const topicLevel = topLevelTopicSummary ? 2 : 1;
        let style: ResponseStyle | undefined; //"Paragraph";
        const searchOptions: ConversationSearchOptions = {
            entity: {
                maxMatches: options.maxMatches,
                minScore: options.minScore,
                matchNameToType: true,
                loadEntities: true,
            },
            topic: {
                maxMatches: topLevelTopicSummary
                    ? Number.MAX_SAFE_INTEGER
                    : options.maxMatches,
                minScore: options.minScore,
                loadTopics: true,
            },
            topicLevel,
            loadMessages: true,
        };
        if (options.includeActions) {
            searchOptions.action = {
                maxMatches: options.maxMatches,
                minScore: options.minScore,
                verbSearchOptions: {
                    maxMatches: 1,
                    minScore: options.minScore,
                },
                loadActions: false,
            };
        }
        const response = await conversation.searchTerms(
            action.parameters.filters,
            searchOptions,
        );
        await adjustMessages(query, response, searchOptions, options);
        response.answer = await answers.generateAnswer(
            query,
            style,
            response,
            false,
        );
        if (response.answer?.type === "NoAnswer" && options.fallbackSearch) {
            await fallbackSearch(
                query,
                style,
                response,
                options.fallbackSearch,
            );
        }
        return response;
    }

    async function handleLookup(
        query: string,
        lookup: WebLookupAction,
        options: SearchProcessingOptions,
    ): Promise<SearchResponse> {
        const answer = await lookupAnswersOnWeb(
            answerModel,
            query,
            options.maxMatches,
            {
                maxCharsPerChunk: 4096,
                maxTextLengthToSearch: 4096 * 16,
                rewriteForReadability: false,
            },
        );
        const response = createSearchResponse(1);
        response.answer = {
            type: answer.answer.type === "NoAnswer" ? "NoAnswer" : "Answered",
            answer: answer.answer.answer,
        };
        return response;
    }

    function isTopicSummaryRequest(action: GetAnswerAction): boolean {
        const params = action.parameters;
        return (
            params.responseType === "Topics" &&
            !params.filters.some((f) => f.filterType !== "Topic")
        );
    }

    function isSummaryRequest(action: GetAnswerWithTermsAction): boolean {
        const filters = action.parameters.filters;
        for (const filter of filters) {
            if (filter.terms && filter.terms.length > 0) {
                return false;
            }
        }
        return true;
    }

    function hasActionFilter(action: GetAnswerAction): boolean {
        const params = action.parameters;
        return !params.filters.some((f) => f.filterType !== "Action");
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
        options: ConversationSearchOptions,
        processingOptions: SearchProcessingOptions,
    ): Promise<void> {
        if (
            action.parameters.responseType == "Topics" &&
            !responseHasTopics(response)
        ) {
            await ensureEntitiesLoaded(response);
        }
        await adjustMessages(query, response, options, processingOptions);
    }

    async function adjustMessages(
        query: string,
        response: SearchResponse,
        options: ConversationSearchOptions,
        processingOptions: SearchProcessingOptions,
    ): Promise<void> {
        if (
            (!response.messages &&
                options.loadMessages &&
                processingOptions.fallbackSearch) ||
            (response.messages &&
                response.messages.length > processingOptions.maxMessages)
        ) {
            const result = await conversation.searchMessages(
                query,
                processingOptions,
                response.messageIds,
            );
            if (result) {
                response.messageIds = result.messageIds;
                response.messages = result.messages;
            } else if (response.messages) {
                response.messageIds = response.messageIds!.slice(
                    0,
                    processingOptions.maxMessages,
                );
                response.messages = response.messages.slice(
                    0,
                    processingOptions.maxMessages,
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

    async function fallbackSearch(
        query: string,
        style: ResponseStyle | undefined,
        response: SearchResponse,
        options: SearchOptions,
    ) {
        const sResult = await conversation.searchMessages(query, options);
        if (sResult) {
            response.messageIds = sResult.messageIds;
            response.messages = sResult.messages;
            response.answer = await answers.generateAnswer(
                query,
                style,
                response,
                true,
            );
        }
    }
}
