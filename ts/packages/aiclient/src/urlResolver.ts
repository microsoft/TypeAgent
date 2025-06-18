// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { bingWithGrounding, agents } from "aiclient";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import {
    MessageContentUnion,
    ThreadMessage,
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

    const agent = await agents.ensureAgent(groundingConfig, project);

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