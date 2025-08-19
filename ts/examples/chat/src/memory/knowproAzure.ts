// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as azs from "@azure/search-documents";
import { createDefaultCredential, getEnvSetting } from "aiclient";
import { CommandHandler } from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";

export enum EnvVars {
    AZURE_SEARCH_ENDPOINT = "AZURE_SEARCH_ENDPOINT",
}

export class AzureSearchMemory {
    public searchClient: azs.SearchClient<Record<string, any>>;

    constructor(name: string) {
        this.searchClient = createAzureSearchClient(name);
    }
}

function getAzureSearchEndpoint(): string {
    return getEnvSetting(process.env, EnvVars.AZURE_SEARCH_ENDPOINT);
}

/**
 * Utility to create an Azure SearchClient using DefaultAzureCredential
 */
export function createAzureSearchClient(
    indexName: string,
): azs.SearchClient<Record<string, any>> {
    return new azs.SearchClient<Record<string, any>>(
        getAzureSearchEndpoint(),
        indexName,
        createDefaultCredential(),
    );
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
        const results = await memory.searchClient.search(
            "book + 'Great Gatsby'",
        );
        context.printer.writeJson(results);
    }

    function ensureMemory(): AzureSearchMemory {
        if (!context.memory) {
            context.memory = new AzureSearchMemory("default");
        }
        return context.memory;
    }

    return commands;
}
