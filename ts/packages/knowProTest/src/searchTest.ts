// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KnowproContext } from "./knowproContext.js";
import { readJsonFile, writeJsonFile } from "typeagent";
import { error, Result, success } from "typechat";
import { BatchCallback, Comparison } from "./types.js";
import {
    compareArray,
    compareObject,
    getCommandArgs,
    queryError,
} from "./common.js";
import { getLangSearchResult } from "./knowproCommands.js";
import { getBatchFileLines } from "interactive-app";
import { execSearchRequest } from "./knowproCommands.js";
import * as kp from "knowpro";

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
    cb?: BatchCallback<Result<LangSearchResults>>,
    stopOnError: boolean = false,
): Promise<Result<LangSearchResults[]>> {
    const batchLines = getBatchFileLines(batchFilePath);
    const results: LangSearchResults[] = [];
    for (let i = 0; i < batchLines.length; ++i) {
        const cmd = batchLines[i];
        const args = getCommandArgs(cmd);
        if (args.length === 0) {
            continue;
        }
        let response = await getSearchResults(context, args);
        if (response.success) {
            response.data.cmd = cmd;
        } else {
            response = queryError(cmd, response);
        }
        if (cb) {
            cb(response, i, batchLines.length);
        }
        if (response.success) {
            results.push(response.data);
        } else if (stopOnError) {
            return response;
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

function collectLangSearchResults(
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
    cb?: BatchCallback<Result<Comparison<LangSearchResults>>>,
    stopOnError: boolean = false,
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
        let response = await getSearchResults(context, args);
        if (response.success) {
            const actual = response.data;
            const error = compareLangSearchResults(actual, expected);
            let comparisonResult: Comparison<LangSearchResults> = {
                actual,
                expected,
                error,
            };
            results.push(comparisonResult);
            if (cb) {
                cb(success(comparisonResult), i, expectedResults.length);
            }
        } else {
            response = queryError(expected.cmd!, response);
            if (cb) {
                cb(response, i, expectedResults.length);
            }
            if (stopOnError) {
                return response;
            }
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

function compareLangSearchResults(
    lr1: LangSearchResults,
    lr2: LangSearchResults,
): string | undefined {
    let error = compareSearchQuery(lr1.searchQueryExpr, lr2.searchQueryExpr);
    if (error !== undefined && error.length > 0) {
        return error;
    }
    if (lr1.results.length !== lr2.results.length) {
        return `Number results ${lr1.results.length} != ${lr2.results.length}`;
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

function compareSearchQuery(
    s1: kp.querySchema.SearchQuery,
    s2: kp.querySchema.SearchQuery,
): string | undefined {
    if (s1.searchExpressions.length !== s2?.searchExpressions.length) {
        return `searchQuery.searchExpressions.length: ${s1.searchExpressions.length} !== ${s2.searchExpressions.length}`;
    }
    for (let i = 0; i < s1.searchExpressions.length; ++i) {
        const error = compareSearchExpr(
            s1.searchExpressions[i],
            s2.searchExpressions[i],
        );
        if (error !== undefined) {
            return error;
        }
    }
    return undefined;
}

function compareSearchExpr(
    s1: kp.querySchema.SearchExpr,
    s2: kp.querySchema.SearchExpr,
): string | undefined {
    if (s1.filters.length !== s2.filters.length) {
        return `SearchExpr.filters.length: ${s1.filters.length} !== ${s2.filters.length}`;
    }

    for (let i = 0; i < s1.filters.length; ++i) {
        const f1 = s1.filters[i];
        const f2 = s2.filters[i];

        let error = compareObject(
            f1.entitySearchTerms,
            f2.entitySearchTerms,
            "entitySearchTerms",
        );
        if (error !== undefined) {
            return error;
        }
        error = compareObject(
            f1.actionSearchTerm,
            f2.actionSearchTerm,
            "actionSearchTerm",
        );
        if (error !== undefined) {
            return error;
        }
        error = compareObject(f1.searchTerms, f2.searchTerms, "searchTerms");
        if (error !== undefined) {
            return error;
        }
        error = compareObject(f1.timeRange, f2.timeRange, "searchTerms");
        if (error !== undefined) {
            return error;
        }
    }
    return undefined;
}
