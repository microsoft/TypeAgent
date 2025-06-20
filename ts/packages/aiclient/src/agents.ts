// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { bingWithGrounding } from "aiclient";
import {
    Agent,
    ToolUtility,
} from "@azure/ai-agents";
import { AIProjectClient } from "@azure/ai-projects";
import registerDebug from "debug";

const debug = registerDebug("typeagent:aiClient:agents");

/**
  * Attempts to retrive the URL resolution agent from the AI project and creates it if necessary
  * 
  * @param groundingConfig - The agent configuration
  */
export async function ensureAgent(
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

export async function createAgent(
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

/**
 * Deletes all agents that start with the supplied string except the ones whose ID is in the keep list
 * @param nameStartsWith - The name of the agents to match
 * @param agent_ids_to_keep - The ID of the agents to retain
 */
export async function flushAgents(nameStartsWith: string, agent_ids_to_keep: string[], project: AIProjectClient) {
    try {

        const ids = agent_ids_to_keep.join("|");
        let lastAgentId = "";

        let agents;
        let empty = true;
        do {
            agents = project.agents.listAgents({
                after: lastAgentId
            });

            for await (const a of agents) {
                empty = false;
                // delete the agent if we're not supposed to keep it and the name matches
                if (a.name?.startsWith(nameStartsWith) && ids.indexOf(a.id) === -1) {
                    await project.agents.deleteAgent(a.id);                    
                } else {
                    lastAgentId = a.id;
                }
            }
        } while (!empty);

        
    } catch (e) {
        debug(`Error creating agent: ${e}`);
        throw e;
    }
}
