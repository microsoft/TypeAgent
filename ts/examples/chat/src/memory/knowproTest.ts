// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { argDestFile, argSourceFile, isJsonEqual } from "../common.js";
import { readBatchFile } from "examples-lib";
import * as kp from "knowpro";
import { getLangSearchResult } from "./knowproCommon.js";
import {
    appendFileNameSuffix,
    changeFileExt,
    getAbsolutePath,
    readJsonFile,
    writeJsonFile,
} from "typeagent";
import { Result, success } from "typechat";
import chalk from "chalk";

/**
 * Test related commands
 */

export async function createKnowproTestCommands(
    context: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    commands.kpTestSearchBatch = searchBatch;
    commands.kpTestBatch = testBatch;
    commands.kpLoadTest = loadTest;

    function searchBatchDef(): CommandMetadata {
        return {
            description:
                "Run a batch file of language search queries and save results",
            args: {
                srcPath: argSourceFile(),
            },
            options: {
                destPath: argDestFile(),
            },
        };
    }
    commands.kpTestSearchBatch.metadata = searchBatchDef();
    async function searchBatch(args: string[]) {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args, searchBatchDef());
        const searchBatch = readBatchFile(namedArgs.srcPath);
        const destPath =
            namedArgs.destPath ??
            changeFileExt(namedArgs.srcPath, ".json", "_results");
        const results: LangSearchResults[] = [];
        let i = 0;
        for await (const searchResult of runLangSearchBatch(
            context.conversation!,
            context.queryTranslator,
            searchBatch,
        )) {
            context.printer.writeLine(`${i + 1}. ${searchBatch[i]}`);
            if (!searchResult.success) {
                context.printer.writeError(searchResult.message);
                return;
            }
            results.push(searchResult.data);
            ++i;
        }
        if (destPath) {
            context.printer.writeLine(`Saving results to ${destPath}`);
            await writeJsonFile(destPath, results);
        }
    }

    function testBatchDef(): CommandMetadata {
        return {
            description: "Test previously query + saved batch results",
            args: {
                srcPath: argSourceFile(),
            },
            options: {
                startAt: argNum("Start at this query", 0),
                count: argNum("Number to run"),
            },
        };
    }
    commands.kpTestBatch.metadata = testBatchDef();
    async function testBatch(args: string[]) {
        if (!ensureConversationLoaded()) {
            return;
        }

        const namedArgs = parseNamedArguments(args, testBatchDef());
        const baseResults = await readJsonFile<LangSearchResults[]>(
            namedArgs.srcPath,
        );
        if (!baseResults || baseResults.length === 0) {
            context.printer.writeError("No results in file");
            return;
        }
        const errors: LangSearchResults[] = [];
        let searchBatch = baseResults.map((r) => r.searchText);
        const startAt = namedArgs.startAt ?? 0;
        const count = namedArgs.count ?? searchBatch.length;
        searchBatch = searchBatch.slice(startAt, startAt + count);
        let i = 0;
        for await (const searchResult of runLangSearchBatch(
            context.conversation!,
            context.queryTranslator,
            searchBatch,
        )) {
            const searchText = searchBatch[i];
            const baseResult = baseResults[i + startAt];
            context.printer.writeLine(`${i + 1}. ${searchText}`);
            if (searchResult.success) {
                let error = compareSearchExpr(
                    searchResult.data.searchQueryExpr,
                    baseResult.searchQueryExpr,
                );
                if (error !== undefined && error.length > 0) {
                    context.printer.writeInColor(
                        chalk.gray,
                        `[${error}]: ${searchText}`,
                    );
                    context.printer.writeJsonInColor(
                        chalk.gray,
                        searchResult.data.searchQueryExpr,
                    );
                    context.printer.writeJsonInColor(
                        chalk.gray,
                        baseResult.searchQueryExpr,
                    );
                }
                error = compareLangSearchResults(searchResult.data, baseResult);
                if (error !== undefined && error.length > 0) {
                    context.printer.writeError(`[${error}]: ${searchText}`);
                    const errorResult = { ...searchResult.data, error };
                    errors.push(errorResult);
                }
            } else {
                context.printer.writeError(searchResult.message);
            }
            ++i;
        }
        if (errors.length > 0) {
            const destPath = appendFileNameSuffix(namedArgs.srcPath, "_errors");
            await writeJsonFile(destPath, errors);
        }
        context.printer.writeLine(`${i} tests, ${errors.length} errors`);
    }

    function loadTestDef(): CommandMetadata {
        return {
            description: "Load index used by unit tests",
            options: {
                secondaryIndex: argBool("Use secondary indexes", true),
            },
        };
    }
    commands.kpLoadTest.metadata = loadTestDef();
    async function loadTest(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, loadTestDef());
        let samplePath = "../../../../packages/knowPro/test/data    ";
        samplePath = getAbsolutePath(samplePath, import.meta.url);

        const cData = await kp.readConversationDataFromFile(
            samplePath,
            "Episode_53_AdrianTchaikovsky_index",
            1536,
        );
        if (cData) {
            const conversation = await kp.createConversationFromData(
                cData,
                kp.createConversationSettings(),
            );
            if (!namedArgs.secondaryIndex) {
                conversation.secondaryIndexes = undefined;
            }
            context.conversation = conversation;
        }
    }

    function ensureConversationLoaded(): kp.IConversation | undefined {
        if (context.conversation) {
            return context.conversation;
        }
        context.printer.writeError("No conversation loaded");
        return undefined;
    }

    return;
}

type LangSearchResults = {
    searchText: string;
    searchQueryExpr: kp.querySchema.SearchQuery;
    results: LangSearchResult[];
    error?: string | undefined;
};

type LangSearchResult = {
    messageMatches: kp.MessageOrdinal[];
    entityMatches?: kp.SemanticRefOrdinal[] | undefined;
    topicMatches?: kp.SemanticRefOrdinal[] | undefined;
    actionMatches?: kp.SemanticRefOrdinal[] | undefined;
};

async function* runLangSearchBatch(
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
    return undefined;
}
