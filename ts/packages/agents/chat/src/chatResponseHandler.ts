// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { StopWatch } from "common-utils";
import {
    ChatResponseAction,
    GenerateResponseAction,
    LookupAndGenerateResponseAction,
} from "./chatResponseActionSchema.js";
import {
    ChunkChatResponse,
    LookupOptions,
    extractEntities,
    generateAnswerFromWebPages,
    promptLib,
    Entity,
} from "typeagent";
import { ChatModel, bing, openai } from "aiclient";
import { PromptSection } from "typechat";
import {
    ActionContext,
    AppAgent,
    AppAction,
    ActionResult,
    ActionResultSuccess,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultNoDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { fileURLToPath } from "node:url";
import { conversation as Conversation } from "knowledge-processor";

export function instantiate(): AppAgent {
    return {
        executeAction: executeChatResponseAction,
        streamPartialAction: streamPartialChatResponseAction,
    };
}

function isChatResponseAction(action: AppAction): action is ChatResponseAction {
    return (
        action.actionName === "generateResponse" ||
        action.actionName === "lookupAndGenerateResponse" ||
        action.actionName === "chatImageResponse"
    );
}

export async function executeChatResponseAction(
    chatAction: AppAction,
    context: ActionContext,
) {
    if (!isChatResponseAction(chatAction)) {
        throw new Error(`Invalid chat action: ${chatAction.actionName}`);
    }
    return handleChatResponse(chatAction, context);
}

async function handleChatResponse(
    chatAction: ChatResponseAction,
    context: ActionContext,
) {
    console.log(JSON.stringify(chatAction, undefined, 2));
    switch (chatAction.actionName) {
        case "generateResponse": {
            const generateResponseAction = chatAction as GenerateResponseAction;
            const parameters = generateResponseAction.parameters;
            const generatedText = parameters.generatedText;
            if (generatedText !== undefined) {
                logEntities("UR Entities:", parameters.userRequestEntities);
                logEntities("GT Entities:", parameters.generatedTextEntities);
                console.log("Got generated text");

                const needDisplay = context.streamingContext !== generatedText;
                const result = needDisplay
                    ? createActionResult(generatedText, true)
                    : createActionResultNoDisplay(generatedText);

                let entities = parameters.generatedTextEntities || [];
                if (parameters.userRequestEntities !== undefined) {
                    entities = parameters.userRequestEntities.concat(entities);
                }
                result.entities = entities;
                return result;
            }
        }
        case "lookupAndGenerateResponse": {
            const lookupAction = chatAction as LookupAndGenerateResponseAction;
            if (
                lookupAction.parameters.internetLookups !== undefined &&
                lookupAction.parameters.internetLookups.length > 0
            ) {
                console.log("Running lookups");
                return handleLookup(
                    lookupAction,
                    context,
                    await getLookupSettings(true),
                );
            }
            if (
                lookupAction.parameters.conversationLookupFilters !== undefined
            ) {
                const conversationManager: Conversation.ConversationManager = (
                    context.sessionContext as any
                ).conversationManager;
                if (conversationManager !== undefined) {
                    let searchResponse =
                        await conversationManager.getSearchResponse(
                            lookupAction.parameters.originalRequest,
                            lookupAction.parameters.conversationLookupFilters,
                        );
                    if (searchResponse) {
                        if (searchResponse.response?.hasHits()) {
                            console.log("Has hits");
                        }
                        const matches =
                            await conversationManager.generateAnswerForSearchResponse(
                                lookupAction.parameters.originalRequest,
                                searchResponse,
                            );
                        if (
                            matches &&
                            matches.response &&
                            matches.response.answer
                        ) {
                            return createActionResult(
                                matches.response.answer.answer!,
                            );
                        } else {
                            console.log("bug");
                        }
                    }
                }
            }
        }
    }
    return createActionResult("No information found");
}

function logEntities(label: string, entities?: Entity[]): void {
    if (entities && entities.length > 0) {
        console.log(label);
        for (const entity of entities) {
            console.log(`  ${entity.name} (${entity.type})`);
        }
    }
}

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

function answersToHtml(context: LookupContext): string {
    let html = "";
    for (const [lookup, chatResponse] of context.answers) {
        html += answerToHtml(chatResponse, lookup);
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
        const configFileName = fileURLToPath(
            new URL("./config.json", import.meta.url),
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
    lookups: string[]; // Lookups we are running
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

async function handleLookup(
    chatAction: LookupAndGenerateResponseAction,
    context: ActionContext,
    settings: LookupSettings,
): Promise<ActionResult> {
    let literalResponse = createActionResult("No information found");

    let lookups = chatAction.parameters.internetLookups;
    if (!lookups || lookups.length === 0) {
        return literalResponse;
    }
    if (lookups.length > 3) {
        lookups = lookups.slice(0, 3);
    }

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
        lookups,
        answers: new Map<string, ChunkChatResponse>(),
        inProgress: new Map<string, LookupProgress>(),
    };
    // Run all lookups concurrently
    await Promise.all(
        lookups.map((l) =>
            runLookup(l, lookupContext, context, settings, documentConcurrency),
        ),
    );
    // Capture answers in the turn impression to return
    literalResponse = updateActionResult(lookupContext, literalResponse);
    context.actionIO.setDisplay(literalResponse.displayContent);
    // Generate entities if needed
    if (settings.entityGenModel) {
        const entities = await runEntityExtraction(lookupContext, settings);
        if (entities.length > 0) {
            literalResponse.entities.push(...entities);
        }
    }
    logEntities("Lookup Entities:", literalResponse.entities);
    return literalResponse;
}

async function getLookupSettings(
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
        openai.createLocalChatModel(fastModelName) ??
        openai.createJsonChatModel(fastModelName);
    let generalModel = openai.createJsonChatModel();
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
): ActionResultSuccess {
    if (context.answers.size > 0) {
        literalResponse.literalText = "";
        literalResponse.displayContent = {
            type: "html",
            content: answersToHtml(context),
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
    actionContext: ActionContext,
    settings: LookupSettings,
    concurrency: number,
) {
    updateStatus();
    //
    // Lookups are implemented using a web search
    //
    let firstToken: boolean = true;

    const stopWatch = new StopWatch();
    stopWatch.start("WEB SEARCH: " + lookup);
    const urls = await searchWeb(lookup, settings.maxSearchResults);
    stopWatch.stop("WEB SEARCH: " + lookup);
    if (!urls) {
        return undefined;
    }
    stopWatch.start("GENERATE ANSWER " + lookup);
    const answer = await generateAnswerFromWebPages(
        settings.fastMode ? "Speed" : "Quality",
        settings.answerGenModel,
        urls,
        lookup,
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
    stopWatch.stop("GENERATE ANSWER " + lookup);
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
    const stopWatch = new StopWatch();
    stopWatch.start("GENERATE ENTITIES");
    const results = await extractEntities(settings.entityGenModel, entityText);
    stopWatch.stop("GENERATE ENTITIES");
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

function streamPartialChatResponseAction(
    actionName: string,
    name: string,
    value: string,
    delta: string | undefined,
    context: ActionContext,
) {
    if (actionName !== "generateResponse") {
        return;
    }

    // don't stream empty string and undefined as well.
    if (name === "parameters.generatedText") {
        if (delta === undefined) {
            // we finish the streaming text.  add an empty string to flush the speaking buffer.
            context.actionIO.appendDisplay("");
        }
        // Don't stream empty deltas
        if (delta) {
            if (context.streamingContext === undefined) {
                context.streamingContext = "";
            }
            context.streamingContext += delta;
            context.actionIO.appendDisplay({
                type: "text",
                content: delta,
                speak: true,
            });
        }
    }
}
