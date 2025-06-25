// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { LookupOptions, extractEntities } from "typeagent";
import { ChatModel, openai } from "aiclient";
import {
    ActionContext,
    ActionResult,
    ActionResultSuccess,
    Entity,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { AIProjectClient } from "@azure/ai-projects";
import { displayError } from "@typeagent/agent-sdk/helpers/display";
import { DefaultAzureCredential } from "@azure/identity";
import {
    DoneEvent,
    ErrorEvent,
    MessageContentUnion,
    MessageDeltaChunk,
    MessageDeltaTextContent,
    MessageDeltaTextUrlCitationAnnotation,
    MessageStreamEvent,
    MessageTextContent,
    MessageTextUrlCitationAnnotation,
    RunStreamEvent,
    ThreadMessage,
} from "@azure/ai-agents";
import { bingWithGrounding } from "azure-ai-foundry";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";

function urlToHtml(url: string, title?: string | undefined): string {
    return `<a href="${url}" target="_blank">${title ? title : url}</a>`;
}

function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function answerToHtml(answer: ThreadMessage): string {
    let html = "<p><div>";

    const content: MessageContentUnion | undefined = answer.content.find(
        (c) => c.type === "text" && "text" in c,
    );

    if (content) {
        let refCount = 0;
        const textContent: MessageTextContent = content as MessageTextContent;
        let annotations = "";
        let text = textContent.text.value.replaceAll("\n", "<br/>");
        textContent.text.annotations.forEach((a) => {
            switch (a.type) {
                case "url_citation":
                    const citation: MessageTextUrlCitationAnnotation =
                        a as MessageTextUrlCitationAnnotation;
                    annotations += urlToHtml(
                        citation.urlCitation.url,
                        `${++refCount}. ${citation.urlCitation.title}`,
                    );
                    annotations += "<br/>";

                    if (citation.text) {
                        text = text.replaceAll(
                            citation.text!,
                            ` <sup>[${urlToHtml(citation.urlCitation.url, `${refCount}`)}]</sup>`,
                        );
                    }

                    break;
                default:
                    console.warn(`Unsupported citation type: ${a.type}.`);
                // TODO: other annotation types
            }
        });

        if (annotations.length > 0) {
            annotations = `<br /><div class=\"references\">References:<br/>${annotations}`;
        }

        html += "</div><div>";
        html += `${text}<br/>${annotations}`;
        html += "</div>";
    }

    html += "</div>";
    return html;
}

function answersToHtml(messages: ThreadMessage[]): string {
    let html = "";
    for (const m of messages) {
        html += answerToHtml(m);
    }
    return html;
}

function lookupToHtml(lookups: string[]): string {
    const searchingForHtml = "<div>🔎 <b>Looking up ...</b></div>";
    let html = searchingForHtml;
    html += "<div>";
    lookups = lookups.map((l) => capitalize(l));
    html += lookups.join("<br/>");
    html += "</div>";
    return html;
}

type LookupConfig = {
    fastMode: boolean;
    fastModelName?: string | undefined;
    rewriteFocus?: string | undefined;
    documentConcurrency?: number | undefined;
};

type ConfigFile = {
    lookup?: LookupConfig;
};

let config: ConfigFile | undefined;
async function getLookupConfig() {
    if (config === undefined) {
        const configFileName = getPackageFilePath(
            "./data/internetSearchConfig.json",
        );
        const configContent = await fs.promises.readFile(
            configFileName,
            "utf8",
        );
        config = JSON.parse(configContent) as ConfigFile;
    }
    return config.lookup;
}

type LookupSettings = {
    fastMode: boolean;
    answerGenModel: ChatModel;
    entityGenModel?: ChatModel;
    maxSearchResults: number;
    maxEntityTextLength: number;
    lookupOptions: LookupOptions;
};

export async function handleLookup(
    request: string,
    lookups: string[] | undefined,
    sites: string[] | undefined,
    context: ActionContext<CommandHandlerContext>,
    settings: LookupSettings,
    originalRequest: string,
): Promise<ActionResult> {
    let literalResponse = createActionResult("No information found");

    if (!lookups || lookups.length === 0) {
        return literalResponse;
    }

    context.actionIO.setDisplay({
        type: "html",
        content: lookupToHtml(lookups),
    });

    // run bing with grounding lookup
    const results = await runGroundingLookup(request, lookups, sites, context);

    if (results.length > 0) {
        updateActionResult(literalResponse, results);
        context.actionIO.setDisplay(literalResponse.displayContent);

        if (settings.entityGenModel) {
            const entities = await runEntityExtraction(results, settings);
            literalResponse.entities =
                literalResponse.entities.concat(entities);
        }
    } else {
        literalResponse = createActionResult(
            "There was an error searching for information on Grounding with Bing.",
        );
    }

    return literalResponse;
}

export async function getLookupSettings(
    fastMode: boolean = true,
): Promise<LookupSettings> {
    const lookupConfig = await getLookupConfig();
    const maxCharsPerChunk = 1024 * 4; // Approx 2K tokens
    let fastModelName: string | undefined;
    let rewriteFocus: string | undefined;

    if (lookupConfig) {
        fastMode = lookupConfig.fastMode;
        fastModelName = lookupConfig.fastModelName;
        rewriteFocus = lookupConfig.rewriteFocus;
    }
    fastModelName ??= "GPT_35_TURBO";
    let fastModel =
        openai.createLocalChatModel(fastModelName, undefined, [
            "chatResponseHandler",
        ]) ??
        openai.createJsonChatModel(fastModelName, ["chatResponseHandler"]);
    let generalModel = openai.createJsonChatModel(undefined, [
        "chatResponseHandler",
    ]);
    rewriteFocus ??=
        "make it more concise and readable, with better formatting (e.g. use line breaks, bullet points as needed)";

    return {
        fastMode, // If fastMode is on, we use GPT_35
        answerGenModel: fastMode ? fastModel : generalModel,
        entityGenModel: fastMode ? fastModel : generalModel, // If entities need to be manually found from answers. Use GPT-4
        maxSearchResults: 3,
        lookupOptions: {
            maxCharsPerChunk,
            // Maximum amount of text in a *single* web page to search.
            // - Assumes if answer not quickly found on a "relevant" web page, probably not there and moves on to next web page
            // - Helps stop 'partial' queries on VERY LONG web pages, which do exist
            maxTextLengthToSearch: maxCharsPerChunk * 16,
            deepSearch: false,
            rewriteForReadability: true,
            rewriteFocus,
            rewriteModel: fastModel,
        },
        maxEntityTextLength: maxCharsPerChunk * 2,
    };
}

// function getLookupInstructions(): PromptSection[] {
//     return [promptLib.dateTimePromptSection()];
// }

function updateActionResult(
    literalResponse: ActionResultSuccess,
    messages: ThreadMessage[],
): ActionResultSuccess {
    if (messages.length > 0) {
        literalResponse.literalText = "";
        literalResponse.displayContent = {
            type: "html",
            content: answersToHtml(messages),
        };
    }

    return literalResponse;
}

async function runEntityExtraction(
    messages: ThreadMessage[],
    settings: LookupSettings,
): Promise<Entity[]> {
    if (!settings.entityGenModel) {
        return [];
    }
    let entityText = "";
    for (const message of messages) {
        for (const content of message.content) {
            const textContent = content as MessageTextContent;

            if (textContent) {
                entityText += `${textContent.text.value}\n`;

                for (const a of textContent.text.annotations) {
                    switch (a.type) {
                        case "url_citation":
                            const url = a as MessageTextUrlCitationAnnotation;
                            entityText += `Reference: ${url.urlCitation.title} - ${url.urlCitation.url}`;
                            break;
                        default:
                            console.warn(
                                `Unsupported citation type: ${a.type}.`,
                            );
                    }
                }
            }
        }
    }
    if (!entityText) {
        return [];
    }
    if (entityText.length > settings.maxEntityTextLength) {
        entityText = entityText.slice(0, settings.maxEntityTextLength);
    }
    const results = await extractEntities(settings.entityGenModel, entityText);
    return results;
}

let groundingConfig: bingWithGrounding.ApiSettings | undefined;
export async function runGroundingLookup(
    question: string,
    lookups: string[],
    sites: string[] | undefined,
    context: ActionContext<any>,
): Promise<ThreadMessage[]> {
    if (!groundingConfig) {
        groundingConfig = bingWithGrounding.apiSettingsFromEnv();
    }

    const project = new AIProjectClient(
        groundingConfig.endpoint!,
        new DefaultAzureCredential(),
    );

    const agent = await project.agents.getAgent(groundingConfig.agent!);

    if (!agent) {
        displayError(
            "No agent found for Bing with Grounding. Please check your configuration.",
            context,
        );
        return [];
    }

    const thread = await project.agents.threads.create();

    // the question that needs answering
    await project.agents.messages.create(
        thread.id,
        "user",
        `Here is my question: '${question}.\nHere are the internet search terms: ${lookups.join(",")}\nHere are the sites I want to search: ${sites?.join("|")}`,
    );

    // Create run
    try {
        let run = await project.agents.runs
            .create(thread.id, agent.id)
            .stream();
        for await (const eventMsg of run) {
            switch (eventMsg.event) {
                case RunStreamEvent.ThreadRunCreated:
                    context.actionIO.setDisplay({ type: "html", content: "" });
                    break;
                case RunStreamEvent.ThreadRunCompleted:
                    break;
                case MessageStreamEvent.ThreadMessageDelta:
                    const messageDelta = eventMsg.data as MessageDeltaChunk;
                    messageDelta.delta.content.forEach((contentPart) => {
                        if (contentPart.type === "text") {
                            const textContent =
                                contentPart as MessageDeltaTextContent;
                            let textValue = textContent.text?.value || "";

                            if (textContent.text?.annotations) {
                                textContent.text?.annotations.forEach((a) => {
                                    if (a) {
                                        switch (a.type) {
                                            case "url_citation":
                                                const annotation =
                                                    a as MessageDeltaTextUrlCitationAnnotation;
                                                textValue = `[${urlToHtml((annotation as any).url_citation, `${annotation.index + 1}`)}]`;
                                                break;
                                            default:
                                                console.warn(
                                                    `Unsupported citation type: ${a.type}.`,
                                                );
                                            // TODO: other annotation types
                                        }
                                    }
                                });
                            }

                            context.actionIO.appendDisplay({
                                type: "html",
                                content: `${textValue.replaceAll("\n", "<br/>")}`,
                            });
                        }
                    });
                    break;
                case ErrorEvent.Error:
                    break;
                case DoneEvent.Done:
                    break;
            }
        }

        // Retrieve messages
        const messages = await project.agents.messages.list(thread.id, {
            order: "asc",
        });

        // accumulate assistant messages
        const msgs: ThreadMessage[] = [];
        for await (const m of messages) {
            if (m.role === "assistant") {
                // TODO: handle multi-modal content
                const content: MessageContentUnion | undefined = m.content.find(
                    (c) => c.type === "text" && "text" in c,
                );
                if (content) {
                    msgs.push(m);
                }
            }
        }

        // delete the thread we just created since we are currently one and done
        project.agents.threads.delete(thread.id);

        // return assistant messages
        return msgs;
    } catch (error) {
        displayError(
            `Error creating run: ${error}. Check for model throttling or content filtering.`,
            context,
        );

        throw error;
    }
}
