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
    parseNamedArguments,
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
import { collections } from "typeagent";

type AzureMemoryContext = {
    semanticRefIndex?: ms.azSearch.AzSemanticRefIndex | undefined;
    termIndex?: ms.azSearch.AzTermsVectorIndex | undefined;
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
    commands.azSemanticIndexEnsure = ensureSemanticRefIndex;
    commands.azSemanticIndexIngest = ingestKnowledge;
    commands.azTermIndexEnsure = ensureTermIndex;
    commands.azTermIndexIngest = ingestTermEmbeddings;

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
        const semanticRefIndex = getSemanticRefIndex();
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
        const [azQuery, results] = await semanticRefIndex.search(
            queryTerms,
            whenFilter,
        );
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
    commands.azSemanticIndexIngest.metadata = ingestKnowledgeDef();
    async function ingestKnowledge(args: string[], io: InteractiveIo) {
        const semanticRefIndex = getSemanticRefIndex();
        const conversation = await getConversationForIngest(
            io,
            semanticRefIndex,
        );
        if (!conversation) {
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

    function semanticIndexEnsureDef(): CommandMetadata {
        return {
            description:
                "Ensure semantic ref index is created on Azure. Ingestion is separate",
        };
    }
    commands.azSemanticIndexEnsure.metadata = semanticIndexEnsureDef();
    async function ensureSemanticRefIndex(args: string[]) {
        const searchIndex = getSemanticRefIndex();
        const success = await searchIndex.ensureExists();
        if (success) {
            context.printer.writeLine("Success");
        } else {
            context.printer.writeError("searchIndex.ensureExists failed");
        }
    }

    function ingestTermEmbeddingsDef(): CommandMetadata {
        return {
            description:
                "Ingest related terms from currently loaded conversation",
            options: {
                batchSize: argNum("Batch size", 16),
            },
        };
    }
    commands.azTermIndexIngest.metadata = ingestTermEmbeddingsDef();
    async function ingestTermEmbeddings(args: string[], io: InteractiveIo) {
        const azTermsIndex = getTermsIndex();
        const conversation = await getConversationForIngest(io, azTermsIndex);
        if (!conversation) {
            return;
        }
        const relatedTermsIndex =
            conversation.secondaryIndexes?.termToRelatedTermsIndex?.fuzzyIndex;
        if (
            !relatedTermsIndex ||
            !(relatedTermsIndex instanceof kp.TermEmbeddingIndex)
        ) {
            context.printer.writeError("No terms embedding index");
            return;
        }
        const namedArgs = parseNamedArguments(args, ingestTermEmbeddingsDef());
        const batchSize: number = namedArgs.batchSize;
        let termData = relatedTermsIndex.serialize();
        const progress = new ProgressBar(
            context.printer,
            Math.ceil(termData.textItems.length / batchSize),
        );
        for (const textBatch of collections.slices(
            termData.textItems,
            batchSize,
        )) {
            let termBatch: ms.azSearch.TermDoc[] = [];
            for (let i = 0; i < textBatch.value.length; ++i) {
                termBatch.push({
                    termId: (i + textBatch.startAt).toString(),
                    term: textBatch.value[i],
                    embedding: ms.azSearch.embeddingToVector(
                        termData.embeddings[i + textBatch.startAt],
                    ),
                });
            }
            const indexingResults = await azTermsIndex.addTerms(termBatch);
            printIndexResults(indexingResults);
            progress.advance();
        }
        progress.complete();
    }

    function termIndexEnsureDef(): CommandMetadata {
        return {
            description:
                "Ensure related term index created on Azure. Ingestion is separate",
        };
    }
    commands.azTermIndexEnsure.metadata = termIndexEnsureDef();
    async function ensureTermIndex(args: string[]) {
        const relatedTermsIndex = getTermsIndex();
        const success = await relatedTermsIndex.ensureExists();
        if (success) {
            context.printer.writeLine("Success");
        } else {
            context.printer.writeError("searchIndex.ensureExists failed");
        }
    }

    function getSemanticRefIndex(
        indexName = "semantic-ref-index",
    ): ms.azSearch.AzSemanticRefIndex {
        if (!context.semanticRefIndex) {
            context.semanticRefIndex = new ms.azSearch.AzSemanticRefIndex(
                ms.azSearch.createAzSearchSettings(indexName),
            );
        }
        return context.semanticRefIndex;
    }

    function getTermsIndex(
        indexName = "terms-index",
    ): ms.azSearch.AzTermsVectorIndex {
        if (!context.termIndex) {
            context.termIndex = new ms.azSearch.AzTermsVectorIndex(
                ms.azSearch.createAzVectorSearchSettings(indexName, 1536),
            );
        }
        return context.termIndex;
    }

    async function addSemanticRefs(
        semanticRefs: kp.SemanticRef[],
        timestamp?: string,
    ) {
        const searchIndex = getSemanticRefIndex();
        const indexingResults = await searchIndex.addSemanticRefs(
            semanticRefs,
            timestamp,
        );
        printIndexResults(indexingResults);
    }

    function printIndexResults(indexingResults: any[]) {
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

    async function getConversationForIngest(
        io: InteractiveIo,
        searchIndex: ms.azSearch.AzSearchIndex<any>,
    ): Promise<kp.IConversation | undefined> {
        const conversation = kpContext.conversation;
        if (!conversation) {
            context.printer.writeError("No loaded conversation");
            return undefined;
        }
        if (
            !(await askYesNo(
                io,
                `Are you sure you want to ingest term embeddings from ${conversation.nameTag} into ${searchIndex.settings.indexName}?`,
            ))
        ) {
            return undefined;
        }
        return conversation;
    }
    return commands;
}
