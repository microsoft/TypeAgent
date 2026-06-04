// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AIProjectClient } from "@azure/ai-projects";
import { bingWithGrounding } from "./index.js";
import * as agents from "./agents.js";
//import registerDebug from "debug";

//const debug = registerDebug("typeagent:azure-ai-foundry:aliasKeywordExtractor");

export type openPhrases = {
    urls: SearchResult[];
    searchQueryRun: string;
};

export type SearchResult = {
    pageTitle: string;
    pageUrl: string;
    openPhrases: string[];
};

/*
 * Attempts to retrive the URL resolution agent from the AI project and creates it if necessary
 */
export async function ensureOpenPhraseGeneratorAgent(
    groundingConfig: bingWithGrounding.ApiSettings,
    project: AIProjectClient,
): Promise<string> {
    // tool connection ids are in the format: /subscriptions/<SUBSCRIPTION ID>/resourceGroups/<RESOURCE GROUP>/providers/Microsoft.CognitiveServices/accounts/<AI FOUNDRY RESOURCE>/projects/<PROJECT NAME>/connections/<CONNECTION NAME>>

    return await agents.ensureAgent(project, {
        model: "gpt-4.1",
        name: "TypeAgent-OpenPhraseGenerator",
        description: "Auto created Phrase Generator Agent",
        temperature: 0.01,
        instructions: `
There is a system that uses the command "Open" to open URLs in the browser.  You generate terms that can be cached such that when the user says "open apple" it goes to "https://apple.com".  You generate alternate terms/keywords/phrases/descriptions a user could use to invoke the same site. 

You are provided a domain that you generate open phrases for by doing a Bing search for 'site:domain' where the domain is the one provided.

Generate a SearchResult for each of the top 5 search results. Do not include "open" in the openPhrase statement since that is implied.

For example: apple.com could be:

- open apple
- open iphone maker
- open ipad maker

Try to create between 3 and 5 phrases for each URL. Do not include the URL in the result set for non-English web sites.  Also, do not include URLs in the results if it is not an obvious URL that a user would say an open command for. For example, don't return CDN URLs, API urls, or URLs whose search results indicate other issues.

Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:

interface Response {
  urls: SearchResult[];
  searchQueryRun: string;
}

type SearchResult = {
  pageTitle: string;
  pageUrl: string;
  openPhrases: string[];
}         
            `,
        tools: [agents.bingGroundingTool(groundingConfig.connectionId!)],
    });
}

/**
 * Generates open phrases for the top N search results for a given domain
 * @param domain - The domain to do a search against
 * @param groundingConfig - The bing with grounding config
 * @returns - The open phrases that were generated for the domain search results
 */
export async function createOpenPhrasesForDomain(
    domain: string,
    groundingConfig: bingWithGrounding.ApiSettings,
    project: AIProjectClient,
): Promise<openPhrases | undefined | null> {
    const agentName = await ensureOpenPhraseGeneratorAgent(
        groundingConfig,
        project,
    );

    if (!agentName) {
        throw new Error(
            "No agent found for extracting web site aliases. Please check your configuration.",
        );
    }

    try {
        const result = await agents.runAgent(project, agentName, domain);

        if (result.contentFiltered) {
            return null;
        }

        return agents.parseJsonResponse<openPhrases>(result.text);
    } catch (e) {
        console.error(`Error resolving URL with search: ${e}`);
        return undefined;
    }
}
