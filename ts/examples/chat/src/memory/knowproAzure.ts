// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandler, CommandMetadata } from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as ms from "memory-storage";

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
    commands.azSearch = search;
    commands.azEnsureIndex = ensureIndex;
    commands.azIngest = ingestKnowledge;

    async function search(args: string[]) {
        const memory = ensureMemory();
        const results = await memory.searchClient.search("type:book");
        context.printer.writeJson(results);
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
        const semanticRefs = conversation.semanticRefs!.getSlice(0, 10);
        for (const sr of semanticRefs) {
            await memory.addSemanticRef(sr);
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
