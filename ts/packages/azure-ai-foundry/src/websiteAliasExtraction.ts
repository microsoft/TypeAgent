// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AIProjectClient } from "@azure/ai-projects";
import { bingWithGrounding } from "./index.js";
import * as agents from "./agents.js";
import { urlResolutionAction } from "./urlResolver.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:azure-ai-foundry:aliasKeywordExtractor");

export type extractedAliases = {
    site: string;
    brandedKeyWords: string[];
    topRankingKeywords: string[];
    extractedKeywordsByClick: string[];
};

/*
 * Attempts to retrive the URL resolution agent from the AI project and creates it if necessary
 */
export async function ensureKeywordExtractorAgent(
    groundingConfig: bingWithGrounding.ApiSettings,
    project: AIProjectClient,
): Promise<string> {
    // tool connection ids are in the format: /subscriptions/<SUBSCRIPTION ID>/resourceGroups/<RESOURCE GROUP>/providers/Microsoft.CognitiveServices/accounts/<AI FOUNDRY RESOURCE>/projects/<PROJECT NAME>/connections/<CONNECTION NAME>>

    return await agents.ensureAgent(project, {
        model: "gpt-4o",
        name: "TypeAgent-AliasKeywordExtractor",
        description: "Auto created Alias Keyword Extractor Agent",
        temperature: 0.01,
        instructions: `
You extract the Keywords identified in the supplied HTML.

Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:

interface Response {
  site: string;
  brandedKeyWords: string[];
  topRankingKeywords: string[],
  extractedKeywordsByClick: string[]
}`,
        tools: [agents.bingGroundingTool(groundingConfig.connectionId!)],
    });
}

// TODO: IMPLEMENT
export async function extractAliasesForURL(
    site: string,
    groundingConfig: bingWithGrounding.ApiSettings,
): Promise<string | undefined | null> {
    let retVal: string | undefined | null = site;
    const project = agents.getProject(groundingConfig.endpoint!);

    const agentName = await ensureKeywordExtractorAgent(
        groundingConfig,
        project,
    );

    if (!agentName) {
        throw new Error(
            "No agent found for Bing with Grounding. Please check your configuration.",
        );
    }

    try {
        const result = await agents.runAgent(project, agentName, site);

        if (result.contentFiltered) {
            return null;
        }

        const url = agents.parseJsonResponse<urlResolutionAction>(result.text);
        if (url) {
            retVal = url.url;
        }
    } catch (e) {
        debug(`Error resolving URL with search: ${e}`);
        retVal = undefined;
    }

    return retVal;
}
