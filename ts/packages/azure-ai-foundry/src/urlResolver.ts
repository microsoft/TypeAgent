// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as bingWithGrounding from "./bingWithGrounding.js";
import * as agents from "./agents.js";
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

export type SiteValidity = "Valid" | "Invalid" | "Unknown";

export interface urlValidityAction {
    originalRequest: string;
    url: string;
    urlValidity: SiteValidity;
    explanation: string;
}

const urlResolutionAgentId = "TypeAgent_URLResolverAgent";
export async function flushAgent(
    groundingConfig: bingWithGrounding.ApiSettings,
) {
    const project = new AIProjectClient(
        groundingConfig.endpoint!,
        new DefaultAzureCredential(),
    );
    await agents.flushAgents(
        urlResolutionAgentId,
        [groundingConfig.urlResolutionAgentId!],
        project,
    );
}

export async function deleteThreads(
    groundingConfig: bingWithGrounding.ApiSettings,
) {
    const project = new AIProjectClient(
        groundingConfig.endpoint!,
        new DefaultAzureCredential(),
    );
    await agents.deleteThreads(project);
}

export async function resolveURLWithSearch(
    site: string,
    groundingConfig: bingWithGrounding.ApiSettings,
): Promise<string | undefined> {
    let retVal: string = site;
    const project = new AIProjectClient(
        groundingConfig.endpoint!,
        new DefaultAzureCredential(),
    );

    const agent = await ensureResolverAgent(groundingConfig, project);

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
async function ensureResolverAgent(
    groundingConfig: bingWithGrounding.ApiSettings,
    project: AIProjectClient,
): Promise<Agent | undefined> {
    // tool connection ids are in the format: /subscriptions/<SUBSCRIPTION ID>/resourceGroups/<RESOURCE GROUP>/providers/Microsoft.CognitiveServices/accounts/<AI FOUNDRY RESOURCE>/projects/<PROJECT NAME>/connections/<CONNECTION NAME>>

    return await agents.ensureAgent(
        groundingConfig.urlResolutionAgentId!,
        project,
        {
            model: "gpt-4o",
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

/*
 * Attempts to retrive the URL resolution agent from the AI project and creates it if necessary
 */
async function ensureValidatorAgent(
    groundingConfig: bingWithGrounding.ApiSettings,
    project: AIProjectClient,
): Promise<Agent | undefined> {
    // tool connection ids are in the format: /subscriptions/<SUBSCRIPTION ID>/resourceGroups/<RESOURCE GROUP>/providers/Microsoft.CognitiveServices/accounts/<AI FOUNDRY RESOURCE>/projects/<PROJECT NAME>/connections/<CONNECTION NAME>>

    return await agents.ensureAgent(
        groundingConfig.validatorAgentId!,
        project,
        {
            model: "gpt-4o",
            name: "TypeAgent_URLValidatorAgent",
            description: "Auto created URL Validation Agent",
            temperature: 0.01,
            instructions: `
You are an agent that gets information from the user that includes the web page they requested and the URL they went to.  You are responsible for determining if the provided URL is the one the user requested.   Use the GetHTTPSEndpoint_Tool to get the HTML of the page to ensure the user's intent is being fullfilled.  Call the GetHTTPSEndpoint_Tool to get the HTML of the page to make sure it's what the user wants.

The user's request is supplied as a JSON that conforms to the following TypeScript type:

interface Request {
  request: string;
  url: string;
}

Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:

interface Response {
 originalRequest: string;
 url: string;
 urlValidity: "valid" | "invalid" | "indeterminate";
 explanation: string;
}`,
            tools: [
                ToolUtility.createBingGroundingTool([
                    {
                        connectionId:
                            groundingConfig.httpEndpointLogicAppConnectionId!,
                    },
                ]).definition,
            ],
        },
    );
}

export async function validateURL(
    utterance: string,
    url: string,
    groundingConfig: bingWithGrounding.ApiSettings,
): Promise<urlValidityAction | undefined> {
    debug(`Validating URL for utterance: ${utterance}, url: ${url}`);

    const project = new AIProjectClient(
        groundingConfig.endpoint!,
        new DefaultAzureCredential(),
    );

    try {
        const agent = await ensureValidatorAgent(groundingConfig, project);
        const thread = await project.agents.threads.create();

        // the question that needs answering
        await project.agents.messages.create(
            thread.id,
            "user",
            JSON.stringify({ request: utterance, url: url }),
        );

        let retryCount = 0;
        const maxRetries = 5;
        let success = false;
        let lastResponse;

        while (retryCount < maxRetries && !success) {
            try {
                // need this cause you can't access the run object until it enters the start state
                const runStarted = Date.now();

                // Create run
                const run = await project.agents.runs.createAndPoll(
                    thread.id,
                    agent!.id,
                    {
                        pollingOptions: {
                            intervalInMs: 3000,
                        },
                        onResponse: async (response): Promise<void> => {
                            lastResponse = response;

                            debug(
                                `Received response with status: ${response.status}`,
                            );

                            if (response.status != 200) {
                                process.stdout.write(response.bodyAsText!);
                                debug(
                                    `Received response with status: ${response}`,
                                );
                            }

                            // Cancel the run if it has been running for more than 30 seconds
                            if (
                                Date.now() - new Date(runStarted).getTime() >
                                    30000 &&
                                (response.parsedBody as any).status !=
                                    "cancelling" &&
                                (response.parsedBody as any).status !=
                                    "completed"
                            ) {
                                //if (!run.completedAt) {
                                await project.agents.runs.cancel(
                                    thread.id,
                                    (response.parsedBody as any).id,
                                );
                                console.log(`TIMEOUT - Canceled ${utterance}`);
                                //}
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

                                    // BUGBUG: only returns the first user message in the thread
                                    return JSON.parse(txt) as urlValidityAction;
                                }
                            }
                        }
                    }
                }

                success = true;
            } catch (pollingError) {
                /*
                    Getting lots of 502s from Logic App for getting web page content.

                    last_error: {
                        code: 'tool_user_error',
                        message: 'Error: http_client_error; HTTP error 502: Bad Gateway',
                        debug_info: [Object]
                    },                
                */

                //console.log(lastResponse);
                //console.log(pollingError);
                const ee = (lastResponse as any).parsedBody;
                console.log(`\t${JSON.stringify(ee.last_error)}`);
            } finally {
                retryCount++;
            }
        }

        if (retryCount >= maxRetries) {
            console.log("MAXIMUM RETRY COUNT EXCEEDED!!!");
        }

        // delete the thread we just created since we are currently one and done
        project.agents.threads.delete(thread.id);
    } catch (e) {
        debug(`Error validating URL: ${e}`);
    }

    return undefined;
}
