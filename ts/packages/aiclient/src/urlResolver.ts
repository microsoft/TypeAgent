// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { bingWithGrounding } from "aiclient";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import {
    Agent,
    MessageContentUnion,
    ThreadMessage,
    ToolUtility,
} from "@azure/ai-agents";
import registerDebug from "debug";

const debug = registerDebug("typeagent:aiClient:urlResolver");

export interface urlResolutionAction {
    originalRequest: string;
    url: string;
    urlsEvaluated: string[];
    explanation: string;
    bingSearchQuery: string;
}

export async function resolveURLWithSearch(site: string, groundingConfig: bingWithGrounding.ApiSettings): Promise<string | undefined> {

    let retVal: string = site;
    const project = new AIProjectClient(
        groundingConfig.endpoint!,
        new DefaultAzureCredential(),
    );

    const agent = await ensureAgent(groundingConfig, project);

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
                    intervalInMs: 500,
                },
                onResponse: (response): void => {
                    debug(`Received response with status: ${response.status}`);
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
    }

    // return assistant messages
    return retVal;
}

/*
 * Attempts to retrive the URL resolution agent from the AI project and creates it if necessary
 */
async function ensureAgent(
    groundingConfig: bingWithGrounding.ApiSettings,
    project: AIProjectClient,
): Promise<Agent | undefined> {
    try {
        return await project.agents.getAgent(
            groundingConfig.urlResolutionAgentId!,
        );
    } catch (e) {
        return await createAgent(groundingConfig, project);
    }
}

async function createAgent(
    groundingConfig: bingWithGrounding.ApiSettings,
    project: AIProjectClient,
): Promise<Agent> {
    try {
        // connection id is in the format: /subscriptions/<SUBSCRIPTION ID>/resourceGroups/<RESOURCE GROUP>/providers/Microsoft.CognitiveServices/accounts/<AI FOUNDRY RESOURCE>/projects/typeagent-test-agent/connections/<CONNECTION NAME>>
        const bingTool = ToolUtility.createBingGroundingTool([
            {
                connectionId: groundingConfig.connectionId!,
            },
        ]);

        // try to create the agent
        return await project.agents.createAgent("gpt-4o", {
            name: "TypeAgent_URLResolverAgent",
            description: "Auto created URL Resolution Agent",
            temperature: 0.01,
            instructions: `
You are an agent that translates user requests in conjunction with search results to URLs.  If the page does not exist just return an empty URL. Do not make up URLs.  
Choose to answer the user's question by favoring websites closer to the user. Don't restrict searches to specific domains unless the user provided the domain.

Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:

interface Response {
    originalRequest: string;
    url: string;
    urlsEvaluated: string[];
    explanation: string;
    bingSearchQuery: string;
}`,
            tools: [bingTool.definition],
        });
    } catch (e) {
        debug(`Error creating agent: ${e}`);
        throw e;
    }
}
