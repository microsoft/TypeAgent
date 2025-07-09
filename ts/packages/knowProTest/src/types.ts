// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandMetadata, arg, argBool, argNum } from "interactive-app";
import * as kp from "knowpro";
import { Result } from "typechat";
import { argSourceFile } from "./common.js";

/**
 * A Parameterized search request to run against the index
 * Includes several "test" flags that are mapped to their lower level equivalents
 * @see searchRequestDef for defaults, and explanations for what the fields do
 */
export interface SearchRequest {
    // Required args
    query: string;

    // Optional args

    // Search processing settings
    applyScope?: boolean | undefined; // If false, don't infer scopes. Useful for debugging
    charBudget?: number | undefined;
    exact?: boolean | undefined;
    exactScope?: boolean | undefined;
    fallback?: boolean | undefined; //
    messageTopK?: number | undefined;
    // Scope options
    ktype: kp.KnowledgeType;
    tag?: string | undefined;
    thread?: string | undefined;
    when?: string;
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
            tag: arg("Scope matches to messages with this tag"),
            thread: arg(
                "Thread description: scope matches to the thread best matching this description",
            ),
            when: arg("Sub-query to scope matches (early experimental)"),
        },
    };
}

export interface SearchResponse {
    debugContext: AnswerDebugContext;
    searchResults: Result<kp.ConversationSearchResult[]>;
}

export interface GetAnswerRequest extends SearchRequest {
    /**
     * If false, do not include message text when generating answers.
     */
    messages?: boolean | undefined;
    fastStop?: boolean | undefined;
    knowledgeTopK?: number | undefined;
    choices?: string | undefined;
    /**
     * Use an existing searchResponse for this request to generate an answer
     * If not provided, will run a search using the properties set for SearchRequest
     */
    searchResponse?: SearchResponse | undefined;
    /**
     * If searchResponse.searchResults.length > 1, use answers for individual
     * search results as partial answers... and then combine them using the LLM
     */
    combineAnswer?: boolean | undefined;
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
    def.options.choices = arg(
        "Multiple choice answer: answer choices, separated by ';'",
    );
    def.options.combineAnswer = argBool(
        "Combine results of multiple search results into a single answer",
        false,
    );
    return def;
}

export interface PodcastLoadRequest {
    filePath?: string | undefined;
    name?: string | undefined;
}

export function podcastLoadDef(): CommandMetadata {
    return {
        description: "Load existing Podcast memory",
        options: {
            filePath: argSourceFile(),
            name: arg("Podcast name"),
        },
    };
}

export interface AnswerDebugContext extends kp.LanguageSearchDebugContext {
    searchText: string;
}

export type Comparison<T> = {
    actual: T;
    expected: T;
    error?: string | undefined;
};

export type SimilarityComparison<T> = {
    actual: T;
    expected: T;
    score: number;
};

export type BatchCallback<T> = (value: T, index: number, total: number) => void;
