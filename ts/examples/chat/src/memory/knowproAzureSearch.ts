// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
    ProgressBar,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as ms from "memory-storage";
import * as kp from "knowpro";
import chalk from "chalk";
import { propertyTermsFromNamedArgs } from "../common.js";
import { batchSemanticRefsByMessage } from "./knowproCommon.js";

type AzureMemoryContext = {
    memory?: ms.azSearch.AzSemanticRefIndex | undefined;
    printer: KnowProPrinter;
};

export async function createKnowproAzureCommands(
    kpContext: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    const context: AzureMemoryContext = {
        printer: kpContext.printer,
    };
    commands.azSearch = azSearch;
    commands.azEnsureIndex = ensureIndex;
    commands.azIngest = ingestKnowledge;

    function azSearchDef(): CommandMetadata {
        return {
            description: "Azure Search",
            options: {
                query: arg("Plain text or Lucene query syntax"),
                andTerms: argBool("'And' all terms. Default is 'or", false),
            },
        };
    }
    commands.azSearch.metadata = azSearchDef();
    async function azSearch(args: string[]) {
        const commandDef = azSearchDef();
        const namedArgs = parseNamedArguments(args, commandDef);
        const memory = ensureMemory();
        let query: string = namedArgs.query;
        let queryTerms: string | kp.SearchTermGroup;
        if (query) {
            queryTerms = query.replaceAll(/'/g, '"');
        } else {
            const termGroup = propertyTermsFromNamedArgs(namedArgs, commandDef);
            queryTerms = namedArgs.andTerms
                ? kp.createAndTermGroup(...termGroup)
                : kp.createOrTermGroup(...termGroup);
        }

        const [queryText, results] = await memory.search(queryTerms);
        context.printer.writeLineInColor(chalk.cyan, queryText);
        context.printer.writeLine(`${results.length} matches`);
        for (const result of results) {
            context.printer.writeJson(result);
        }
    }

    function ingestKnowledgeDef(): CommandMetadata {
        return {
            description: "Ingest knowledge from currently loaded conversation",
            options: {
                batchSize: argNum("Batch size", 16),
            },
        };
    }
    commands.azIngest.metadata = ingestKnowledgeDef();
    async function ingestKnowledge(args: string[]) {
        const conversation = kpContext.conversation;
        if (!conversation) {
            context.printer.writeError("No loaded conversation");
            return;
        }

        //const namedArgs = parseNamedArguments(args, ingestKnowledgeDef());
        const semanticRefs = conversation.semanticRefs!;
        const messages = conversation.messages;
        const progress = new ProgressBar(context.printer, messages.length);
        for (const [messageOrdinal, batch] of batchSemanticRefsByMessage(
            semanticRefs,
        )) {
            progress.advance();
            const message = messages.get(messageOrdinal);
            await addSemanticRefs(batch, message.timestamp);
        }
        progress.complete();
    }

    function ensureIndexDef(): CommandMetadata {
        return {
            description: "Ensure memory index",
        };
    }
    commands.azEnsureIndex.metadata = ensureIndexDef();
    async function ensureIndex(args: string[]) {
        const memory = await ensureMemory();
        await memory.ensure();
    }

    function ensureMemory(
        indexName = "semantic-ref-index",
    ): ms.azSearch.AzSemanticRefIndex {
        if (!context.memory) {
            context.memory = new ms.azSearch.AzSemanticRefIndex(
                ms.azSearch.createAzSearchSettings(indexName),
            );
        }
        return context.memory;
    }

    async function addSemanticRefs(
        semanticRefs: kp.SemanticRef[],
        timestamp?: string,
    ) {
        const memory = ensureMemory();
        const indexingResults = await memory.addSemanticRefs(
            semanticRefs,
            timestamp,
        );
        for (const result of indexingResults) {
            switch (result.statusCode) {
                default:
                    let errorMessage =
                        result.errorMessage ?? result.statusCode.toString();
                    context.printer.writeError(
                        `FAILED: ordinal: ${result.key} [${errorMessage}]`,
                    );
                    break;
                case 200:
                case 201:
                    break;
            }
        }
    }
    return commands;
}
