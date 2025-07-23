// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AIProjectClient } from "@azure/ai-projects";
import { bingWithGrounding } from "./index.js";
import * as agents from "./agents.js";
import { Agent, MessageContentUnion, ThreadMessage, ToolUtility } from "@azure/ai-agents";
import { DefaultAzureCredential } from "@azure/identity";
import { urlResolutionAction } from "./urlResolver.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:azure-ai-foundry:aliasKeywordExtractor");

export type extractedAliases = {
  site: string;
  brandedKeyWords: string[];
  topRankingKeywords: string[],
  extractedKeywordsByClick: string[]
}

/*
 * Attempts to retrive the URL resolution agent from the AI project and creates it if necessary
 */
export async function ensureKeywordExtractorAgent(
    groundingConfig: bingWithGrounding.ApiSettings,
    project: AIProjectClient,
): Promise<Agent | undefined> {
    // tool connection ids are in the format: /subscriptions/<SUBSCRIPTION ID>/resourceGroups/<RESOURCE GROUP>/providers/Microsoft.CognitiveServices/accounts/<AI FOUNDRY RESOURCE>/projects/<PROJECT NAME>/connections/<CONNECTION NAME>>

    return await agents.ensureAgent(
        groundingConfig.aliasKeywordExtractorAgentId!,
        project,
        {
            model: "gpt-4o",
            name: "TypeAgent_AliasKeywordExtractor",
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


// TODO: IMPLEMENT
export async function extractAliasesForURL(
    site: string,
    groundingConfig: bingWithGrounding.ApiSettings,
): Promise<string | undefined | null> {
    let retVal: string | undefined | null = site;
    const project = new AIProjectClient(
        groundingConfig.endpoint!,
        new DefaultAzureCredential(),
    );

    const agent = await ensureKeywordExtractorAgent(groundingConfig, project);
    let inCompleteReason;

    if (!agent) {
        throw new Error(
            "No agent found for Bing with Grounding. Please check your configuration.",
        );
    }

    try {
        const thread = await project.agents.threads.create();

        // the question that needs answering
        await project.agents.messages.create(thread.id, "user", site);

        // Create run
        const run = await project.agents.runs.createAndPoll(
            thread.id,
            agent.id,
            {
                pollingOptions: {
                    intervalInMs: 250,
                },
                onResponse: (response): void => {
                    debug(`Received response with status: ${response.status}`);

                    const pb: any = response.parsedBody;
                    if (pb?.incomplete_details?.reason) {
                        inCompleteReason = pb.incomplete_details.reason;
                    }
                },
            },
        );

        const msgs: ThreadMessage[] = [];
        if (run.status === "completed") {
            if (run.completedAt) {
                // Retrieve messages
                const messages = await project.agents.messages.list(thread.id, {
                    order: "asc",
                });

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
                            const url = JSON.parse(txt) as urlResolutionAction;
                            retVal = url.url;
                        }
                    }
                }
            }
        }

        // delete the thread we just created since we are currently one and done
        project.agents.threads.delete(thread.id);
    } catch (e) {
        debug(`Error resolving URL with search: ${e}`);

        if (inCompleteReason === "content_filter") {
            retVal = null;
        } else {
            retVal = undefined;
        }
    }

    // return assistant messages
    return retVal;
}