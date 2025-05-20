// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
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
    readJsonFile,
    writeJsonFile,
} from "typeagent";
import { Result, success } from "typechat";

/**
 * Test related commands
 */

export async function createKnowproTestCommands(
    context: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    commands.kpTestSearchBatch = searchBatch;
    commands.kpTestBatch = testBatch;

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
            description: "Test previously saved batch results",
            args: {
                srcPath: argSourceFile(),
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
        let i = 0;
        let searchBatch = baseResults.map((r) => r.searchText);
        for await (const searchResult of runLangSearchBatch(
            context.conversation!,
            context.queryTranslator,
            searchBatch,
        )) {
            const searchText = searchBatch[i];
            context.printer.writeLine(`${i + 1}. ${searchText}`);
            if (!searchResult.success) {
                context.printer.writeError(searchResult.message);
                return;
            }
            if (!compareLangSearchResults(searchResult.data, baseResults[i])) {
                context.printer.writeError(searchText);
                errors.push(searchResult.data);
            }
            ++i;
        }
        if (errors.length > 0) {
            const destPath = appendFileNameSuffix(namedArgs.srcPath, "_errors");
            await writeJsonFile(destPath, errors);
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
    searchQueryExpr?: kp.SearchQueryExpr[] | undefined;
    results: LangSearchResult[];
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
                searchQueryExpr: debugContext.searchQueryExpr,
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

function compareLangSearchResults(
    lr1: LangSearchResults,
    lr2: LangSearchResults,
) {
    if (lr1.results.length !== lr2.results.length) {
        return false;
    }
    for (let i = 0; i < lr1.results.length; ++i) {
        if (!compareLangSearchResult(lr1.results[i], lr2.results[i])) {
            return false;
        }
    }
    return true;
}

function compareLangSearchResult(
    lr1: LangSearchResult,
    lr2: LangSearchResult,
): boolean {
    return (
        isJsonEqual(lr1.messageMatches, lr2.messageMatches) &&
        isJsonEqual(lr1.entityMatches, lr2.entityMatches) &&
        isJsonEqual(lr1.topicMatches, lr2.topicMatches) &&
        isJsonEqual(lr1.actionMatches, lr2.actionMatches)
    );
}
