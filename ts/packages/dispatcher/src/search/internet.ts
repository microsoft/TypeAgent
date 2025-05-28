// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import {
    ChunkChatResponse,
    LookupOptions,
    extractEntities,
    generateAnswerFromWebPages,
    promptLib,
} from "typeagent";
import { ChatModel, bing, openai } from "aiclient";
import { PromptSection } from "typechat";
import {
    ActionContext,
    ActionResult,
    ActionResultSuccess,
    Entity,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { AIProjectClient } from "@azure/ai-projects";
import {
    displayError,
} from "@typeagent/agent-sdk/helpers/display";
import { DefaultAzureCredential } from "@azure/identity";
import { ThreadMessage } from "@azure/ai-projects";

function urlToHtml(url: string): string {
    return `<a href="${url}" target="_blank">${url}</a>`;
}

function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function answerToHtml(answer: ChunkChatResponse, lookup?: string) {
    let html = "<p><div>";
    if (answer.generatedText) {
        if (lookup) {
            html += `<div><i>${capitalize(lookup)}</i></div>`;
        }
        html += "<div>";
        html += answer.generatedText!.replaceAll("\n", "<br/>");
        html += "</div>";
        if (answer.urls && answer.urls.length > 0) {
            html += "<div>";
            for (const url of answer.urls) {
                // create a link to the url that opens in the default browser
                html += urlToHtml(url) + "<br/>";
            }
            html += "</div>";
        }
    }
    html += "</div>";
    return html;
}

function _answerToHtml(answer: string) {
    let html = "<p><div>";
    if (answer.length > 0) {
        // if (lookup) {
        //     html += `<div><i>${capitalize(lookup)}</i></div>`;
        // }
        html += "<div>";
        html += answer!.replaceAll("\n", "<br/>");
        html += "</div>";
        // if (answer.urls && answer.urls.length > 0) {
        //     html += "<div>";
        //     for (const url of answer.urls) {
        //         // create a link to the url that opens in the default browser
        //         html += urlToHtml(url) + "<br/>";
        //     }
        //     html += "</div>";
        // }
    }
    html += "</div>";
    return html;
}

function answersToHtml(context: LookupContext, messages: string[]): string {
    let html = "";
    for (const [lookup, chatResponse] of context.answers) {
        html += answerToHtml(chatResponse, lookup);
    }
    for (const m of messages) {
        html += _answerToHtml(m);
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

function lookupProgressAsHtml(lookupContext: LookupContext): string {
    // Show what we are searching for
    let html = lookupToHtml(lookupContext.lookups);
    // Answers we have already found
    const isMultiLookup = lookupContext.lookups.length > 1;
    for (const [lookup, answer] of lookupContext.answers) {
        html += answerToHtml(answer, isMultiLookup ? lookup : undefined);
    }
    // Show lookups in progress
    for (const [lookup, lookupProgress] of lookupContext.inProgress) {
        if (lookupProgress.url) {
            // What we are searching for now and on which url
            const searchUrl =
                lookupProgress.counter > 1
                    ? `<div>${urlToHtml(lookupProgress.url)}<b> | [${lookupProgress.counter}]</b></div>`
                    : `<div>${urlToHtml(lookupProgress.url)}</div>`;
            html += `<br/><div><b>Searching for</b> <i>${lookup}</i> on:${searchUrl}</div>`;
        }
    }
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

type LookupContext = {
    request: string; // request to be answered
    lookups: string[]; // Lookups we are running
    sites: string[] | undefined; // Sites we are looking at
    answers: Map<string, ChunkChatResponse>; // lookup -> final answer for lookup
    inProgress: Map<string, LookupProgress>; // lookup -> progress for lookup
};

type LookupProgress = {
    url: string; // On what web site
    counter: number; // How many chunks have we looked at?
    answerSoFar?: ChunkChatResponse | undefined;
};

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
    if (lookups.length > 3) {
        lookups = lookups.slice(0, 3);
    }

    // run bing with grounding lookup
    const msgs = await runAgentConversation(originalRequest, context);

    const lookUpConfig = await getLookupConfig();
    // If running single lookup, run documentConcurrency chunks per page simultaneously
    // Else we will be running at least more than 1 lookups in parallel anyway
    //const documentConcurrency = lookups.length === 1 ? 2 : 1;
    let documentConcurrency = 1;
    if (lookups.length === 1 && lookUpConfig?.documentConcurrency) {
        documentConcurrency = lookUpConfig.documentConcurrency;
    }
    context.actionIO.setDisplay({
        type: "html",
        content: lookupToHtml(lookups),
    });
    const lookupContext: LookupContext = {
        request,
        lookups,
        sites,
        answers: new Map<string, ChunkChatResponse>(),
        inProgress: new Map<string, LookupProgress>(),
    };

    const siteQuery = sites ? ` site:${sites.join("|")}` : "";
    // Run all lookups concurrently
    const results = await Promise.all(
        lookups.map((l) =>
            runLookup(
                `${l}${siteQuery}`,
                lookupContext,
                context,
                settings,
                documentConcurrency,
            ),
        ),
    );
    if (results.length > 0) {
        // Verify we got some answers at least
        const hasValidResults = results.some((r) => r !== undefined);
        if (hasValidResults) {
            // Capture answers in the turn impression to return
            literalResponse = updateActionResult(
                lookupContext,
                literalResponse,
                msgs
            );
            context.actionIO.setDisplay(literalResponse.displayContent);
            // Generate entities if needed
            if (settings.entityGenModel) {
                const entities = await runEntityExtraction(
                    lookupContext,
                    settings,
                );
                if (entities.length > 0) {
                    literalResponse.entities.push(...entities);
                }
            }
        } else {
            literalResponse = createActionResult(
                "There was an error searching for information on Bing.\nPlease ensure that:\n- The BING_API_KEY is correctly configured.\n- Bing is available",
            );
        }
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

function getLookupInstructions(): PromptSection[] {
    return [promptLib.dateTimePromptSection()];
}

function updateActionResult(
    context: LookupContext,
    literalResponse: ActionResultSuccess,
    messages: any[]
): ActionResultSuccess {
    if (context.answers.size > 0) {
        literalResponse.literalText = "";
        literalResponse.displayContent = {
            type: "html",
            content: answersToHtml(context, messages),
        };
        for (const [_lookup, chatResponse] of context.answers) {
            literalResponse.literalText += chatResponse.generatedText! + "\n";
            if (chatResponse.entities && chatResponse.entities.length > 0) {
                literalResponse.entities ??= [];
                literalResponse.entities.push(...chatResponse.entities);
            }
        }
    }
    return literalResponse;
}

async function runLookup(
    lookup: string,
    lookupContext: LookupContext,
    actionContext: ActionContext<CommandHandlerContext>,
    settings: LookupSettings,
    concurrency: number,
) {
    updateStatus();
    //
    // Lookups are implemented using a web search
    //
    let firstToken: boolean = true;

    const urls = await searchWeb(lookup, settings.maxSearchResults);
    if (!urls) {
        return undefined;
    }
    const answer = await generateAnswerFromWebPages(
        settings.fastMode ? "Speed" : "Quality",
        settings.answerGenModel,
        urls,
        lookupContext.request,
        settings.lookupOptions,
        concurrency,
        getLookupInstructions(),
        (url, answerSoFar) => {
            if (firstToken) {
                actionContext.profiler?.mark("firstToken");
                firstToken = false;
            }

            updateLookupProgress(lookupContext, lookup, url, answerSoFar);
            updateStatus();
        },
    );
    if (answer && answer.answerStatus !== "NotAnswered") {
        lookupContext.answers.set(lookup, answer);
    }
    lookupContext.inProgress.delete(lookup);
    updateStatus();
    return answer;

    function updateStatus() {
        actionContext.actionIO.setDisplay({
            type: "html",
            content: lookupProgressAsHtml(lookupContext),
        });
    }
}

async function runEntityExtraction(
    context: LookupContext,
    settings: LookupSettings,
): Promise<Entity[]> {
    if (!settings.entityGenModel) {
        return [];
    }
    let entityText = "";
    for (const [lookup, answer] of context.answers) {
        if (answer.generatedText && answer.entities.length === 0) {
            entityText += `${lookup}:\n${answer.generatedText}\n`;
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

/**
 * Search bing
 * @param query
 * @returns urls of relevant web pages
 */
async function searchWeb(
    query: string,
    maxSearchResults: number = 3,
): Promise<string[] | undefined> {
    const searchEngineResult = await bing.createBingSearch();
    if (!searchEngineResult.success) {
        console.log(searchEngineResult.message);
        return undefined;
    }
    const searchEngine = searchEngineResult.data;
    const matches = await searchEngine.webSearch(query, {
        count: maxSearchResults,
    });
    if (!matches.success) {
        return undefined;
    }
    let webPages = matches.data;
    if (webPages.length > maxSearchResults) {
        webPages = webPages.slice(0, maxSearchResults);
    }
    return webPages.map((webPage) => webPage.url);
}

function updateLookupProgress(
    context: LookupContext,
    lookup: string,
    url?: string,
    answerSoFar?: ChunkChatResponse,
) {
    let progress = context.inProgress.get(lookup);
    if (!progress || progress.url !== url) {
        progress = {
            url: url ?? "",
            counter: 0,
        };
        context.inProgress.set(lookup, progress);
    }
    progress.answerSoFar = answerSoFar;
    progress.counter++;
}

export async function runAgentConversation(
    userRequest: string,
    context: ActionContext<any>,
): Promise<any[]> {
    const project = new AIProjectClient(
        "https://typeagent-test-agent-resource.services.ai.azure.com/api/projects/typeagent-test-agent",
        new DefaultAzureCredential(),
    );

    const agent = await project.agents.getAgent(
        "asst_qBRBuICfBaNYDH3WnpbBUSb0",
    );
    console.log(`Retrieved agent: ${agent.name}`);

    const thread = await project.agents.threads.get(
        "thread_pGqNCJlb8vBpxX8mNzBWBvt8",
    );
    console.log(`Retrieved thread, thread ID: ${thread.id}`);

    const message = await project.agents.messages.create(
        thread.id,
        "user",
        userRequest,
    );
    console.log(`Created message, message ID: ${message.id}`);

    // Create run
    // TODO: implement streaming API when it's available
    try {
        let run = await project.agents.runs.createAndPoll(thread.id, agent.id, {
            stream: false,
        });

        if (run.status === "failed") {
            console.error(`Run failed: `, run.lastError);
        }

        console.log(`Run completed with status: ${run.status}`);

        // Retrieve messages
        const messages = await project.agents.messages.list(thread.id, {
            order: "asc",
        });

        // Display messages
        const msgs = [];
        for await (const m of messages) {
            const content = m.content.find(
                (c) => c.type === "text" && "text" in c,
            );
            if (content) {
                msgs.push(m);
                context.actionIO.setDisplay(
                    {   
                        type: "html",
                        content: `${JSON.stringify(m.role)}: ${JSON.stringify(content)}`
                    },
                );
                console.log(`${m.role}: ${content}`);
            }
        }

        return msgs;

    } catch (error) {
        displayError(
            `Error creating run: ${error}. Check for model throttling or content filtering.`,
            context,
        );

        throw error;
    }
}
