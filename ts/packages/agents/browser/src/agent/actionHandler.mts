// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWebSocket } from "common-utils/ws";
import { WebSocket } from "ws";
import {
    ActionContext,
    ActionResult,
    AppAgent,
    AppAgentEvent,
    AppAgentInitSettings,
    ParsedCommandParams,
    ResolveEntityResult,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { displayError } from "@typeagent/agent-sdk/helpers/display";
import { Crossword } from "./crossword/schema/pageSchema.mjs";
import {
    getBoardSchema,
    handleCrosswordAction,
} from "./crossword/actionHandler.mjs";

import { BrowserConnector } from "./browserConnector.mjs";
import { handleCommerceAction } from "./commerce/actionHandler.mjs";
import { TabTitleIndex, createTabTitleIndex } from "./tabTitleIndex.mjs";
import { ChildProcess, fork } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";

import registerDebug from "debug";

// import { handleInstacartAction } from "./instacart/actionHandler.mjs";
import { handleInstacartAction } from "./instacart/planHandler.mjs";

import {
    loadAllowDynamicAgentDomains,
    processWebAgentMessage,
    WebAgentChannels,
} from "./webTypeAgent.mjs";
import { isWebAgentMessage } from "../common/webAgentMessageTypes.mjs";
import { handleSchemaDiscoveryAction } from "./discovery/actionHandler.mjs";
import { BrowserActions, OpenWebPage, ImportWebsiteData, SearchWebsites, GetWebsiteStats } from "./actionsSchema.mjs";
import { CrosswordActions } from "./crossword/schema/userActions.mjs";
import { InstacartActions } from "./instacart/schema/userActions.mjs";
import { ShoppingActions } from "./commerce/schema/userActions.mjs";
import { SchemaDiscoveryActions } from "./discovery/schema/discoveryActions.mjs";
import { ExternalBrowserActions } from "./externalBrowserActionSchema.mjs";
import { BrowserControl } from "./interface.mjs";
import { bingWithGrounding } from "aiclient";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import {
    Agent,
    MessageContentUnion,
    ThreadMessage,
    ToolUtility,
} from "@azure/ai-agents";
import * as website from "website-memory";
import { openai, TextEmbeddingModel } from "aiclient";

const debug = registerDebug("typeagent:browser:action");

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeBrowserContext,
        updateAgentContext: updateBrowserContext,
        executeAction: executeBrowserAction,
        resolveEntity,
        ...getCommandInterface(handlers),
    };
}

export type BrowserActionContext = {
    browserControl?: BrowserControl | undefined;
    webSocket?: WebSocket | undefined;
    webAgentChannels?: WebAgentChannels | undefined;
    crossWordState?: Crossword | undefined;
    browserConnector?: BrowserConnector | undefined;
    browserProcess?: ChildProcess | undefined;
    tabTitleIndex?: TabTitleIndex | undefined;
    allowDynamicAgentDomains?: string[];
    websiteCollection?: website.WebsiteCollection | undefined;
    fuzzyMatchingModel?: TextEmbeddingModel | undefined;
};

export interface urlResolutionAction {
    originalRequest: string;
    url: string;
    urlsEvaluated: string[];
    explanation: string;
    bingSearchQuery: string;
}

async function initializeBrowserContext(
    settings?: AppAgentInitSettings,
): Promise<BrowserActionContext> {
    const browserControl = settings?.options as BrowserControl | undefined;
    return {
        browserControl,
    };
}

async function updateBrowserContext(
    enable: boolean,
    context: SessionContext<BrowserActionContext>,
    schemaName: string,
): Promise<void> {
    if (schemaName !== "browser") {
        // REVIEW: ignore sub-translator updates.
        return;
    }
    if (enable) {
        await loadAllowDynamicAgentDomains(context);
        if (!context.agentContext.tabTitleIndex) {
            context.agentContext.tabTitleIndex = createTabTitleIndex();
        }

        // Initialize website collection if not already present
        if (!context.agentContext.websiteCollection) {
            try {
                // For now, create a new empty website collection
                // TODO: Integrate with index system when "website" type is supported
                context.agentContext.websiteCollection = new website.WebsiteCollection();
                debug("Created new empty website collection");
            } catch (error) {
                debug("Unable to initialize website collection:", error);
                context.agentContext.websiteCollection = new website.WebsiteCollection();
            }
        }

        // Initialize fuzzy matching model for website search
        if (!context.agentContext.fuzzyMatchingModel) {
            context.agentContext.fuzzyMatchingModel = openai.createEmbeddingModel();
        }

        if (context.agentContext.webSocket?.readyState === WebSocket.OPEN) {
            return;
        }

        const webSocket = await createWebSocket("browser", "dispatcher");
        if (webSocket) {
            context.agentContext.webSocket = webSocket;
            context.agentContext.browserConnector = new BrowserConnector(
                context,
            );

            webSocket.onclose = (event: object) => {
                console.error("Browser webSocket connection closed.");
                context.agentContext.webSocket = undefined;
            };
            webSocket.addEventListener("message", async (event: any) => {
                const text = event.data.toString();
                const data = JSON.parse(text);
                if (isWebAgentMessage(data)) {
                    await processWebAgentMessage(data, context);
                    return;
                }

                if (data.error) {
                    console.error(data.error);
                    // TODO: Handle the case where no clients were found. Prompt the user
                    //       to launch inline browser or run automation in the headless browser.
                    return;
                }

                if (data.method) {
                    switch (data.method) {
                        case "enableSiteTranslator": {
                            const targetTranslator = data.params.translator;
                            if (targetTranslator == "browser.crossword") {
                                // initialize crossword state
                                sendSiteTranslatorStatus(
                                    targetTranslator,
                                    "initializing",
                                    context,
                                );
                                context.agentContext.crossWordState =
                                    await getBoardSchema(context);

                                sendSiteTranslatorStatus(
                                    targetTranslator,
                                    "initialized",
                                    context,
                                );

                                if (context.agentContext.crossWordState) {
                                    context.notify(
                                        AppAgentEvent.Info,
                                        "Crossword board initialized.",
                                    );
                                } else {
                                    context.notify(
                                        AppAgentEvent.Error,
                                        "Crossword board initialization failed.",
                                    );
                                }
                            }
                            await context.toggleTransientAgent(
                                targetTranslator,
                                true,
                            );
                            break;
                        }
                        case "disableSiteTranslator": {
                            const targetTranslator = data.params.translator;
                            await context.toggleTransientAgent(
                                targetTranslator,
                                false,
                            );
                            break;
                        }
                        case "addTabIdToIndex":
                        case "deleteTabIdFromIndex":
                        case "getTabIdFromIndex":
                        case "resetTabIdToIndex": {
                            await handleTabIndexActions(
                                {
                                    actionName: data.method,
                                    parameters: data.params,
                                },
                                context,
                                data.id,
                            );
                            break;
                        }

                        case "detectPageActions":
                        case "registerPageDynamicAgent":
                        case "getIntentFromRecording": {
                            const discoveryResult =
                                await handleSchemaDiscoveryAction(
                                    {
                                        actionName: data.method,
                                        parameters: data.params,
                                    },
                                    context,
                                );

                            webSocket.send(
                                JSON.stringify({
                                    id: data.id,
                                    result: discoveryResult.data,
                                }),
                            );
                        }
                    }
                }
            });
        }
    } else {
        const webSocket = context.agentContext.webSocket;
        if (webSocket) {
            webSocket.onclose = null;
            webSocket.close();
        }

        context.agentContext.webSocket = undefined;

        // shut down service
        if (context.agentContext.browserProcess) {
            context.agentContext.browserProcess.kill();
        }
    }
}

async function resolveEntity(
    type: string,
    name: string,
    context: SessionContext<BrowserActionContext>,
): Promise<ResolveEntityResult | undefined> {
    if (type === "WebPage") {
        try {
            const url = await resolveWebPage(context, name);
            if (url) {
                return {
                    match: "exact",
                    entities: [
                        {
                            name,
                            type: ["WebPage"],
                            uniqueId: url,
                        },
                    ],
                };
            }
        } catch {}
    }
    return undefined;
}

async function resolveWebPage(
    context: SessionContext<BrowserActionContext>,
    site: string,
): Promise<string> {
    debug(`Resolving site '${site}'`);

    switch (site.toLowerCase()) {
        case "paleobiodb":
            return "https://paleobiodb.org/navigator/";

        case "crossword":
            return "https://aka.ms/typeagent/sample-crossword";

        case "commerce":
            return "https://www.target.com/";

        case "turtlegraphics":
            return "http://localhost:9000/";
        default:
            // try to resolve URL using LLM + internet search
            const url = await resolveURLWithSearch(site);

            if (url) {
                return url;
            }

            // get local agent
            const port = await context.getSharedLocalHostPort(site);

            if (port !== undefined) {
                debug(`Resolved local site on PORT ${port}`);
                return `http://localhost:${port}`;
            }

            // can't get a URL
            throw new Error(`Unable to find a URL for: '${site}'`);
    }
}

let groundingConfig: bingWithGrounding.ApiSettings | undefined;
async function resolveURLWithSearch(site: string): Promise<string | undefined> {
    if (!groundingConfig) {
        groundingConfig = bingWithGrounding.apiSettingsFromEnv();
    }

    let retVal: string = site;
    const project = new AIProjectClient(
        groundingConfig.endpoint!,
        new DefaultAzureCredential(),
    );

    const agent = await ensureAgent(groundingConfig, project);

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
async function ensureAgent(
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

async function createAgent(
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
            instructions: `
You are an agent that translates user requests in conjunction with search results to URLs.  If the page does not exist just return an empty URL. Do not make up URLs.

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

async function openWebPage(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<OpenWebPage>,
) {
    if (context.sessionContext.agentContext.browserControl) {
        context.actionIO.setDisplay("Opening web page.");
        const siteEntity = action.entities?.site;
        const url =
            siteEntity?.type[0] === "WebPage"
                ? siteEntity.uniqueId!
                : await resolveWebPage(
                      context.sessionContext,
                      action.parameters.site,
                  );
        await context.sessionContext.agentContext.browserControl.openWebPage(
            url,
        );
        const result = createActionResult("Web page opened successfully.");

        result.activityContext = {
            activityName: "browsingWebPage",
            description: "Browsing a web page",
            state: {
                siteUrl: url,
            },
            activityEndAction: {
                actionName: "closeWebPage",
            },
        };
        return result;
    }
    throw new Error(
        "Browser control is not available. Please launch a browser first.",
    );
}

async function closeWebPage(context: ActionContext<BrowserActionContext>) {
    if (context.sessionContext.agentContext.browserControl) {
        context.actionIO.setDisplay("Closing web page.");
        await context.sessionContext.agentContext.browserControl.closeWebPage();
        const result = createActionResult("Web page closed successfully.");
        result.activityContext = null; // clear the activity context.
        return result;
    }
    throw new Error(
        "Browser control is not available. Please launch a browser first.",
    );
}

async function importWebsiteData(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<ImportWebsiteData>,
) {
    try {
        context.actionIO.setDisplay("Importing website data...");
        
        const { source, type, limit, days, folder } = action.parameters;
        const defaultPaths = website.getDefaultBrowserPaths();
        
        let filePath: string;
        if (source === "chrome") {
            filePath = type === "bookmarks" ? defaultPaths.chrome.bookmarks : defaultPaths.chrome.history;
        } else {
            filePath = type === "bookmarks" ? defaultPaths.edge.bookmarks : defaultPaths.edge.history;
        }

        const progressCallback = (current: number, total: number, item: string) => {
            if (current % 100 === 0) { // Update every 100 items
                context.actionIO.setDisplay(`Importing... ${current}/${total}: ${item.substring(0, 50)}...`);
            }
        };

        // Build options object with only defined values
        const importOptions: any = {};
        if (limit !== undefined) importOptions.limit = limit;
        if (days !== undefined) importOptions.days = days;
        if (folder !== undefined) importOptions.folder = folder;

        const websites = await website.importWebsites(
            source,
            type,
            filePath,
            importOptions,
            progressCallback
        );

        if (!context.sessionContext.agentContext.websiteCollection) {
            context.sessionContext.agentContext.websiteCollection = new website.WebsiteCollection();
        }

        context.sessionContext.agentContext.websiteCollection.addWebsites(websites);
        await context.sessionContext.agentContext.websiteCollection.buildIndex();

        const result = createActionResult(
            `Successfully imported ${websites.length} ${type} from ${source}.`
        );
        return result;
    } catch (error: any) {
        return createActionResult(`Failed to import website data: ${error.message}`, true);
    }
}

async function searchWebsites(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<SearchWebsites>,
) {
    try {
        const websiteCollection = context.sessionContext.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return createActionResult("No website data available. Please import website data first.", true);
        }

        context.actionIO.setDisplay("Searching websites...");
        
        const { query, domain, pageType, source, limit = 10, minScore = 0.5 } = action.parameters;
        
        // Build search filters
        const searchFilters = [query];
        if (domain) searchFilters.push(domain);
        if (pageType) searchFilters.push(pageType);

        // Use the improved search function
        let matchedWebsites = await findRequestedWebsites(
            searchFilters,
            context.sessionContext.agentContext,
            false,
            minScore
        );

        // Apply additional filters
        if (source) {
            matchedWebsites = matchedWebsites.filter(site => site.metadata.websiteSource === source);
        }
        
        // Limit results
        matchedWebsites = matchedWebsites.slice(0, limit);

        if (matchedWebsites.length === 0) {
            return createActionResult("No websites found matching the search criteria.");
        }

        const resultText = matchedWebsites.map((site, i) => {
            const metadata = site.metadata;
            return `${i + 1}. ${metadata.title || metadata.url}\n   URL: ${metadata.url}\n   Domain: ${metadata.domain} | Type: ${metadata.pageType} | Source: ${metadata.websiteSource}\n`;
        }).join('\n');

        return createActionResult(`Found ${matchedWebsites.length} websites:\n\n${resultText}`);
    } catch (error: any) {
        return createActionResult(`Failed to search websites: ${error.message}`, true);
    }
}

async function getWebsiteStats(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<GetWebsiteStats>,
) {
    try {
        const websiteCollection = context.sessionContext.agentContext.websiteCollection;
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return createActionResult("No website data available. Please import website data first.", true);
        }

        const { groupBy = "domain", limit = 10 } = action.parameters || {};
        const websites = websiteCollection.messages.getAll();
        
        let stats: { [key: string]: number } = {};
        let totalCount = websites.length;

        for (const site of websites) {
            const metadata = site.metadata;
            let key: string;
            
            switch (groupBy) {
                case "domain":
                    key = metadata.domain || "unknown";
                    break;
                case "pageType":
                    key = metadata.pageType || "general";
                    break;
                case "source":
                    key = metadata.websiteSource;
                    break;
                default:
                    key = metadata.domain || "unknown";
            }
            
            stats[key] = (stats[key] || 0) + 1;
        }

        // Sort by count and limit
        const sortedStats = Object.entries(stats)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit);

        let resultText = `Website Statistics (Total: ${totalCount} sites)\n\n`;
        resultText += `Top ${groupBy}s:\n`;
        
        for (const [key, count] of sortedStats) {
            const percentage = ((count / totalCount) * 100).toFixed(1);
            resultText += `  ${key}: ${count} sites (${percentage}%)\n`;
        }

        // Add some additional stats
        if (groupBy !== "source") {
            const sourceCounts = { bookmark: 0, history: 0, reading_list: 0 };
            for (const site of websites) {
                sourceCounts[site.metadata.websiteSource]++;
            }
            resultText += `\nBy Source:\n`;
            for (const [source, count] of Object.entries(sourceCounts)) {
                if (count > 0) {
                    const percentage = ((count / totalCount) * 100).toFixed(1);
                    resultText += `  ${source}: ${count} sites (${percentage}%)\n`;
                }
            }
        }

        return createActionResult(resultText);
    } catch (error: any) {
        return createActionResult(`Failed to get website stats: ${error.message}`, true);
    }
}

/**
 * Find websites matching search criteria, similar to findRequestedImages in montage agent
 */
async function findRequestedWebsites(
    searchFilters: string[],
    context: BrowserActionContext,
    exactMatch: boolean = false,
    minScore: number = 0.5,
): Promise<website.Website[]> {
    if (!context.websiteCollection) {
        return [];
    }

    const websites = context.websiteCollection.messages.getAll();
    const results: { website: website.Website; score: number }[] = [];

    for (const site of websites) {
        const metadata = site.metadata;
        let score = 0;
        
        for (const filter of searchFilters) {
            const filterLower = filter.toLowerCase();
            
            // Check title match
            if (metadata.title && metadata.title.toLowerCase().includes(filterLower)) {
                score += exactMatch ? 1.0 : 0.8;
            }
            
            // Check domain match
            if (metadata.domain && metadata.domain.toLowerCase().includes(filterLower)) {
                score += exactMatch ? 1.0 : 0.6;
            }
            
            // Check URL match
            if (metadata.url.toLowerCase().includes(filterLower)) {
                score += exactMatch ? 1.0 : 0.4;
            }
            
            // Check page type match
            if (metadata.pageType && metadata.pageType.toLowerCase().includes(filterLower)) {
                score += exactMatch ? 1.0 : 0.5;
            }
            
            // Check folder path for bookmarks
            if (metadata.folder && metadata.folder.toLowerCase().includes(filterLower)) {
                score += exactMatch ? 1.0 : 0.3;
            }
        }
        
        if (score >= minScore) {
            results.push({ website: site, score });
        }
    }
    
    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    
    return results.map(r => r.website);
}

async function executeBrowserAction(
    action:
        | TypeAgentAction<BrowserActions, "browser">
        | TypeAgentAction<ExternalBrowserActions, "browser.external">
        | TypeAgentAction<CrosswordActions, "browser.crossword">
        | TypeAgentAction<ShoppingActions, "browser.commerce">
        | TypeAgentAction<InstacartActions, "browser.instacart">
        | TypeAgentAction<SchemaDiscoveryActions, "browser.actionDiscovery">,

    context: ActionContext<BrowserActionContext>,
) {
    if (action.schemaName === "browser") {
        switch (action.actionName) {
            case "openWebPage":
                return openWebPage(context, action);
            case "closeWebPage":
                return closeWebPage(context);
            case "importWebsiteData":
                return importWebsiteData(context, action);
            case "searchWebsites":
                return searchWebsites(context, action);
            case "getWebsiteStats":
                return getWebsiteStats(context, action);
        }
    }
    const webSocketEndpoint = context.sessionContext.agentContext.webSocket;
    const connector = context.sessionContext.agentContext.browserConnector;
    if (webSocketEndpoint) {
        try {
            context.actionIO.setDisplay("Running remote action.");

            let schemaName = "browser";
            if (action.schemaName === "browser.crossword") {
                const crosswordResult = await handleCrosswordAction(
                    action,
                    context.sessionContext,
                );
                return createActionResult(crosswordResult);
            } else if (action.schemaName === "browser.commerce") {
                const commerceResult = await handleCommerceAction(
                    action,
                    context,
                );
                if (commerceResult !== undefined) {
                    if (commerceResult instanceof String) {
                        return createActionResult(
                            commerceResult as unknown as string,
                        );
                    } else {
                        return commerceResult as ActionResult;
                    }
                }
            } else if (action.schemaName === "browser.instacart") {
                const instacartResult = await handleInstacartAction(
                    action,
                    context.sessionContext,
                );

                return createActionResult(
                    instacartResult.displayText,
                    undefined,
                    instacartResult.entities,
                );

                // return createActionResult(instacartResult);
            } else if (action.schemaName === "browser.actionDiscovery") {
                const discoveryResult = await handleSchemaDiscoveryAction(
                    action,
                    context.sessionContext,
                );

                return createActionResult(discoveryResult.displayText);
            }

            await connector?.sendActionToBrowser(action, schemaName);
        } catch (ex: any) {
            if (ex instanceof Error) {
                console.error(ex);
            } else {
                console.error(JSON.stringify(ex));
            }

            throw new Error("Unable to contact browser backend.");
        }
    } else {
        throw new Error("No websocket connection.");
    }
    return undefined;
}

function sendSiteTranslatorStatus(
    schemaName: string,
    status: string,
    context: SessionContext<BrowserActionContext>,
) {
    const webSocketEndpoint = context.agentContext.webSocket;
    const callId = new Date().getTime().toString();

    if (webSocketEndpoint) {
        webSocketEndpoint.send(
            JSON.stringify({
                method: "browser/siteTranslatorStatus",
                id: callId,
                params: {
                    translator: schemaName,
                    status: status,
                },
            }),
        );
    }
}

async function handleTabIndexActions(
    action: any,
    context: SessionContext<BrowserActionContext>,
    requestId: string | undefined,
) {
    const webSocketEndpoint = context.agentContext.webSocket;
    const tabTitleIndex = context.agentContext.tabTitleIndex;

    if (webSocketEndpoint && tabTitleIndex) {
        try {
            const actionName =
                action.actionName ?? action.fullActionName.split(".").at(-1);
            let responseBody;

            switch (actionName) {
                case "getTabIdFromIndex": {
                    const matchedTabs = await tabTitleIndex.search(
                        action.parameters.query,
                        1,
                    );
                    let foundId = -1;
                    if (matchedTabs && matchedTabs.length > 0) {
                        foundId = matchedTabs[0].item.value;
                    }
                    responseBody = foundId;
                    break;
                }
                case "addTabIdToIndex": {
                    await tabTitleIndex.addOrUpdate(
                        action.parameters.title,
                        action.parameters.id,
                    );
                    responseBody = "OK";
                    break;
                }
                case "deleteTabIdFromIndex": {
                    await tabTitleIndex.remove(action.parameters.id);
                    responseBody = "OK";
                    break;
                }
                case "resetTabIdToIndex": {
                    await tabTitleIndex.reset();
                    responseBody = "OK";
                    break;
                }
            }

            webSocketEndpoint.send(
                JSON.stringify({
                    id: requestId,
                    result: responseBody,
                }),
            );
        } catch (ex: any) {
            if (ex instanceof Error) {
                console.error(ex);
            } else {
                console.error(JSON.stringify(ex));
            }

            throw new Error("Unable to contact browser backend.");
        }
    } else {
        throw new Error("No websocket connection.");
    }
    return undefined;
}

export async function createAutomationBrowser(isVisible?: boolean) {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(undefined), 10000);
    });

    const hiddenWindowPromise = new Promise<ChildProcess | undefined>(
        (resolve, reject) => {
            try {
                const expressService = fileURLToPath(
                    new URL(
                        path.join("..", "./puppeteer/index.mjs"),
                        import.meta.url,
                    ),
                );

                const childProcess = fork(expressService, [
                    isVisible ? "true" : "false",
                ]);

                childProcess.on("message", function (message) {
                    if (message === "Success") {
                        resolve(childProcess);
                    } else if (message === "Failure") {
                        resolve(undefined);
                    }
                });

                childProcess.on("exit", (code) => {
                    debug("Browser instance exited with code:", code);
                });
            } catch (e: any) {
                console.error(e);
                resolve(undefined);
            }
        },
    );

    return Promise.race([hiddenWindowPromise, timeoutPromise]).then(
        (result) => {
            clearTimeout(timeoutHandle);
            return result;
        },
    );
}

class OpenStandaloneAutomationBrowserHandler implements CommandHandlerNoParams {
    public readonly description = "Open a standalone browser instance";
    public async run(context: ActionContext<BrowserActionContext>) {
        if (context.sessionContext.agentContext.browserProcess) {
            context.sessionContext.agentContext.browserProcess.kill();
        }
        context.sessionContext.agentContext.browserProcess =
            await createAutomationBrowser(true);
    }
}

class OpenHiddenAutomationBrowserHandler implements CommandHandlerNoParams {
    public readonly description = "Open a hidden/headless browser instance";
    public async run(context: ActionContext<BrowserActionContext>) {
        if (context.sessionContext.agentContext.browserProcess) {
            context.sessionContext.agentContext.browserProcess.kill();
        }
        context.sessionContext.agentContext.browserProcess =
            await createAutomationBrowser(false);
    }
}

class CloseBrowserHandler implements CommandHandlerNoParams {
    public readonly description = "Close the new Web Content view";
    public async run(context: ActionContext<BrowserActionContext>) {
        if (context.sessionContext.agentContext.browserProcess) {
            context.sessionContext.agentContext.browserProcess.kill();
        }
    }
}

class OpenWebPageHandler implements CommandHandler {
    public readonly description = "Show a new Web Content view";
    public readonly parameters = {
        args: {
            site: {
                description: "Alias or URL for the site of the open.",
            },
        },
    } as const;
    public async run(
        context: ActionContext<BrowserActionContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const result = await openWebPage(context, {
            actionName: "openWebPage",
            schemaName: "browser",
            parameters: {
                site: params.args.site,
            },
        });
        if (result.error) {
            displayError(result.error, context);
            return;
        }
        context.actionIO.setDisplay(result.displayContent);
        // REVIEW: command doesn't set the activity context
    }
}

class CloseWebPageHandler implements CommandHandlerNoParams {
    public readonly description = "Close the new Web Content view";
    public async run(context: ActionContext<BrowserActionContext>) {
        const result = await closeWebPage(context);
        if (result.error) {
            displayError(result.error, context);
            return;
        }
        context.actionIO.setDisplay(result.displayContent);

        // REVIEW: command doesn't clear the activity context
    }
}

class ImportWebsiteDataHandler implements CommandHandler {
    public readonly description = "Import website data from browser history or bookmarks";
    public readonly parameters = {
        args: {
            source: {
                description: "Browser source: chrome or edge",
            },
            type: {
                description: "Data type: history or bookmarks",
            },
            limit: {
                description: "Maximum number of items to import (optional)",
                optional: true,
            },
            days: {
                description: "Number of days back to import (optional, for history)",
                optional: true,
            },
            folder: {
                description: "Specific bookmark folder to import (optional, for bookmarks)",
                optional: true,
            },
        },
    } as const;
    
    public async run(
        context: ActionContext<BrowserActionContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const parameters: any = {
            source: params.args.source as "chrome" | "edge",
            type: params.args.type as "history" | "bookmarks",
        };
        
        if (params.args.limit) {
            parameters.limit = parseInt(params.args.limit);
        }
        if (params.args.days) {
            parameters.days = parseInt(params.args.days);
        }
        if (params.args.folder) {
            parameters.folder = params.args.folder;
        }

        const result = await importWebsiteData(context, {
            actionName: "importWebsiteData",
            schemaName: "browser",
            parameters,
        });
        if (result.error) {
            displayError(result.error, context);
            return;
        }
        context.actionIO.setDisplay(result.displayContent);
    }
}

class SearchWebsitesHandler implements CommandHandler {
    public readonly description = "Search through imported website data";
    public readonly parameters = {
        args: {
            query: {
                description: "Search query",
            },
            domain: {
                description: "Filter by domain (optional)",
                optional: true,
            },
            pageType: {
                description: "Filter by page type (optional)",
                optional: true,
            },
            source: {
                description: "Filter by source: bookmark or history (optional)",
                optional: true,
            },
            limit: {
                description: "Maximum number of results (optional, default 10)",
                optional: true,
            },
        },
    } as const;
    
    public async run(
        context: ActionContext<BrowserActionContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const parameters: any = {
            query: params.args.query,
        };
        
        if (params.args.domain) {
            parameters.domain = params.args.domain;
        }
        if (params.args.pageType) {
            parameters.pageType = params.args.pageType;
        }
        if (params.args.source) {
            parameters.source = params.args.source as "bookmark" | "history";
        }
        if (params.args.limit) {
            parameters.limit = parseInt(params.args.limit);
        }

        const result = await searchWebsites(context, {
            actionName: "searchWebsites",
            schemaName: "browser",
            parameters,
        });
        if (result.error) {
            displayError(result.error, context);
            return;
        }
        context.actionIO.setDisplay(result.displayContent);
    }
}

class GetWebsiteStatsHandler implements CommandHandler {
    public readonly description = "Get statistics about imported website data";
    public readonly parameters = {
        args: {
            groupBy: {
                description: "Group by: domain, pageType, or source (optional, default domain)",
                optional: true,
            },
            limit: {
                description: "Maximum number of groups to show (optional, default 10)",
                optional: true,
            },
        },
    } as const;
    
    public async run(
        context: ActionContext<BrowserActionContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const parameters: any = {};
        
        if (params.args.groupBy) {
            parameters.groupBy = params.args.groupBy as "domain" | "pageType" | "source";
        }
        if (params.args.limit) {
            parameters.limit = parseInt(params.args.limit);
        }

        const result = await getWebsiteStats(context, {
            actionName: "getWebsiteStats",
            schemaName: "browser",
            parameters,
        });
        if (result.error) {
            displayError(result.error, context);
            return;
        }
        context.actionIO.setDisplay(result.displayContent);
    }
}

export const handlers: CommandHandlerTable = {
    description: "Browser App Agent Commands",
    commands: {
        auto: {
            description: "Run the browser automation",
            defaultSubCommand: "launch",
            commands: {
                launch: {
                    description: "Launch a browser session",
                    defaultSubCommand: "standalone",
                    commands: {
                        hidden: new OpenHiddenAutomationBrowserHandler(),
                        standalone:
                            new OpenStandaloneAutomationBrowserHandler(),
                    },
                },
                close: new CloseBrowserHandler(),
            },
        },

        open: new OpenWebPageHandler(),
        close: new CloseWebPageHandler(),
        website: {
            description: "Website memory commands",
            commands: {
                import: new ImportWebsiteDataHandler(),
                search: new SearchWebsitesHandler(),
                stats: new GetWebsiteStatsHandler(),
            },
        },
    },
};
