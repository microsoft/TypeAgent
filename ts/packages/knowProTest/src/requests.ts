// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandMetadata, arg, argBool, argNum } from "interactive-app";
import * as kp from "knowpro";
import { Result } from "typechat";

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

export interface SearchResponse {
    debugContext: AnswerDebugContext;
    searchResults: Result<kp.ConversationSearchResult[]>;
}

export interface GetAnswerRequest extends SearchRequest {
    messages?: boolean | undefined;
    fastStop?: boolean | undefined;
    knowledgeTopK?: number | undefined;
    choices?: string | undefined;
}

export interface GetAnswerResponse {
    searchResponse: SearchResponse;
    answerResponses: Result<kp.AnswerResponse[]>;
}

export function getAnswerRequestDef(
    searchDef?: CommandMetadata,
    knowledgeTopK = 50,
): CommandMetadata {
    const def = searchDef ?? searchRequestDef();
    def.description = "Get answers to natural language questions";
    def.options ??= {};
    def.options.messages = argBool("Include messages", true);
    def.options.fastStop = argBool(
        "Ignore messages if knowledge produces answers",
        true,
    );
    def.options!.knowledgeTopK = argNum(
        "How many top K knowledge matches",
        knowledgeTopK,
    );
    def.options.choices = arg("Answer choices, separated by ';'");
    return def;
}
export interface AnswerDebugContext extends kp.LanguageSearchDebugContext {
    searchText: string;
}
