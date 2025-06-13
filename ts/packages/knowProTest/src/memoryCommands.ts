// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as kp from "knowpro";
import * as cm from "conversation-memory";
import { Result } from "typechat";
import { KnowproContext } from "./knowproContext.js";
import {
    arg,
    argBool,
    argNum,
    CommandMetadata,
    NamedArgs,
    parseTypedArguments,
} from "interactive-app";

export interface SearchRequest {
    // Required
    query: string;
    // Optional
    applyScope?: boolean | undefined;
    charBudget?: number | undefined;
    exact?: boolean | undefined;
    exactScope?: boolean | undefined;
    fallback?: boolean | undefined;
    ktype: kp.KnowledgeType;
    messageTopK?: number | undefined;
    tag?: string | undefined;
    thread?: string | undefined;
}

export function searchRequestDef(): CommandMetadata {
    return {
        description: "Search using natural language",
        args: {
            query: arg("Search query"),
        },
        options: {
            applyScope: argBool("Apply scopes", true),
            charBudget: argNum("Maximum characters in budget"),
            exact: argBool("Exact match only. No related terms", false),
            exactScope: argBool("Exact scope", false),
            fallback: argBool("Fallback to text similarity matching", true),
            ktype: arg("Knowledge type"),
            messageTopK: argNum("How many top K message matches", 25),
            tag: arg("Tag to filter by"),
            thread: arg("Thread description"),
        },
    };
}

export interface AnswerDebugContext extends kp.LanguageSearchDebugContext {
    searchText: string;
}

export async function execSearch(
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

export function execSearchCommand(
    context: KnowproContext,
    args: string[] | NamedArgs,
): Promise<[Result<kp.ConversationSearchResult[]>, AnswerDebugContext]> {
    const request = parseTypedArguments<SearchRequest>(
        args,
        searchRequestDef(),
    );
    return execSearch(context, request);
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
