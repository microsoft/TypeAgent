// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as cm from "conversation-memory";
import { KnowproContext } from "./knowproContext.js";
import { NamedArgs, parseTypedArguments } from "interactive-app";
import {
    AnswerDebugContext,
    GetAnswerRequest,
    getAnswerRequestDef,
    GetAnswerResponse,
    SearchRequest,
    searchRequestDef,
    SearchResponse,
} from "./types.js";
import { shouldParseRequest } from "./common.js";
import { error, Result, success } from "typechat";

export type BatchCallback<T> = (value: T, index: number, total: number) => void;

export async function execSearchRequest(
    context: KnowproContext,
    request: string[] | NamedArgs | SearchRequest,
): Promise<SearchResponse> {
    const conversation = context.ensureConversationLoaded();
    if (shouldParseRequest(request)) {
        request = parseTypedArguments<SearchRequest>(
            request,
            searchRequestDef(),
        );
    }
    const searchText = request.query;
    const debugContext: AnswerDebugContext = { searchText };

    const options: kp.LanguageSearchOptions = {
        ...createSearchOptions(request),
        compileOptions: {
            exactScope: request.exactScope,
            applyScope: request.applyScope,
        },
    };
    options.exactMatch = request.exact;
    if (request.fallback) {
        options.fallbackRagOptions = {
            maxMessageMatches: options.maxMessageMatches,
            maxCharsInBudget: options.maxCharsInBudget,
            thresholdScore: 0.7,
        };
    }
    const langFilter = createLangFilter(undefined, request);
    const searchResults =
        conversation instanceof cm.Memory
            ? await conversation.searchWithLanguage(
                  searchText,
                  options,
                  langFilter,
                  debugContext,
              )
            : await kp.searchConversationWithLanguage(
                  conversation,
                  searchText,
                  context.queryTranslator,
                  options,
                  langFilter,
                  debugContext,
              );

    return { searchResults, debugContext };
}

export async function execGetAnswerRequest(
    context: KnowproContext,
    request: string[] | NamedArgs | GetAnswerRequest,
    progressCallback?: (
        index: number,
        question: string,
        answer: Result<kp.AnswerResponse>,
    ) => void,
): Promise<GetAnswerResponse> {
    if (shouldParseRequest(request)) {
        request = parseTypedArguments<GetAnswerRequest>(
            request,
            getAnswerRequestDef(),
        );
    }
    const searchResponse = await execSearchRequest(context, request);
    const searchResults = searchResponse.searchResults;
    const response: GetAnswerResponse = {
        searchResponse,
        answerResponses: error("Not initialized"),
    };
    if (!searchResults.success) {
        return response;
    }
    if (!kp.hasConversationResults(searchResults.data)) {
        return response;
    }
    const answerResponses = await execGetAnswersForSearchResults(
        context,
        request,
        searchResults.data,
        progressCallback,
    );
    response.answerResponses = answerResponses;
    return response;
}

export async function execGetAnswersForSearchResults(
    context: KnowproContext,
    request: GetAnswerRequest,
    searchResults: kp.ConversationSearchResult[],
    progressCallback?: (
        index: number,
        question: string,
        answer: Result<kp.AnswerResponse>,
    ) => void,
): Promise<Result<kp.AnswerResponse[]>> {
    let answerResponses: kp.AnswerResponse[] = [];
    if (!request.messages) {
        // Don't include raw message text... try answering only with knowledge
        searchResults.forEach((r) => (r.messageMatches = []));
    }
    const choices = request.choices?.split(";");
    const options = createAnswerOptions(request);
    for (let i = 0; i < searchResults.length; ++i) {
        const searchResult = searchResults[i];
        let question = searchResult.rawSearchQuery ?? request.query;
        if (choices && choices.length > 0) {
            question = kp.createMultipleChoiceQuestion(question, choices);
        }
        const answerResult = await getAnswerFromSearchResult(
            context,
            request,
            searchResult,
            choices,
            options,
        );
        if (!answerResult.success) {
            return answerResult;
        }
        answerResponses.push(answerResult.data);
        if (progressCallback) {
            progressCallback(i, question, answerResult);
        }
    }
    return success(answerResponses);
}

async function getAnswerFromSearchResult(
    context: KnowproContext,
    request: GetAnswerRequest,
    searchResult: kp.ConversationSearchResult,
    choices: string[] | undefined,
    options: kp.AnswerContextOptions,
): Promise<Result<kp.AnswerResponse>> {
    const conversation = context.ensureConversationLoaded();
    const fastStopSav = context.answerGenerator.settings.fastStop;
    if (request.fastStop) {
        context.answerGenerator.settings.fastStop = request.fastStop;
    }
    try {
        let question = searchResult.rawSearchQuery ?? request.query;
        if (choices && choices.length > 0) {
            question = kp.createMultipleChoiceQuestion(question, choices);
        }
        return await kp.generateAnswer(
            conversation,
            context.answerGenerator,
            question,
            searchResult,
            undefined,
            options,
        );
    } finally {
        context.answerGenerator.settings.fastStop = fastStopSav;
    }
}

function createLangFilter(
    when: kp.WhenFilter | undefined,
    request: SearchRequest,
): kp.LanguageSearchFilter | undefined {
    if (request.ktype) {
        when ??= {};
        when.knowledgeType = request.ktype;
    }
    if (request.tag) {
        when ??= {};
        when.tags = [request.tag];
    }
    if (request.thread) {
        when ??= {};
        when.threadDescription = request.thread;
    }
    return when;
}

function createSearchOptions(request: SearchRequest): kp.SearchOptions {
    let options = kp.createSearchOptions();
    options.exactMatch = request.exact;
    options.maxMessageMatches = request.messageTopK;
    options.maxCharsInBudget = request.charBudget;
    return options;
}

function createAnswerOptions(
    namedArgs: GetAnswerRequest,
): kp.AnswerContextOptions {
    let topK = namedArgs.knowledgeTopK;
    if (topK === undefined) {
        return {};
    }
    const options: kp.AnswerContextOptions = {
        entitiesTopK: topK,
        topicsTopK: topK,
    };
    return options;
}
