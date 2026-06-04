// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as bingWithGrounding from "./bingWithGrounding.js";
import * as agents from "./agents.js";
import { AIProjectClient } from "@azure/ai-projects";
import { createTypeChat } from "typeagent";
import registerDebug from "debug";
import { ChatModelWithStreaming, CompletionSettings, openai } from "aiclient";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Result } from "typechat";
import * as wikipediaSchemas from "./wikipediaSchemas.js";
import * as wikipedia from "./wikipedia.js";

const debug = registerDebug("typeagent:azure-ai-foundry:urlResolver");

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

const urlResolutionAgentId = "TypeAgent-URLResolverAgent";
export async function flushAgent(
    groundingConfig: bingWithGrounding.ApiSettings,
) {
    const project = agents.getProject(groundingConfig.endpoint!);
    await agents.flushAgents(
        urlResolutionAgentId,
        [urlResolutionAgentId],
        project,
    );
}

export async function deleteThreads(
    groundingConfig: bingWithGrounding.ApiSettings,
) {
    const project = agents.getProject(groundingConfig.endpoint!);
    await agents.deleteThreads(project);
}

export async function resolveURLWithSearch(
    site: string,
    groundingConfig: bingWithGrounding.ApiSettings,
): Promise<string[] | undefined | null> {
    let retVal: string[] | undefined | null = [];
    const project = agents.getProject(groundingConfig.endpoint!);

    const agentName = await ensureResolverAgent(groundingConfig, project);

    if (!agentName) {
        throw new Error(
            "No agent found for Bing with Grounding. Please check your configuration.",
        );
    }

    try {
        const result = await agents.runAgent(project, agentName, site);

        if (result.contentFiltered) {
            return null;
        }

        const url = agents.parseJsonResponse<urlResolutionAction>(result.text);
        if (url) {
            retVal.push(url.url, ...url.urlsEvaluated);
            retVal = [...new Set(retVal)]; // remove duplicates
        }
    } catch (e) {
        debug(`Error resolving URL with search: ${e}`);
        retVal = undefined;
    }

    return retVal;
}

/**
 * Attempts to retrive the URL resolution agent from the AI project and creates it if necessary
 */
async function ensureResolverAgent(
    groundingConfig: bingWithGrounding.ApiSettings,
    project: AIProjectClient,
): Promise<string> {
    // tool connection ids are in the format: /subscriptions/<SUBSCRIPTION ID>/resourceGroups/<RESOURCE GROUP>/providers/Microsoft.CognitiveServices/accounts/<AI FOUNDRY RESOURCE>/projects/<PROJECT NAME>/connections/<CONNECTION NAME>>

    return await agents.ensureAgent(project, {
        model: "gpt-4.1",
        name: "TypeAgent-URLResolverAgent",
        description: "Auto created URL Resolution Agent",
        temperature: 0.01,
        instructions: `
You are an agent that translates user requests in conjunction with search results to URLs.  If the page does not exist just return an empty URL. Do not make up URLs.  Choose to answer the user's question by favoring websites closer to the user. Don't restrict searches to specific domains unless the user provided the domain. If the user request doesn't specify or imply 'website', add that to the search terms.

Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:

interface Response {
    originalRequest: string;
    url: string;
    urlsEvaluated: string[];
    explanation: string;
    bingSearchQuery: string;
}`,
        tools: [agents.bingGroundingTool(groundingConfig.connectionId!)],
    });
}

/**
 * Attempts to retrive the URL resolution agent from the AI project and creates it if necessary
 */
async function ensureValidatorAgent(
    groundingConfig: bingWithGrounding.ApiSettings,
    project: AIProjectClient,
): Promise<string> {
    // tool connection ids are in the format: /subscriptions/<SUBSCRIPTION ID>/resourceGroups/<RESOURCE GROUP>/providers/Microsoft.CognitiveServices/accounts/<AI FOUNDRY RESOURCE>/projects/<PROJECT NAME>/connections/<CONNECTION NAME>>

    return await agents.ensureAgent(project, {
        model: "gpt-4.1",
        name: "TypeAgent-URLValidatorAgent",
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
            agents.bingGroundingTool(
                groundingConfig.httpEndpointLogicAppConnectionId!,
            ),
        ],
    });
}

export async function validateURL(
    utterance: string,
    url: string,
    groundingConfig: bingWithGrounding.ApiSettings,
): Promise<urlValidityAction | undefined> {
    debug(`Validating URL for utterance: ${utterance}, url: ${url}`);

    const project = agents.getProject(groundingConfig.endpoint!);

    try {
        const agentName = await ensureValidatorAgent(groundingConfig, project);
        const input = JSON.stringify({ request: utterance, url: url });

        let retryCount = 0;
        const maxRetries = 5;

        while (retryCount < maxRetries) {
            try {
                const result = await agents.runAgent(project, agentName, input);

                if (result.contentFiltered) {
                    return undefined;
                }

                const validity = agents.parseJsonResponse<urlValidityAction>(
                    result.text,
                );
                if (validity) {
                    return validity;
                }
            } catch (pollingError) {
                /*
                    Getting lots of 502s from Logic App for getting web page content.

                    last_error: {
                        code: 'tool_user_error',
                        message: 'Error: http_client_error; HTTP error 502: Bad Gateway',
                        debug_info: [Object]
                    },
                */
                debug(
                    `Error validating URL (attempt ${retryCount}): ${pollingError}`,
                );
            } finally {
                retryCount++;
            }
        }

        if (retryCount >= maxRetries) {
            console.log("MAXIMUM RETRY COUNT EXCEEDED!!!");
        }
    } catch (e) {
        debug(`Error validating URL: ${e}`);
    }

    return undefined;
}

/**
 * Attempts to resolve a website by looking at wikipedia entries and then determining the correct URL from it
 */
export async function resolveURLWithWikipedia(
    site: string,
    wikipediaConfig: wikipedia.WikipediaApiSettings,
    max_results: number = 3,
): Promise<string[]> {
    // TODO: implement
    console.log(`${site} ${wikipediaConfig}`);

    const languageCode = Intl.DateTimeFormat()
        .resolvedOptions()
        .locale.split("-")[0];
    const searchQuery = `${site}`;
    const numberOfResults = 1;
    const headers = await wikipediaConfig.getAPIHeaders();

    const baseUrl = `${wikipediaConfig.endpoint}`;
    const search_endpoint = "/search/page";
    const url = `${baseUrl}${languageCode}${search_endpoint}`;
    const parameters = new URLSearchParams({
        q: searchQuery,
        limit: numberOfResults.toString(),
    });

    let retVal: string[] = [];
    await fetch(`${url}?${parameters}`, { method: "GET", headers: headers })
        .then((response) => response.json())
        .then(async (data: any) => {
            // go through the pages
            for (let i = 0; i < data.pages.length && i < max_results; i++) {
                // get the page markdown
                const content = await wikipedia.getPageMarkdown(
                    data.pages[i].title,
                    wikipediaConfig,
                );

                if (content) {
                    const response = await getTypeChatResponse(
                        content!,
                        wikipediaConfig,
                    );
                    if (response.success) {
                        const externalLinks =
                            response.data as wikipediaSchemas.WikipediaPageExternalLinks;

                        // get the "official website" out of the page if it exists
                        if (externalLinks.officialWebsite) {
                            retVal.push(externalLinks.officialWebsite.url);
                            break; // we found the official website, so break out of the loop
                        }

                        console.log(externalLinks);
                    }
                } else {
                    // no "official website" found, so just use the wikipedia page URL
                    retVal.push(
                        `https://en.wikipedia.org/wiki/${wikipedia.encodeWikipediaTitle(data.pages[i].title)}`,
                    );
                }
            }
        })
        .catch((error) => {
            console.error("Error fetching data:", error);
        });

    return retVal;
}

/**
 * The keyword to site map is a JSON file that maps keywords to sites.
 */
export let keyWordsToSites: Record<string, string[] | undefined> | undefined;

// Build will copy the file from ../../examples/websiteAliases/cache/phrases.json
const phrasesFile = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "phrases.json",
);
/**
 * Resolves a URL by keyword using the URL resolver agent.
 * @param keyword The keyword to resolve.
 * @returns The resolved URL or undefined if not found.
 */
export function resolveURLByKeyword(
    keyword: string,
): string[] | undefined | null {
    if (!keyWordsToSites) {
        const phrasesToSites = JSON.parse(readFileSync(phrasesFile, "utf-8"));
        keyWordsToSites = phrasesToSites;
    }

    // prepend https:// to any URLs that don't already have a protocol specified
    if (keyWordsToSites![keyword] && Array.isArray(keyWordsToSites![keyword])) {
        for (let i = 0; i < keyWordsToSites![keyword]!.length; i++) {
            if (!/^https?:\/\//i.test(keyWordsToSites![keyword]![i])) {
                keyWordsToSites![keyword]![i] =
                    `https://${keyWordsToSites![keyword]![i]}`;
            }
        }
        for (let i = 0; i < keyWordsToSites![keyword]!.length; i++) {
            if (!/^https?:\/\//i.test(keyWordsToSites![keyword]![i])) {
                keyWordsToSites![keyword]![i] =
                    `https://${keyWordsToSites![keyword]![i]}`;
            }
        }
    }

    return keyWordsToSites![keyword] ?? null;
}

async function getTypeChatResponse(
    pageMarkdown: string,
    config: wikipedia.WikipediaApiSettings,
): Promise<Result<wikipediaSchemas.WikipediaPageExternalLinks>> {
    // Create Model instance
    let chatModel = createModel(true);

    // Create Chat History
    let maxContextLength = 8196;
    let maxWindowLength = 30;

    // create TypeChat object
    const chat = createTypeChat<wikipediaSchemas.WikipediaPageExternalLinks>(
        chatModel,
        `
export type WikipediaPageExternalLinks = {
    officialWebsite?: WebPageLink;
}

export type WebPageLink = {
    url: string;
    title?: string;
}            
        `,
        "WikipediaPageExternalLinks",
        "You extract links from Wikipedia markdown pages.",
        [],
        maxContextLength,
        maxWindowLength,
    );

    // make the request
    const chatResponse = await chat.translate(pageMarkdown);

    return chatResponse;
}

function createModel(fastModel: boolean = true): ChatModelWithStreaming {
    let apiSettings: openai.ApiSettings | undefined;
    if (!apiSettings) {
        if (fastModel) {
            apiSettings = openai.localOpenAIApiSettingsFromEnv(
                openai.ModelType.Chat,
                undefined,
                "GPT_4O_mini",
                ["wikipedia"],
            );
        } else {
            // Create default model
            apiSettings = openai.apiSettingsFromEnv();
        }
    }

    let completionSettings: CompletionSettings = {
        temperature: 1.0,
        // Max response tokens
        max_tokens: 1000,
        // createChatModel will remove it if the model doesn't support it
        response_format: { type: "json_object" },
    };

    const chatModel = openai.createChatModel(
        apiSettings,
        completionSettings,
        undefined,
        ["wikipedia"],
    );

    return chatModel;
}
