// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AIProjectClient } from "@azure/ai-projects";
import { bingWithGrounding } from "./index.js";
import * as agents from "./agents.js";
import {
    Agent,
    MessageContentUnion,
    ThreadMessage,
    ToolUtility,
} from "@azure/ai-agents";
//import registerDebug from "debug";

//const debug = registerDebug("typeagent:azure-ai-foundry:aliasKeywordExtractor");

export type openPhrases = {
  urls: SearchResult[];
  searchQueryRun: string;
}

export type SearchResult = {
  pageTitle: string;
  pageUrl: string;
  openPhrases: string[];
}

/*
 * Attempts to retrive the URL resolution agent from the AI project and creates it if necessary
 */
export async function ensureOpenPhraseGeneratorAgent(
    groundingConfig: bingWithGrounding.ApiSettings,
    project: AIProjectClient,
): Promise<Agent | undefined> {
    // tool connection ids are in the format: /subscriptions/<SUBSCRIPTION ID>/resourceGroups/<RESOURCE GROUP>/providers/Microsoft.CognitiveServices/accounts/<AI FOUNDRY RESOURCE>/projects/<PROJECT NAME>/connections/<CONNECTION NAME>>

    return await agents.ensureAgent(
        groundingConfig.openPhraseGeneratorAgentId!,
        project,
        {
            model: "gpt-41",
            name: "TypeAgent_OpenPhraseGenerator",
            description: "Auto created Phrase Generator Agent",
            temperature: 0.01,
            instructions: `
There is a system that uses the command "Open" to open URLs in the browser.  You generate terms that can be cached such that when the user says "open apple" it goes to "https://apple.com".  You generate alternate terms/keywords/phrases/descriptions a user could use to invoke the same site. 

You are provided a domain that you generate open phrases for by doing a Bing search for \`site:domain\` where the domain is the one provided.

Generate a SearchResult for each of the top 20 search results. Do not include "open" in the openPhrase statement since that is implied.

For example: apple.com could be:

- open apple
- open iphone maker
- open ipad maker

Try to create between 5 and 10 phrases for each URL.

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
            tools: [
                ToolUtility.createBingGroundingTool([
                    {
                        connectionId: groundingConfig.connectionId!,
                    },
                ]).definition,
            ],
        },
    );
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
    project: AIProjectClient
): Promise<openPhrases | undefined | null> {
    const agent = await ensureOpenPhraseGeneratorAgent(
        groundingConfig,
        project,
    );
    let inCompleteReason;
    let retVal: openPhrases | undefined | null;

    if (!agent) {
        throw new Error(
            "No agent found for extracting web site aliases. Please check your configuration.",
        );
    }

    try {
        // create the thread
        const thread = await project.agents.threads.create();

        // add the request to the thread
        await project.agents.messages.create(
                            thread.id,
                            "user",
                            domain,
                        );        

        // Create run
        const run = await project.agents.runs.createAndPoll(
            thread.id,
            agent.id,
            {
                pollingOptions: {
                    intervalInMs: 1000,
                },
                onResponse: (response): void => {
                    console.debug(
                        `Received response with status: ${response.status}`,
                    );

                    const pb: any = response.parsedBody;
                    if (pb?.incomplete_details?.reason) {
                        inCompleteReason = pb.incomplete_details.reason;
                        console.warn(
                            `Run incomplete due to: ${inCompleteReason}`,
                        );
                    }
                },
            },
        );

        const msgs: ThreadMessage[] = [];
        if (run.status === "completed") {
            if (run.completedAt) {
                // Retrieve messages
                const messages = await project.agents.messages.list(
                    thread.id,
                    {
                        order: "asc",
                    },
                );

                // accumulate assistant messages
                for await (const m of messages) {
                    if (m.role === "assistant") {
                        // TODO: handle multi-modal content
                        const content: MessageContentUnion | undefined =
                            m.content.find(
                                (c) => c.type === "text" && "text" in c,
                            );
                        if (content) {
                            msgs.push(m);
                            let txt: string = (content as any).text
                                .value as string;
                            txt = txt
                                .replaceAll("```json", "")
                                .replaceAll("```", "");
                            retVal = JSON.parse(
                                txt,
                            ) as openPhrases;
                        }
                    }
                }
            }
        }

        // delete the thread we just created since we are currently one and done
        project.agents.threads.delete(thread.id);
    } catch (e) {
        console.error(`Error resolving URL with search: ${e}`);

        if (inCompleteReason === "content_filter") {
            retVal = null;
        } else {
            retVal = undefined;
        }
    }

    // return assistant messages
    return retVal;
}