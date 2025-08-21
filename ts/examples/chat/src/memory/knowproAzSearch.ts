// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    argNum,
    askYesNo,
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    NamedArgs,
    ProgressBar,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as ms from "memory-storage";
import * as kp from "knowpro";
import chalk from "chalk";
import { parseFreeAndNamedArguments } from "../common.js";
import { createSearchGroup, dateRangeFromNamedArgs } from "./knowproCommon.js";
import { batchSemanticRefsByMessage } from "./knowproCommon.js";
import { split } from "knowledge-processor";

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
            description:
                "Search Azure semantic-ref-index by manually providing terms as arguments",
            options: {
                query: arg(
                    "Plain text or Lucene query syntax. Phrase matches: use single quotes instead of double quotes",
                ),
                andTerms: argBool("'And' all terms. Default is 'or", false),
                startDate: arg("Starting at this ISO date"),
                endDate: arg("Ending at this date ISO date"),
                ordinalRange: arg("Ordinal range <start>:<end>"),
                ktype: arg("Knowledge type: entity | topic | action | tag"),
            },
        };
    }
    commands.azSearch.metadata = azSearchDef();
    async function azSearch(args: string[]) {
        const commandDef = azSearchDef();
        let [termArgs, namedArgs] = parseFreeAndNamedArguments(
            args,
            commandDef,
        );
        const memory = ensureMemory();
        let query: string = namedArgs.query;
        let queryTerms: string | kp.SearchTermGroup;
        if (query) {
            // User provided a raw lucene query.. but with single quotes
            //
            queryTerms = query.replaceAll(/'/g, '"');
        } else {
            queryTerms = createSearchGroup(
                termArgs,
                namedArgs,
                commandDef,
                namedArgs.andTerms && namedArgs.andTerms === true
                    ? "and"
                    : "or",
            );
        }
        const whenFilter = whenFilterFromNamedArgs(namedArgs);
        const [azQuery, results] = await memory.search(queryTerms, whenFilter);
        context.printer.writeLineInColor(chalk.cyan, azQuery.searchQuery);
        if (azQuery.filter) {
            context.printer.writeLineInColor(
                chalk.cyan,
                `$filter: ${azQuery.filter}`,
            );
        }
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
    async function ingestKnowledge(args: string[], io: InteractiveIo) {
        const conversation = kpContext.conversation;
        if (!conversation) {
            context.printer.writeError("No loaded conversation");
            return;
        }
        const memory = ensureMemory();
        if (
            !(await askYesNo(
                io,
                `Are you sure you want to ingest knowledge from ${conversation.nameTag} into ${memory.settings.indexName}?`,
            ))
        ) {
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

    function whenFilterFromNamedArgs(
        namedArgs: NamedArgs,
    ): kp.WhenFilter | undefined {
        let when: kp.WhenFilter | undefined;
        const dateRange = dateRangeFromNamedArgs(namedArgs);
        if (namedArgs.ktype) {
            when ??= {};
            when.knowledgeType = namedArgs.ktype;
        }
        if (dateRange) {
            when ??= {};
            when.dateRange = dateRange;
        }
        if (namedArgs.ordinalRange) {
            const range = stringToRange(namedArgs.ordinalRange);
            if (range) {
                when ??= {};
                when.textRangesInScope = [range];
            }
        }
        return when;
    }

    function stringToRange(value: string): kp.TextRange | undefined {
        const rangeValue = split(value, ":", {
            trim: true,
            removeEmpty: true,
        });
        if (rangeValue.length === 0) {
            return undefined;
        }
        const textRange: kp.TextRange = {
            start: { messageOrdinal: Number.parseInt(rangeValue[0]) },
        };
        if (rangeValue.length > 1) {
            textRange.end = { messageOrdinal: Number.parseInt(rangeValue[1]) };
        }
        return textRange;
    }

    return commands;
}
