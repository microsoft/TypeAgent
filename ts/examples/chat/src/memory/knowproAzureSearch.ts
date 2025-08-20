// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as ms from "memory-storage";
import * as kp from "knowpro";
import chalk from "chalk";
import { propertyTermsFromNamedArgs } from "../common.js";

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

    commands.azIngest.metadata =
        "Ingest knowledge from currently loaded conversation";
    async function ingestKnowledge(args: string[]) {
        const conversation = kpContext.conversation;
        if (!conversation) {
            context.printer.writeError("No loaded conversation");
            return;
        }

        const memory = await ensureMemory();
        const semanticRefs = conversation.semanticRefs!;
        for (const sr of semanticRefs) {
            if (sr.knowledgeType === "entity") {
                context.printer.writeSemanticRef(sr);
                await memory.addSemanticRef(sr);
            }
        }
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

    function ensureMemory(): ms.azSearch.AzSemanticRefIndex {
        if (!context.memory) {
            context.memory = new ms.azSearch.AzSemanticRefIndex(
                ms.azSearch.createAzSearchSettings("knowledge"),
            );
        }
        return context.memory;
    }

    return commands;
}
