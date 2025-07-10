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
import { async } from "typeagent";

/**
 * Execute a natural language search request against the conversation
 * Returns results of the search: any matching knowledge, messages etc
 * @see ../../knowPro/src/search.ts
 * @param context
 * @param {SearchRequest} request Structured request or Named Arguments
 * @param {kp.querySchema.SearchQuery} preTranslatedQuery already have turned request.query into query expressions
 * @returns
 */
export async function execSearchRequest(
    context: KnowproContext,
    request: SearchRequest | string[] | NamedArgs,
    preTranslatedQuery?: kp.querySchema.SearchQuery | undefined,
): Promise<SearchResponse> {
    const conversation = context.ensureConversationLoaded();
    if (shouldParseRequest(request)) {
        request = parseTypedArguments<SearchRequest>(
            request,
            searchRequestDef(),
        );
    }
    const langQuery = request.query.trim(); // Natural language query to run
    if (!langQuery) {
        throw new Error("No query provided");
    }
    const debugContext: AnswerDebugContext = { searchText: langQuery };
    //
    // Set up options  for the search API Call
    //
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
    //
    // We can specify the subset of the conversation to search using a filter
    //
    let langFilter: kp.LanguageSearchFilter | undefined = createLangFilter(
        undefined,
        request,
    );
    //
    // If optional "when" subquery provided, run that query to find messages to scope by
    //
    if (request.when) {
        const whenResult = await scopingTermsFromLanguage(
            context,
            request.when,
        );
        if (!whenResult.success) {
            return { searchResults: error(whenResult.message), debugContext };
        }
        if (whenResult.data) {
            langFilter ??= {};
            langFilter.scopeDefiningTerms = whenResult.data;
            //langFilter.scopeDefiningTerms.booleanOp = "and";
        }
    }

    let searchResults: Result<kp.ConversationSearchResult[]>;
    if (preTranslatedQuery) {
        // Pre-existing query expr for request.query
        const compiledQueries = kp.compileSearchQuery(
            conversation,
            preTranslatedQuery,
            options.compileOptions,
            langFilter,
        );
        const queryResults = await kp.runSearchQueries(
            conversation,
            compiledQueries,
            options,
        );
        debugContext.searchQuery = preTranslatedQuery;
        debugContext.searchQueryExpr = compiledQueries;
        searchResults = success(queryResults.flat());
    } else {
        //
        // Run raw NLP query
        //
        searchResults = await async.getResultWithRetry(() =>
            getLangSearchResult(
                conversation,
                context.queryTranslator,
                langQuery,
                options,
                langFilter,
                debugContext,
            ),
        );
    }

    return { searchResults, debugContext };
}

/**
 * Returns a natural language answer for a natural language question
 *  - Transform the question into queries (@see execSearchRequest above)
 *  - Pass the matched knowledge and messages to a model so it can answer the user's question
 * Note: you can also directly call {}
 * @param context
 * @param {GetAnswerRequest} request
 * @param progressCallback
 * @returns
 */
export async function execGetAnswerRequest(
    context: KnowproContext,
    request: GetAnswerRequest | string[] | NamedArgs,
    progressCallback?: (
        index: number,
        question: string,
        answer: Result<kp.AnswerResponse>,
    ) => void,
): Promise<GetAnswerResponse> {
    // Parse request
    if (shouldParseRequest(request)) {
        request = parseTypedArguments<GetAnswerRequest>(
            request,
            getAnswerRequestDef(),
        );
    }
    //
    // Step 1:
    // Search conversation with the user's query
    //
    const searchResponse = request.searchResponse
        ? request.searchResponse
        : await execSearchRequest(context, request);
    const searchResults = searchResponse.searchResults;
    const response: GetAnswerResponse = {
        searchResponse,
        answerResponses: error("No search matches"),
    };
    if (!searchResults.success) {
        response.answerResponses = error(searchResults.message);
        return response;
    }
    if (!kp.hasConversationResults(searchResults.data)) {
        // Search matched nothing relevant
        return response;
    }
    //
    // Step 2:
    // Use search results to generate a natural language answer
    //
    const answerResponses = await getAnswersForSearchResults(
        context,
        request,
        searchResults.data,
        progressCallback,
        context.retryNoAnswer,
    );
    response.answerResponses = answerResponses;
    return response;
}

/**
 * Multiple query expressions can produce multiple search results
 * Currently, we take each individual search result and generate a separate answer
 * @param context
 * @param request
 * @param searchResults
 * @param progressCallback
 * @returns
 */
async function getAnswersForSearchResults(
    context: KnowproContext,
    request: GetAnswerRequest,
    searchResults: kp.ConversationSearchResult[],
    progressCallback?: (
        index: number,
        question: string,
        answer: Result<kp.AnswerResponse>,
    ) => void,
    retryNoAnswer: boolean = true,
): Promise<Result<kp.AnswerResponse[]>> {
    let answerResponses: kp.AnswerResponse[] = [];
    if (!request.messages) {
        // (Optionally for testing: Don't include raw message text... try answering only with knowledge
        searchResults.forEach((r) => (r.messageMatches = []));
    }
    // Set up answer options
    // Choices are optional
    const choices = request.choices?.split(";");
    const options = createAnswerOptions(request);
    for (let i = 0; i < searchResults.length; ++i) {
        const searchResult = searchResults[i];
        let question = searchResult.rawSearchQuery ?? request.query;
        if (choices && choices.length > 0) {
            question = kp.createMultipleChoiceQuestion(question, choices);
        }
        let answerResult = await async.getResultWithRetry(() => {
            return getAnswerFromSearchResult(
                context,
                request,
                searchResult,
                choices,
                options,
            );
        });
        if (
            retryNoAnswer &&
            answerResult.success &&
            answerResult.data.type === "NoAnswer"
        ) {
            answerResult = await async.getResultWithRetry(() => {
                return getAnswerFromSearchResult(
                    context,
                    request,
                    searchResult,
                    choices,
                    options,
                );
            });
        }
        if (!answerResult.success) {
            return answerResult;
        }
        answerResponses.push(answerResult.data);
        if (progressCallback && request.combineAnswer !== true) {
            progressCallback(i, question, answerResult);
        }
    }
    if (request.combineAnswer === true) {
        const answerResult =
            await context.answerGenerator.combinePartialAnswers(
                request.query,
                answerResponses,
            );
        if (!answerResult.success) {
            return answerResult;
        }
        answerResponses = [answerResult.data];
        if (progressCallback) {
            progressCallback(0, request.query, answerResult);
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
    if (request.fastStop !== undefined) {
        context.answerGenerator.settings.fastStop = request.fastStop;
    }
    try {
        let question = searchResult.rawSearchQuery ?? request.query;
        //
        // Generate an answer from search results
        //
        let answerResult: Result<kp.AnswerResponse>;
        if (choices && choices.length > 0) {
            answerResult = await kp.generateMultipleChoiceAnswer(
                conversation,
                context.answerGenerator,
                question,
                choices,
                searchResult,
                undefined,
                options,
            );
        } else {
            answerResult = await kp.generateAnswer(
                conversation,
                context.answerGenerator,
                question,
                searchResult,
                undefined,
                options,
            );
        }
        return answerResult;
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

async function scopingTermsFromLanguage(
    context: KnowproContext,
    langQuery: string,
    options?: kp.LanguageSearchOptions,
    termsOnly: boolean = true,
): Promise<Result<kp.SearchTermGroup | undefined>> {
    if (termsOnly) {
        return success(context.termParser.getSearchTerms(langQuery));
    }

    const result = await kp.searchQueryExprFromLanguage(
        context.conversation!,
        context.queryTranslator,
        langQuery,
        options,
    );
    if (!result.success) {
        return result;
    }
    //
    // FUTURE: use this is a true sub-query
    //
    const selectExpr = result.data.queryExpressions[0]?.selectExpressions;
    if (selectExpr === undefined || selectExpr.length === 0) {
        return error("No select expr");
    }
    return success(selectExpr[0].searchTermGroup);
}

/**
 * Run a natural language query over a conversation
 * @param {kp.IConversation} conversation
 * @param {kp.SearchQueryTranslator} queryTranslator Typechat translator from language to query
 * @param langQuery Natural language query
 * @param options
 * @param langFilter
 * @param debugContext
 * @returns
 */

export async function getLangSearchResult(
    conversation: kp.IConversation | cm.Memory,
    queryTranslator: kp.SearchQueryTranslator,
    langQuery: string,
    options?: kp.LanguageSearchOptions,
    langFilter?: kp.LanguageSearchFilter,
    debugContext?: kp.LanguageSearchDebugContext,
) {
    /**
     * If the IConversation interface is implemented by a Memory object, call
     * the searchWithLanguage on the memory object. Else use the general purpose
     * searchConversationWithLanguage
     */
    const searchResults =
        conversation instanceof cm.Memory
            ? await conversation.searchWithLanguage(
                  langQuery,
                  options,
                  langFilter,
                  debugContext,
              )
            : await kp.searchConversationWithLanguage(
                  conversation,
                  langQuery,
                  queryTranslator,
                  options,
                  langFilter,
                  debugContext,
              );

    return searchResults;
}
