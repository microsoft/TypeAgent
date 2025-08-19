// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandler } from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as ms from "memory-storage";

export class AzureSearchMemory {
    public index: ms.azSearch.AzSearchIndex<Record<string, any>>;

    constructor(settings: ms.azSearch.AzSearchSettings) {
        this.index = new ms.azSearch.AzSearchIndex(settings);
    }
}

type AzureMemoryContext = {
    memory?: AzureSearchMemory | undefined;
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

    async function search(args: string[]) {
        const memory = ensureMemory();
        const results = await memory.index.searchClient.search("type:book");
        context.printer.writeJson(results);
    }

    function ensureMemory(): AzureSearchMemory {
        if (!context.memory) {
            context.memory = new AzureSearchMemory(
                ms.azSearch.createAzSearchSettings("default"),
            );
        }
        return context.memory;
    }

    return commands;
}
