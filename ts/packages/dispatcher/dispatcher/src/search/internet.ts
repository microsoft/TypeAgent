// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { LookupOptions, extractEntities } from "typeagent";
import { ChatModel, openai } from "aiclient";
import { ActionContext, ActionResult, Entity } from "@typeagent/agent-sdk";
import {
    createActionResultFromError,
    createActionResultNoDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { displayError } from "@typeagent/agent-sdk/helpers/display";
import { agents, bingWithGrounding } from "azure-ai-foundry";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";

/**
 * The accumulated answer from a Grounding with Bing lookup: the answer text and
 * the url citations that back it.
 */
type GroundingAnswer = {
    text: string;
    citations: agents.UrlCitation[];
};

function urlToHtml(url: string, title?: string | undefined): string {
    return `<a href="${url}" target="_blank">${title ? title : url}</a>`;
}

function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function answerToHtml(answer: GroundingAnswer): string {
    let html = "<p><div>";

    let annotations = "";
    let refCount = 0;
    for (const citation of answer.citations) {
        annotations += urlToHtml(
            citation.url,
            `${++refCount}. ${citation.title}`,
        );
        annotations += "<br/>";
    }

    if (annotations.length > 0) {
        annotations = `<br /><div class=\"references\">References:<br/>${annotations}`;
    }

    const text = answer.text.replaceAll("\n", "<br/>");

    html += "</div><div>";
    html += `${text}<br/>${annotations}`;
    html += "</div>";

    html += "</div>";
    return html;
}

function answersToHtml(answers: GroundingAnswer[]): string {
    let html = "";
    for (const a of answers) {
        html += answerToHtml(a);
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
    if (!lookups || lookups.length === 0) {
        return createActionResultFromError("No lookups provided.");
    }

    context.actionIO.setDisplay({
        type: "html",
        content: lookupToHtml(lookups),
    });

    // run bing with grounding lookup
    const results = await runGroundingLookup(request, lookups, sites, context);

    if (results.length > 0) {
        context.actionIO.setDisplay({
            type: "html",
            content: answersToHtml(results),
        });
        return await createActionResultWithMessage(results, settings);
    }

    return createActionResultFromError(
        "There was an error searching for information on Grounding with Bing.",
    );
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

async function createActionResultWithMessage(
    answers: GroundingAnswer[],
    settings: LookupSettings,
): Promise<ActionResult> {
    let historyText = "";
    let linkEntities: Entity[] = [];
    let refCount = 0;
    for (const answer of answers) {
        historyText += `${answer.text}\n`;

        for (const citation of answer.citations) {
            historyText += `Reference: ${citation.title} - ${citation.url}`;
            linkEntities.push({
                type: ["link", "url", "website"],
                name: `Reference #${++refCount} - ${citation.title} - ${citation.url}`,
            });
        }
    }

    if (!historyText) {
        return createActionResultFromError(
            "Grounding with Bing returned not text in the result.",
        );
    }

    if (!settings.entityGenModel) {
        return createActionResultNoDisplay(historyText, linkEntities);
    }

    const entityText =
        historyText.length > settings.maxEntityTextLength
            ? historyText.slice(0, settings.maxEntityTextLength)
            : historyText;

    return createActionResultNoDisplay(historyText, [
        ...(await extractEntities(settings.entityGenModel, entityText)),
        ...linkEntities,
    ]);
}

let groundingConfig: bingWithGrounding.ApiSettings | undefined;

const groundingAgentName = "TypeAgent-BingGroundingAgent";

/**
 * Ensures the Grounding with Bing prompt agent exists and returns its name.
 */
async function ensureGroundingAgent(
    project: ReturnType<typeof agents.getProject>,
    config: bingWithGrounding.ApiSettings,
): Promise<string> {
    return agents.ensureAgent(project, {
        model: "gpt-4.1",
        name: groundingAgentName,
        description:
            "Answers user questions using Grounding with Bing and cites its sources.",
        temperature: 0.0,
        instructions:
            "You are a research assistant. Use Grounding with Bing to answer the user's question as accurately as possible. " +
            "Prefer the sites the user provides when they are relevant. Always cite your sources.",
        tools: [agents.bingGroundingTool(config.connectionId!)],
    });
}

export async function runGroundingLookup(
    question: string,
    lookups: string[],
    sites: string[] | undefined,
    context: ActionContext<any>,
): Promise<GroundingAnswer[]> {
    if (!groundingConfig) {
        groundingConfig = bingWithGrounding.apiSettingsFromEnv();
    }

    const project = agents.getProject(groundingConfig.endpoint!);

    let agentName: string;
    try {
        agentName = await ensureGroundingAgent(project, groundingConfig);
    } catch (error) {
        displayError(
            `No agent available for Grounding with Bing. Please check your configuration. ${error}`,
            context,
        );
        return [];
    }

    const input = `Here is my question: '${question}'.\nHere are the internet search terms: ${lookups.join(
        ",",
    )}\nHere are the sites I want to search: ${sites?.join("|")}`;

    try {
        context.actionIO.setDisplay({ type: "html", content: "" });

        const result = await agents.runAgentStreaming(
            project,
            agentName,
            input,
            (delta) => {
                context.actionIO.appendDisplay({
                    type: "html",
                    content: `${delta.replaceAll("\n", "<br/>")}`,
                });
            },
        );

        if (result.contentFiltered || !result.text) {
            return [];
        }

        return [{ text: result.text, citations: result.citations }];
    } catch (error) {
        displayError(
            `Error running Grounding with Bing: ${error}. Check for model throttling or content filtering.`,
            context,
        );

        throw error;
    }
}
