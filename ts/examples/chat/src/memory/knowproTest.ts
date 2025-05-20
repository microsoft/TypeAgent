// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { argDestFile, argSourceFile } from "../common.js";
import { readBatchFile } from "examples-lib";
import * as kp from "knowpro";
import { getLangSearchResult } from "./knowproCommon.js";
import { changeFileExt, writeJsonFile } from "typeagent";

/**
 * Test related commands
 */

export async function createKnowproTestCommands(
    context: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    commands.kpTestSearchBatch = searchBatch;

    function searchBatchDef(): CommandMetadata {
        return {
            description: "Run a batch file of language search queries",
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
        const results: LangSearchResult[] = [];
        for (let i = 0; i < searchBatch.length; ++i) {
            const searchText = searchBatch[i];
            context.printer.writeLine(`${i + 1}. ${searchText}`);
            const debugContext: kp.LanguageSearchDebugContext = {};
            const searchResult = await getLangSearchResult(
                context.conversation!,
                context.queryTranslator,
                searchText,
                undefined,
                undefined,
                debugContext,
            );
            if (!searchResult.success) {
                context.printer.writeError(searchResult.message);
                return;
            }
            results.push({
                searchText,
                searchQueryExpr: debugContext.searchQueryExpr,
                results: searchResult.data,
            });
        }
        if (destPath) {
            context.printer.writeLine(`Saving results to ${destPath}`);
            await writeJsonFile(destPath, results);
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

type LangSearchResult = {
    searchText: string;
    searchQueryExpr?: kp.SearchQueryExpr[] | undefined;
    results: kp.ConversationSearchResult[];
};
