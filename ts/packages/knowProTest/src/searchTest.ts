// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { KnowproContext } from "./knowproContext.js";
import { readJsonFile, writeJsonFile } from "typeagent";
import { error, Result, success } from "typechat";
import { BatchCallback, Comparison } from "./types.js";
import { compareArray, getCommandArgs, getLangSearchResult } from "./common.js";
import { getBatchFileLines } from "interactive-app";
import { execSearchRequest } from "./knowproCommands.js";

export type LangSearchResults = {
    searchText: string;
    cmd?: string | undefined;
    searchQueryExpr: kp.querySchema.SearchQuery;
    results: LangSearchResult[];
};

export type LangSearchResult = {
    messageMatches: kp.MessageOrdinal[];
    entityMatches?: kp.SemanticRefOrdinal[] | undefined;
    topicMatches?: kp.SemanticRefOrdinal[] | undefined;
    actionMatches?: kp.SemanticRefOrdinal[] | undefined;
};

export async function runSearchBatch(
    context: KnowproContext,
    batchFilePath: string,
    destFilePath?: string,
    cb?: BatchCallback<LangSearchResults>,
): Promise<Result<LangSearchResults[]>> {
    const batchLines = getBatchFileLines(batchFilePath);
    const results: LangSearchResults[] = [];
    for (let i = 0; i < batchLines.length; ++i) {
        const cmd = batchLines[i];
        const args = getCommandArgs(cmd);
        if (args.length === 0) {
            continue;
        }
        const response = await getSearchResults(context, args);
        if (!response.success) {
            return response;
        }
        response.data.cmd = cmd;
        results.push(response.data);
        if (cb) {
            cb(response.data, i, batchLines.length);
        }
    }
    if (destFilePath) {
        await writeJsonFile(destFilePath, results);
    }
    return success(results);
}

async function getSearchResults(
    context: KnowproContext,
    args: string[],
): Promise<Result<LangSearchResults>> {
    const response = await execSearchRequest(context, args);
    if (!response.searchResults.success) {
        return response.searchResults;
    }
    const results = collectLangSearchResults(
        response.debugContext.searchText,
        response.searchResults.data,
        response.debugContext,
    );
    return success(results);
}

export function collectLangSearchResults(
    searchText: string,
    searchResults: kp.ConversationSearchResult[],
    debugContext: kp.LanguageSearchDebugContext,
): LangSearchResults {
    return {
        searchText,
        searchQueryExpr: debugContext.searchQuery!,
        results: searchResults.map((cr) => {
            const lr: LangSearchResult = {
                messageMatches: cr.messageMatches.map((m) => m.messageOrdinal),
            };
            getKnowledgeResults(cr, lr);
            return lr;
        }),
    };
}

export async function verifyLangSearchResultsBatch(
    context: KnowproContext,
    batchFilePath: string,
    cb?: BatchCallback<Comparison<LangSearchResults>>,
): Promise<Result<Comparison<LangSearchResults>[]>> {
    const expectedResults =
        await readJsonFile<LangSearchResults[]>(batchFilePath);
    if (!expectedResults || expectedResults.length === 0) {
        return error("No results in file");
    }

    const results: Comparison<LangSearchResults>[] = [];
    for (let i = 0; i < expectedResults.length; ++i) {
        const expected = expectedResults[i];
        const args = getCommandArgs(expected.cmd);
        if (args.length === 0) {
            continue;
        }
        const response = await getSearchResults(context, args);
        if (!response.success) {
            return response;
        }
        const actual = response.data;
        const error = compareLangSearchResults(actual, expected);
        let comparisonResult: Comparison<LangSearchResults> = {
            actual,
            expected,
            error,
        };
        results.push(comparisonResult);
        if (cb) {
            cb(comparisonResult, i, expectedResults.length);
        }
    }
    return success(results);
}

export async function* runLangSearchBatch(
    conversation: kp.IConversation,
    queryTranslator: kp.SearchQueryTranslator,
    searchQueries: Iterable<string>,
): AsyncIterableIterator<Result<LangSearchResults>> {
    for (const searchText of searchQueries) {
        const debugContext: kp.LanguageSearchDebugContext = {};
        const searchResult = await getLangSearchResult(
            conversation,
            queryTranslator,
            searchText,
            undefined,
            undefined,
            debugContext,
        );
        if (searchResult.success) {
            yield success({
                searchText,
                searchQueryExpr: debugContext.searchQuery!,
                results: searchResult.data.map((cr) => {
                    const lr: LangSearchResult = {
                        messageMatches: cr.messageMatches.map(
                            (m) => m.messageOrdinal,
                        ),
                    };
                    getKnowledgeResults(cr, lr);
                    return lr;
                }),
            });
        } else {
            yield searchResult;
        }
    }

    function getKnowledgeResults(
        cr: kp.ConversationSearchResult,
        lr: LangSearchResult,
    ) {
        lr.entityMatches = getKnowledgeResult(cr, "entity");
        lr.topicMatches = getKnowledgeResult(cr, "topic");
        lr.actionMatches = getKnowledgeResult(cr, "action");
    }

    function getKnowledgeResult(
        cr: kp.ConversationSearchResult,
        type: kp.KnowledgeType,
    ) {
        return cr.knowledgeMatches
            .get(type)
            ?.semanticRefMatches.map((sr) => sr.semanticRefOrdinal);
    }
}

function getKnowledgeResults(
    cr: kp.ConversationSearchResult,
    lr: LangSearchResult,
) {
    lr.entityMatches = getMatchedSemanticRefOrdinals(cr, "entity");
    lr.topicMatches = getMatchedSemanticRefOrdinals(cr, "topic");
    lr.actionMatches = getMatchedSemanticRefOrdinals(cr, "action");
}

function getMatchedSemanticRefOrdinals(
    cr: kp.ConversationSearchResult,
    type: kp.KnowledgeType,
) {
    return cr.knowledgeMatches
        .get(type)
        ?.semanticRefMatches.map((sr) => sr.semanticRefOrdinal);
}

/*
function compareSearchExpr(
    s1: kp.querySchema.SearchQuery,
    s2: kp.querySchema.SearchQuery,
): string | undefined {
    if (s1.searchExpressions.length !== s2?.searchExpressions.length) {
        return "searchExpr Length";
    }
    for (let i = 0; i < s1.searchExpressions.length; ++i) {
        if (
            !isJsonEqual(
                s1.searchExpressions[i].filters,
                s2.searchExpressions[i].filters,
            )
        ) {
            return "searchExpr Filter";
        }
    }
    return undefined;
}
*/

function compareLangSearchResults(
    lr1: LangSearchResults,
    lr2: LangSearchResults,
): string | undefined {
    if (lr1.results.length !== lr2.results.length) {
        return "array";
    }
    for (let i = 0; i < lr1.results.length; ++i) {
        const error = compareLangSearchResult(lr1.results[i], lr2.results[i]);
        if (error !== undefined && error.length > 0) {
            return error;
        }
    }
    return undefined;
}

function compareLangSearchResult(
    lr1: LangSearchResult,
    lr2: LangSearchResult,
): string | undefined {
    /*
    if (!isJsonEqual(lr1.messageMatches, lr2.messageMatches)) {
        return "message";
    }
    if (!isJsonEqual(lr1.entityMatches, lr2.entityMatches)) {
        return "entity";
    }
    if (!isJsonEqual(lr1.topicMatches, lr2.topicMatches)) {
        return "topic";
    }
    if (!isJsonEqual(lr1.actionMatches, lr2.actionMatches)) {
        return "action";
    }
        */
    let error = compareArray("message", lr1.messageMatches, lr2.messageMatches);
    if (error !== undefined) {
        return error;
    }
    error = compareArray("entity", lr1.entityMatches, lr2.entityMatches);
    if (error !== undefined) {
        return error;
    }
    error = compareArray("topic", lr1.topicMatches, lr2.topicMatches);
    if (error !== undefined) {
        return error;
    }
    error = compareArray("action", lr1.actionMatches, lr2.actionMatches);
    if (error !== undefined) {
        return error;
    }
    return undefined;
}
