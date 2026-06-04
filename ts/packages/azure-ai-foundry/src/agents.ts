// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AIProjectClient, ToolUnion } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import registerDebug from "debug";

const debug = registerDebug("typeagent:aiClient:agents");

/**
 * Creates an AI project client for the supplied Foundry project endpoint.
 *
 * @param endpoint - The Foundry project endpoint
 *  (e.g. https://<account>.services.ai.azure.com/api/projects/<project-name>)
 * @returns The AI project client
 */
export function getProject(endpoint: string): AIProjectClient {
    return new AIProjectClient(endpoint, new DefaultAzureCredential());
}

export type agentConfig = {
    model: string;
    name: string;
    description: string;
    temperature: number;
    instructions: string;
    tools: ToolUnion[];
};

/**
 * Builds a Bing grounding tool definition for the supplied project connection.
 *
 * @param connectionId - The Bing grounding project connection id
 * @returns The Bing grounding tool definition
 */
export function bingGroundingTool(connectionId: string): ToolUnion {
    return {
        type: "bing_grounding",
        bing_grounding: {
            search_configurations: [{ project_connection_id: connectionId }],
        },
    } as ToolUnion;
}

/**
 * Ensures a prompt agent exists with the supplied configuration. The agent is
 * referenced by its stable name; the call is idempotent and will create a new
 * version when the definition changes, otherwise it returns the existing agent.
 *
 * @param project - The AI project client
 * @param agentConfig - The configuration options for the agent
 * @returns The stable name of the ensured agent
 */
export async function ensureAgent(
    project: AIProjectClient,
    agentConfig: agentConfig,
): Promise<string> {
    const definition = {
        kind: "prompt",
        model: agentConfig.model,
        description: agentConfig.description,
        instructions: agentConfig.instructions,
        tools: agentConfig.tools,
    };

    try {
        await project.agents.update(agentConfig.name, definition as any);
    } catch (e) {
        debug(`Agent update failed, attempting create: ${e}`);
        await project.agents.create(agentConfig.name, definition as any);
    }

    return agentConfig.name;
}

export type AgentRunResult = {
    text?: string;
    contentFiltered: boolean;
};

/**
 * Invokes a prompt agent statelessly via the Responses API and returns its text
 * output. The agent is referenced by name; no persistent thread/conversation is
 * created.
 *
 * @param project - The AI project client
 * @param agentName - The stable name of the agent to invoke
 * @param input - The user input to send to the agent
 * @returns The text output and whether the response was filtered by content safety
 */
export async function runAgent(
    project: AIProjectClient,
    agentName: string,
    input: string,
): Promise<AgentRunResult> {
    const openai = project.getOpenAIClient();
    const response = await openai.responses.create(
        {
            input,
        } as any,
        {
            body: {
                agent_reference: {
                    name: agentName,
                    type: "agent_reference",
                },
            },
        },
    );

    const contentFiltered =
        response.status === "incomplete" &&
        (response.incomplete_details?.reason as string | undefined) ===
            "content_filter";

    return { text: response.output_text, contentFiltered };
}

export type UrlCitation = {
    url: string;
    title: string;
};

export type AgentStreamResult = {
    text: string;
    citations: UrlCitation[];
    contentFiltered: boolean;
};

/**
 * Invokes a prompt agent via the streaming Responses API. Text deltas are
 * delivered to the supplied callback as they arrive, and url citations are
 * accumulated. The agent is referenced by name; no persistent thread is created.
 *
 * @param project - The AI project client
 * @param agentName - The stable name of the agent to invoke
 * @param input - The user input to send to the agent
 * @param onTextDelta - Optional callback invoked with each text delta
 * @returns The accumulated text, url citations, and whether content was filtered
 */
export async function runAgentStreaming(
    project: AIProjectClient,
    agentName: string,
    input: string,
    onTextDelta?: (delta: string) => void,
): Promise<AgentStreamResult> {
    const openai = project.getOpenAIClient();
    const stream = (await openai.responses.create(
        { input, stream: true } as any,
        {
            body: {
                agent_reference: {
                    name: agentName,
                    type: "agent_reference",
                },
            },
        },
    )) as any;

    let text = "";
    const citations: UrlCitation[] = [];
    let contentFiltered = false;

    for await (const event of stream) {
        switch (event.type) {
            case "response.output_text.delta": {
                const delta: string = event.delta ?? "";
                text += delta;
                onTextDelta?.(delta);
                break;
            }
            case "response.output_text.annotation.added": {
                const annotation = event.annotation;
                if (annotation?.type === "url_citation" && annotation.url) {
                    citations.push({
                        url: annotation.url,
                        title: annotation.title ?? annotation.url,
                    });
                }
                break;
            }
            case "response.completed":
            case "response.incomplete": {
                const response = event.response;
                if (response?.output_text) {
                    text = response.output_text;
                }
                if (response?.incomplete_details?.reason === "content_filter") {
                    contentFiltered = true;
                }
                break;
            }
        }
    }

    return { text, citations, contentFiltered };
}

/**
 * Strips markdown code fences from an agent text response and parses it as JSON.
 *
 * @param text - The raw text output from the agent
 * @returns The parsed JSON value, or undefined if there was no text
 */
export function parseJsonResponse<T>(text: string | undefined): T | undefined {
    if (text === undefined) {
        return undefined;
    }
    const cleaned = text.replaceAll("```json", "").replaceAll("```", "");
    return JSON.parse(cleaned) as T;
}

/**
 * Deletes all agents whose name starts with the supplied prefix, except for any
 * whose name is in the keep list.
 *
 * @param nameStartsWith - The name prefix of the agents to match
 * @param namesToKeep - The names of the agents to retain
 * @param project - The AI project client
 */
export async function flushAgents(
    nameStartsWith: string,
    namesToKeep: string[],
    project: AIProjectClient,
) {
    try {
        for await (const a of project.agents.list()) {
            if (
                a.name?.startsWith(nameStartsWith) &&
                !namesToKeep.includes(a.name)
            ) {
                await project.agents.delete(a.name);
            }
        }
    } catch (e) {
        debug(`Error deleting agent: ${e}`);
        throw e;
    }
}

/**
 * Threads no longer exist in the Responses-based Foundry Agent Service.
 * Retained as a no-op for backward compatibility with existing commands.
 */
export async function deleteThreads(_project: AIProjectClient) {
    debug(
        "deleteThreads is a no-op: the Responses API does not use persistent threads.",
    );
}
