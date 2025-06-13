// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as kp from "knowpro";
import * as cm from "conversation-memory";
import { Result } from "typechat";
import { KnowproContext } from "./knowproContext.js";

export interface SearchRequest {
    query: string;
    ktype: kp.KnowledgeType;
    fallback?: boolean | undefined;
    tag?: string | undefined;
    thread?: string | undefined;
    exact?: boolean | undefined;
    exactScope?: boolean | undefined;
    applyScope?: boolean | undefined;
    messageTopK?: number | undefined;
    charBudget?: number | undefined;
}

export interface AnswerDebugContext extends kp.LanguageSearchDebugContext {
    searchText: string;
}

export async function runSearchRequest(
    context: KnowproContext,
    request: SearchRequest,
): Promise<[Result<kp.ConversationSearchResult[]>, AnswerDebugContext]> {
    const conversation = context.ensureConversationLoaded();
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

    return [searchResults, debugContext];
}

export interface AnswerRequest extends SearchRequest {}

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
