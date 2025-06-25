// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Agent, ToolDefinitionUnion } from "@azure/ai-agents";
import { AIProjectClient } from "@azure/ai-projects";
import registerDebug from "debug";

const debug = registerDebug("typeagent:aiClient:agents");

/**
 * Attempts to retrive the URL resolution agent from the AI project and creates it if necessary
 *
 * @param agentId - The id of the agent to get
 * @param project - The AI project client
 * @param config - The configuration options for the agent
 */
export async function ensureAgent(
    agentId: string,
    project: AIProjectClient,
    agentConfig: agentConfig,
): Promise<Agent | undefined> {
    try {
        return await project.agents.getAgent(agentId);
    } catch (e) {
        return await createAgent(project, agentConfig);
    }
}

export type agentConfig = {
    model: string;
    name: string;
    description: string;
    temperature: number;
    instructions: string;
    tools: ToolDefinitionUnion[];
};

/**
 * Creates the agent with the supplied parameters
 * @param project - The ai projct client object
 * @param agentConfig - The configuration for the agent
 * @returns The created agent
 */
export async function createAgent(
    project: AIProjectClient,
    agentConfig: agentConfig,
): Promise<Agent> {
    try {
        // try to create the agent
        return await project.agents.createAgent(agentConfig.model, {
            name: agentConfig.name,
            description: agentConfig.description,
            temperature: agentConfig.temperature,
            instructions: agentConfig.instructions,
            tools: agentConfig.tools,
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
 * @param project - The AI project client
 */
export async function flushAgents(
    nameStartsWith: string,
    agent_ids_to_keep: string[],
    project: AIProjectClient,
) {
    try {
        const ids = agent_ids_to_keep.join("|");
        let lastAgentId = "";

        let agents;
        let empty = true;
        do {
            agents = project.agents.listAgents({
                after: lastAgentId,
            });

            for await (const a of agents) {
                empty = false;
                // delete the agent if we're not supposed to keep it and the name matches
                if (
                    a.name?.startsWith(nameStartsWith) &&
                    ids.indexOf(a.id) === -1
                ) {
                    await project.agents.deleteAgent(a.id);
                } else {
                    lastAgentId = a.id;
                }
            }
        } while (!empty);
    } catch (e) {
        debug(`Error deleting agent: ${e}`);
        throw e;
    }
}

/**
 * Deletes all agent threads.
 */
export async function deleteThreads(project: AIProjectClient) {
    try {
        let threads;
        let empty = true;
        // pagination doesn't work when you are deleting everything, so we have to loop until we find no more threads
        do {
            empty = true;
            threads = project.agents.threads.list();
            for await (const t of threads) {
                empty = false;

                await project.agents.threads.delete(t.id);
            }
        } while (!empty);
    } catch (e) {
        debug(`Error deleting thread: ${e}`);
        throw e;
    }
}
