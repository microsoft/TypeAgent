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
import {
    createActionResult,
    createActionResultFromHtmlDisplay,
    createActionResultFromMarkdownDisplay,
    createActionResultFromTextDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import {
    displayError,
    displayStatus,
    displaySuccess,
} from "@typeagent/agent-sdk/helpers/display";
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
import fs from "node:fs";

import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";

import registerDebug from "debug";

import { handleInstacartAction } from "./instacart/actionHandler.mjs";
import * as website from "website-memory";
import { handleKnowledgeAction } from "./knowledge/knowledgeHandler.mjs";
import {
    searchWebMemories,
    SearchWebMemoriesResponse,
    searchByEntities,
    searchByTopics,
    hybridSearch,
} from "./searchWebMemories.mjs";

import {
    loadAllowDynamicAgentDomains,
    processWebAgentMessage,
    WebAgentChannels,
} from "./webTypeAgent.mjs";
import { isWebAgentMessage } from "../common/webAgentMessageTypes.mjs";
import { handleSchemaDiscoveryAction } from "./discovery/actionHandler.mjs";
import {
    BrowserActions,
    OpenWebPage,
    OpenSearchResult,
} from "./actionsSchema.mjs";
import {
    resolveURLWithHistory,
    importWebsiteDataFromSession,
    importHtmlFolderFromSession,
    getWebsiteStats,
} from "./websiteMemory.mjs";
import { CrosswordActions } from "./crossword/schema/userActions.mjs";
import { InstacartActions } from "./instacart/schema/userActions.mjs";
import { ShoppingActions } from "./commerce/schema/userActions.mjs";
import { SchemaDiscoveryActions } from "./discovery/schema/discoveryActions.mjs";
import { ExternalBrowserActions } from "./externalBrowserActionSchema.mjs";
import { BrowserControl } from "../common/browserControl.mjs";
import { openai, TextEmbeddingModel } from "aiclient";
import { urlResolver, bingWithGrounding } from "azure-ai-foundry";
import { createExternalBrowserClient } from "./rpc/externalBrowserControlClient.mjs";
import { deleteCachedSchema } from "./crossword/cachedSchema.mjs";
import { getCrosswordCommandHandlerTable } from "./crossword/commandHandler.mjs";
import { MacroStore } from "./storage/index.mjs";

const debug = registerDebug("typeagent:browser:action");
const debugWebSocket = registerDebug("typeagent:browser:ws");

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
    clientBrowserControl?: BrowserControl | undefined;
    externalBrowserControl?: BrowserControl | undefined;
    useExternalBrowserControl: boolean;
    webSocket?: WebSocket | undefined;
    webAgentChannels?: WebAgentChannels | undefined;
    crosswordCachedSchemas?: Map<string, Crossword> | undefined;
    crossWordState?: Crossword | undefined;
    browserConnector?: BrowserConnector | undefined;
    browserProcess?: ChildProcess | undefined;
    tabTitleIndex?: TabTitleIndex | undefined;
    allowDynamicAgentDomains?: string[];
    websiteCollection?: website.WebsiteCollection | undefined;
    fuzzyMatchingModel?: TextEmbeddingModel | undefined;
    index: website.IndexData | undefined;
    viewProcess?: ChildProcess | undefined;
    localHostPort: number;
    macrosStore?: MacroStore | undefined; // Add MacroStore instance
    currentWebSearchResults?: Map<string, any[]> | undefined; // Store search results for follow-up actions
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
    const clientBrowserControl = settings?.options as
        | BrowserControl
        | undefined;

    const localHostPort = settings?.localHostPort;
    if (localHostPort === undefined) {
        throw new Error("Local view port not assigned.");
    }

    return {
        clientBrowserControl,
        useExternalBrowserControl: clientBrowserControl === undefined,
        index: undefined,
        localHostPort,
        macrosStore: undefined, // Will be initialized in updateBrowserContext
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

        // Initialize MacroStore
        if (!context.agentContext.macrosStore && context.sessionStorage) {
            try {
                const { MacroStore } = await import("./storage/index.mjs");
                context.agentContext.macrosStore = new MacroStore(
                    context.sessionStorage,
                );
                await context.agentContext.macrosStore.initialize();
                debug("ActionsStore initialized successfully");
            } catch (error) {
                debug("Failed to initialize ActionsStore:", error);
                // Continue without ActionsStore - will fall back to legacy storage
            }
        }

        // Load the website index from disk
        if (!context.agentContext.websiteCollection) {
            try {
                const websiteIndexes = await context.indexes("website");

                if (websiteIndexes.length > 0) {
                    context.agentContext.index = websiteIndexes[0];
                    context.agentContext.websiteCollection =
                        await website.WebsiteCollection.readFromFile(
                            websiteIndexes[0].path,
                            "index",
                        );
                    debug(
                        `Loaded website index with ${context.agentContext.websiteCollection?.messages.length || 0} websites`,
                    );
                } else {
                    debug(
                        "No existing website index found, checking for index file at target path",
                    );

                    let indexPath: string | undefined;
                    let websiteCollection:
                        | website.WebsiteCollection
                        | undefined;

                    // Try to determine the target index path
                    try {
                        const sessionDir = await getSessionFolderPath(context);
                        if (sessionDir) {
                            // Create index path following IndexManager pattern: sessionDir/indexes/website
                            indexPath = path.resolve(
                                sessionDir,
                                "..",
                                "indexes",
                                "website",
                                "index",
                            );

                            // Check if the index file exists and try to read it
                            if (fs.existsSync(indexPath)) {
                                try {
                                    websiteCollection =
                                        await website.WebsiteCollection.readFromFile(
                                            indexPath,
                                            "index",
                                        );

                                    if (
                                        websiteCollection &&
                                        websiteCollection.messages.length > 0
                                    ) {
                                        context.agentContext.websiteCollection =
                                            websiteCollection;

                                        // Create proper IndexData object for the loaded collection
                                        context.agentContext.index = {
                                            source: "website",
                                            name: "website-index",
                                            location: "browser-agent",
                                            size: websiteCollection.messages
                                                .length,
                                            path: indexPath,
                                            state: "finished",
                                            progress: 100,
                                            sizeOnDisk: 0,
                                        };

                                        debug(
                                            `Loaded existing website collection with ${websiteCollection.messages.length} websites from ${indexPath}`,
                                        );
                                    } else {
                                        debug(
                                            `File exists but collection is empty at ${indexPath}, will create new collection`,
                                        );
                                        websiteCollection = undefined;
                                    }
                                } catch (readError) {
                                    debug(
                                        `Failed to read existing collection: ${readError}`,
                                    );
                                    websiteCollection = undefined;
                                }
                            } else {
                                debug(
                                    `No existing collection file found at ${indexPath}`,
                                );
                            }
                        }
                    } catch (pathError) {
                        debug(`Error determining index path: ${pathError}`);
                        indexPath = undefined;
                    }

                    // If we couldn't load an existing collection, create a new one
                    if (!websiteCollection) {
                        context.agentContext.websiteCollection =
                            new website.WebsiteCollection();

                        // Set up index if we have a valid path
                        if (indexPath) {
                            try {
                                // Ensure directory exists
                                fs.mkdirSync(indexPath, { recursive: true });

                                // Create proper IndexData object
                                context.agentContext.index = {
                                    source: "website",
                                    name: "website-index",
                                    location: "browser-agent",
                                    size: 0,
                                    path: indexPath,
                                    state: "new",
                                    progress: 0,
                                    sizeOnDisk: 0,
                                };

                                debug(
                                    `Created index structure at ${indexPath}`,
                                );
                            } catch (createError) {
                                debug(
                                    `Error creating index directory: ${createError}`,
                                );
                                context.agentContext.index = undefined;
                            }
                        } else {
                            context.agentContext.index = undefined;
                            debug(
                                "No index path available, collection will be in-memory only",
                            );
                        }
                    }

                    // Log final state
                    if (!context.agentContext.index) {
                        debug(
                            "Website collection created without persistent index - data will be in-memory only",
                        );
                    }
                }
            } catch (error) {
                debug("Error initializing website collection:", error);
                // Fallback to empty collection without index
                context.agentContext.websiteCollection =
                    new website.WebsiteCollection();
                context.agentContext.index = undefined;
            }
        }

        // Initialize fuzzy matching model for website search
        if (!context.agentContext.fuzzyMatchingModel) {
            context.agentContext.fuzzyMatchingModel =
                openai.createEmbeddingModel();
        }

        if (!context.agentContext.viewProcess) {
            context.agentContext.viewProcess =
                await createViewServiceHost(context);
        }

        if (context.agentContext.webSocket?.readyState === WebSocket.OPEN) {
            return;
        }

        const webSocket = await createWebSocket("browser", "dispatcher");
        if (webSocket) {
            context.agentContext.webSocket = webSocket;
            const browserControls = createExternalBrowserClient(webSocket);
            context.agentContext.externalBrowserControl = browserControls;
            context.agentContext.browserConnector = new BrowserConnector(
                webSocket,
                browserControls,
            );

            webSocket.onclose = (event: object) => {
                debugWebSocket("Browser webSocket connection closed.");
                context.agentContext.webSocket = undefined;
            };
            webSocket.addEventListener("message", async (event: any) => {
                const text = event.data.toString();
                const data = JSON.parse(text);
                debugWebSocket(`Received message from browser: ${text}`);
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
                                browserControls.setAgentStatus(
                                    true,
                                    `Initializing ${targetTranslator}`,
                                );
                                try {
                                    context.agentContext.crossWordState =
                                        await getBoardSchema(context);

                                    browserControls.setAgentStatus(
                                        false,
                                        `Finished initializing ${targetTranslator}`,
                                    );
                                } catch (e) {
                                    browserControls.setAgentStatus(
                                        false,
                                        `Failed to initialize ${targetTranslator}`,
                                    );
                                }

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
                        case "removeCrosswordPageCache": {
                            await deleteCachedSchema(context, data.params.url);
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
                        case "getIntentFromRecording":
                        case "getMacrosForUrl":
                        case "deleteMacro": {
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
                            break;
                        }

                        case "extractKnowledgeFromPage":
                        case "indexWebPageContent":
                        case "checkPageIndexStatus":
                        case "getPageIndexedKnowledge":
                        case "getRecentKnowledgeItems":
                        case "getAnalyticsData":
                        case "getDiscoverInsights":
                        case "getKnowledgeIndexStats":
                        case "clearKnowledgeIndex": {
                            const knowledgeResult = await handleKnowledgeAction(
                                data.method,
                                data.params,
                                context,
                            );

                            webSocket.send(
                                JSON.stringify({
                                    id: data.id,
                                    result: knowledgeResult,
                                }),
                            );
                            break;
                        }

                        case "importWebsiteData":
                        case "importWebsiteDataWithProgress":
                        case "importHtmlFolder":
                        case "getWebsiteStats":
                        case "searchWebMemories":
                        case "searchByEntities":
                        case "searchByTopics":
                        case "hybridSearch": {
                            const websiteResult = await handleWebsiteAction(
                                data.method,
                                data.params,
                                context,
                            );

                            webSocket.send(
                                JSON.stringify({
                                    id: data.id,
                                    result: websiteResult,
                                }),
                            );
                            break;
                        }

                        case "recordActionUsage":
                        case "getActionStatistics": {
                            const macrosResult = await handleMacroStoreAction(
                                data.method,
                                data.params,
                                context,
                            );

                            webSocket.send(
                                JSON.stringify({
                                    id: data.id,
                                    result: macrosResult,
                                }),
                            );
                            break;
                        }

                        case "getViewHostUrl": {
                            const actionsResult = {
                                url: `http://localhost:${context.agentContext.localHostPort}`,
                            };
                            webSocket.send(
                                JSON.stringify({
                                    id: data.id,
                                    result: actionsResult,
                                }),
                            );
                            break;
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

        if (context.agentContext.viewProcess) {
            context.agentContext.viewProcess.kill();
        }
    }
}

async function getSessionFolderPath(
    context: SessionContext<BrowserActionContext>,
) {
    let sessionDir: string | undefined;

    if (!(await context.sessionStorage?.exists("settings.json"))) {
        await context.sessionStorage?.write("settings.json", "");
    }

    const existingFiles = await context.sessionStorage?.list("", {
        fullPath: true,
    });

    if (existingFiles && existingFiles.length > 0) {
        sessionDir = path.dirname(existingFiles[0]);
        debug(`Discovered session directory from existing file: ${sessionDir}`);
    }

    return sessionDir;
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
            if (URL.canParse(site)) {
                // if the site is a valid URL, return it directly
                debug(`Site is a valid URL: ${site}`);
                return site;
            }

            try {
                // handle browser views
                if (site === "planViewer") {
                    const port =
                        await context.getSharedLocalHostPort("browser");
                    if (port !== undefined) {
                        debug(`Resolved local site on PORT ${port}`);

                        return `http://localhost:${port}/plans`;
                    }
                }

                const port = await context.getSharedLocalHostPort(site);

                if (port !== undefined) {
                    debug(`Resolved local site on PORT ${port}`);

                    return `http://localhost:${port}`;
                }
            } catch (e) {
                debug(`Unable to find local host port for '${site}. ${e}'`);
            }

            // try to resolve URL using website visit history first
            const historyUrl = await resolveURLWithHistory(context, site);
            if (historyUrl) {
                debug(`Resolved URL from history: ${historyUrl}`);
                return historyUrl;
            }

            // try to resolve URL using LLM + internet search
            const url = await urlResolver.resolveURLWithSearch(
                site,
                bingWithGrounding.apiSettingsFromEnv(),
            );

            if (url) {
                return url;
            }

            // can't get a URL
            throw new Error(`Unable to find a URL for: '${site}'`);
    }
}

export function getActionBrowserControl(
    actionContext: ActionContext<BrowserActionContext>,
) {
    return getBrowserControl(actionContext.sessionContext.agentContext);
}
export function getSessionBrowserControl(
    sessionContext: SessionContext<BrowserActionContext>,
) {
    return getBrowserControl(sessionContext.agentContext);
}

export function getBrowserControl(agentContext: BrowserActionContext) {
    const browserControl = agentContext.useExternalBrowserControl
        ? agentContext.externalBrowserControl
        : agentContext.clientBrowserControl;
    if (!browserControl) {
        throw new Error(
            `${agentContext.externalBrowserControl ? "External" : "Client"} browser control is not available.`,
        );
    }
    return browserControl;
}

async function openWebPage(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<OpenWebPage>,
) {
    const browserControl = getActionBrowserControl(context);

    displayStatus(`Opening web page for ${action.parameters.site}.`, context);
    const siteEntity = action.entities?.site;
    const url =
        siteEntity?.type[0] === "WebPage"
            ? siteEntity.uniqueId!
            : await resolveWebPage(
                  context.sessionContext,
                  action.parameters.site,
              );

    if (url !== action.parameters.site) {
        displayStatus(
            `Opening web page for ${action.parameters.site} at ${url}.`,
            context,
        );
    }
    await browserControl.openWebPage(url);
    const result = createActionResult("Web page opened successfully.");

    result.activityContext = {
        activityName: "browsingWebPage",
        description: "Browsing a web page",
        state: {
            site: siteEntity?.name,
        },
        activityEndAction: {
            actionName: "closeWebPage",
        },
    };
    return result;
}

async function closeWebPage(context: ActionContext<BrowserActionContext>) {
    const browserControl = getActionBrowserControl(context);
    context.actionIO.setDisplay("Closing web page.");
    await browserControl.closeWebPage();
    const result = createActionResult("Web page closed successfully.");
    result.activityContext = null; // clear the activity context.
    return result;
}

async function openSearchResult(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<OpenSearchResult>,
) {
    const { position, title, url, openInNewTab } = action.parameters;
    const searchResults =
        context.sessionContext.agentContext.currentWebSearchResults;

    if (!searchResults || searchResults.size === 0) {
        throw new Error("No search results available. Please search first.");
    }

    // Get the most recent search results (sorted by timestamp)
    const allSearchIds = Array.from(searchResults.keys()).sort().reverse();
    const latestSearchId = allSearchIds[0];
    const results = searchResults.get(latestSearchId);

    if (!results || results.length === 0) {
        throw new Error("No search results found from recent search.");
    }

    let selectedResult: any = null;

    // Find the result by position (1-based)
    if (position !== undefined) {
        if (position < 1 || position > results.length) {
            throw new Error(
                `Position ${position} is out of range. Available results: 1-${results.length}`,
            );
        }
        selectedResult = results[position - 1];
    }
    // Find the result by title
    else if (title !== undefined) {
        selectedResult = results.find(
            (result: any) =>
                result.title &&
                result.title.toLowerCase().includes(title.toLowerCase()),
        );
        if (!selectedResult) {
            throw new Error(
                `No search result found with title containing: ${title}`,
            );
        }
    }
    // Find the result by URL
    else if (url !== undefined) {
        selectedResult = results.find(
            (result: any) => result.url && result.url === url,
        );
        if (!selectedResult) {
            throw new Error(`No search result found with URL: ${url}`);
        }
    } else {
        throw new Error(
            "Please specify either position, title, or url to open a search result.",
        );
    }

    const browserControl = getActionBrowserControl(context);
    const targetUrl = selectedResult.url;

    displayStatus(`Opening search result: ${selectedResult.title}`, context);

    if (openInNewTab) {
        // Open in new tab - need to implement this in browser control
        await browserControl.openWebPage(targetUrl);
    } else {
        await browserControl.openWebPage(targetUrl);
    }

    return createActionResultFromMarkdownDisplay(
        `Opened search result: [${selectedResult.title}](${targetUrl})`,
        `Opened search result: ${selectedResult.title}`,
    );
}

async function searchWebMemoriesAction(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<any>,
) {
    context.actionIO.setDisplay("Searching web memories...");

    try {
        // Use originalUserRequest to override query if provided
        const searchParams = { ...action.parameters };
        if (searchParams.originalUserRequest) {
            searchParams.query = searchParams.originalUserRequest;
            debug(
                `Using originalUserRequest as query: "${searchParams.originalUserRequest}"`,
            );
        }

        const searchResponse: SearchWebMemoriesResponse =
            await searchWebMemories(searchParams, context.sessionContext);

        if (searchResponse.websites.length === 0) {
            const message =
                searchResponse.answer || "No results found for your search.";
            return createActionResult(message);
        }

        // Store the search results in context for follow-up actions
        if (!context.sessionContext.agentContext.currentWebSearchResults) {
            context.sessionContext.agentContext.currentWebSearchResults =
                new Map();
        }
        const searchId = `search_${Date.now()}`;
        context.sessionContext.agentContext.currentWebSearchResults.set(
            searchId,
            searchResponse.websites,
        );

        // Create entities for webpage results (limit to first 10 to avoid overwhelming the entity system)
        const entities: any[] = [];
        const maxEntities = Math.min(searchResponse.websites.length, 10);

        for (let i = 0; i < maxEntities; i++) {
            const site = searchResponse.websites[i];
            entities.push({
                name: site.title,
                type: ["WebPage", "WebSearchResult"],
                uniqueId: site.url,
                additionalData: {
                    searchIndex: i + 1,
                    searchId: searchId,
                    domain: site.domain,
                    snippet: site.snippet,
                    relevanceScore: site.relevanceScore,
                },
            });
        }

        // Return markdown-formatted results for now
        const markdownContent = generateWebSearchMarkdown(
            searchResponse,
            searchParams.query,
        );
        return createActionResultFromMarkdownDisplay(
            markdownContent,
            `Found ${searchResponse.websites.length} results for "${searchParams.query}".`,
            entities,
        );
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : "Unknown error occurred";
        context.actionIO.appendDisplay(`Search failed: ${errorMessage}`);
        return createActionResult(`Search failed: ${errorMessage}`);
    }
}

export function generateWebSearchHtml(
    searchResponse: SearchWebMemoriesResponse,
    summary: string,
): string {
    let html = `<div class='web-search-results'>`;

    // Add summary header
    html += `<div class='search-summary'>${summary}</div>`;

    // Add answer if available
    if (searchResponse.answer && searchResponse.answerType !== "noAnswer") {
        html += `<div class='search-answer'>
            <div class='answer-header'>Answer:</div>
            <div class='answer-content'>${searchResponse.answer}</div>
        </div>`;
    }

    // Add main results as ordered list
    if (searchResponse.websites.length > 0) {
        html += `<div class='search-results-header'>Search Results:</div>`;
        html += `<ol class='search-results-list'>`;

        const topResults = searchResponse.websites.slice(0, 10);
        topResults.forEach((site: any, index: number) => {
            html += `<li class='search-result-item'>
                <div class='result-container'>
                    <div class='result-info'>
                        <div class='result-title'>${escapeHtml(site.title)}</div>
                        <div class='result-url'><a href='${escapeHtml(site.url)}' target='_blank'>${escapeHtml(site.url)}</a></div>
                        <div class='result-meta'>
                            ${site.lastVisited ? ` • Visited: ${new Date(site.lastVisited).toLocaleDateString()}` : ""}
                        </div>
                    </div>
                </div>
            </li>`;
        });

        html += `</ol>`;
    }

    // Add related entities if available
    if (
        searchResponse.relatedEntities &&
        searchResponse.relatedEntities.length > 0
    ) {
        html += `<div class='related-section'>
            <div class='section-header'>Related Entities:</div>
            <div class='entity-tags'>`;
        const topEntities = searchResponse.relatedEntities.slice(0, 5);
        topEntities.forEach((entity: any) => {
            html += `<span class='entity-tag'>${escapeHtml(entity.name)}</span>`;
        });
        html += `</div></div>`;
    }

    // Add topics if available
    if (searchResponse.topTopics && searchResponse.topTopics.length > 0) {
        html += `<div class='topics-section'>
            <div class='section-header'>Top Topics:</div>
            <div class='topic-tags'>`;
        const topTopics = searchResponse.topTopics.slice(0, 5);
        topTopics.forEach((topic: string) => {
            html += `<span class='topic-tag'>${escapeHtml(topic)}</span>`;
        });
        html += `</div></div>`;
    }

    // Add follow-up suggestions if available
    if (
        searchResponse.suggestedFollowups &&
        searchResponse.suggestedFollowups.length > 0
    ) {
        html += `<div class='followups-section'>
            <div class='section-header'>Suggested follow-ups:</div>
            <ul class='followup-list'>`;
        searchResponse.suggestedFollowups.forEach((followup: string) => {
            html += `<li class='followup-item'>${escapeHtml(followup)}</li>`;
        });
        html += `</ul></div>`;
    }

    html += `</div>`;

    // Add CSS styles for better presentation
    html += `
    <style>
    .web-search-results {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        max-width: 800px;
        margin: 0;
        padding: 0;
    }
    .search-summary {
        background: #f5f5f5;
        padding: 12px 16px;
        border-radius: 8px;
        margin-bottom: 16px;
        font-weight: 500;
        color: #333;
    }
    .search-answer {
        background: #e3f2fd;
        border-left: 4px solid #2196f3;
        padding: 16px;
        margin-bottom: 20px;
        border-radius: 4px;
    }
    .answer-header {
        font-weight: 600;
        color: #1976d2;
        margin-bottom: 8px;
    }
    .answer-content {
        line-height: 1.5;
        color: #333;
    }
    .search-results-header {
        font-size: 18px;
        font-weight: 600;
        margin: 20px 0 12px 0;
        color: #333;
    }
    .search-results-list {
        list-style: none;
        padding: 0;
        margin: 0;
    }
    .search-result-item {
        margin-bottom: 20px;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        overflow: hidden;
        transition: box-shadow 0.2s;
    }
    .search-result-item:hover {
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .result-container {
        padding: 16px;
    }
    .result-title {
        font-size: 16px;
        font-weight: 600;
        color: #1976d2;
        margin-bottom: 6px;
        line-height: 1.3;
    }
    .result-url {
        margin-bottom: 8px;
    }
    .result-url a {
        color: #2e7d32;
        text-decoration: none;
        font-size: 14px;
    }
    .result-url a:hover {
        text-decoration: underline;
    }
    .result-meta {
        font-size: 12px;
        color: #666;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .result-domain {
        font-weight: 500;
    }
    .related-section, .topics-section, .followups-section {
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid #e0e0e0;
    }
    .section-header {
        font-weight: 600;
        margin-bottom: 12px;
        color: #333;
    }
    .entity-tags, .topic-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .entity-tag, .topic-tag {
        background: #f5f5f5;
        padding: 4px 8px;
        border-radius: 16px;
        font-size: 12px;
        color: #555;
        border: 1px solid #ddd;
    }
    .followup-list {
        list-style: none;
        padding: 0;
        margin: 0;
    }
    .followup-item {
        padding: 8px 0;
        color: #555;
        border-bottom: 1px solid #f0f0f0;
    }
    .followup-item:last-child {
        border-bottom: none;
    }
    </style>`;

    return html;
}

function generateWebSearchMarkdown(
    searchResponse: SearchWebMemoriesResponse,
    query: string,
): string {
    let content = `Found ${searchResponse.websites.length} result(s) in ${searchResponse.summary.searchTime}ms\n\n`;

    // Add answer if available
    if (searchResponse.answer && searchResponse.answerType !== "noAnswer") {
        content += `** Answer:**${searchResponse.answer}\n\n`;
    }

    // Add main results (limit to top 10)
    if (searchResponse.websites.length > 0) {
        content += `**Top Results:**\n\n`;
        const topResults = searchResponse.websites.slice(0, 10);

        topResults.forEach((site: any, index: number) => {
            content += `${index + 1}. ${site.title}\n`;
            content += `([link](${site.url}))\n`;

            if (site.lastVisited) {
                content += ` • Last visited: ${new Date(site.lastVisited).toLocaleDateString()}`;
            }
            content += `\n\n`;
        });
    }

    // Add related entities if available
    if (
        searchResponse.relatedEntities &&
        searchResponse.relatedEntities.length > 0
    ) {
        content += `**Related Entities:**\n\n`;
        const topEntities = searchResponse.relatedEntities.slice(0, 5);
        topEntities.forEach((entity: any) => {
            content += `- ${entity.name}\n`;
        });
        content += `\n`;
    }

    // Add topics if available
    if (searchResponse.topTopics && searchResponse.topTopics.length > 0) {
        content += `**Top Topics**\n\n`;
        const topTopics = searchResponse.topTopics.slice(0, 5);
        topTopics.forEach((topic: string) => {
            content += `- ${topic}\n`;
        });
        content += `\n`;
    }

    // Add follow-up suggestions if available
    if (
        searchResponse.suggestedFollowups &&
        searchResponse.suggestedFollowups.length > 0
    ) {
        content += `**Suggested Follow-ups:**\n\n`;
        searchResponse.suggestedFollowups.forEach((followup: string) => {
            content += `- ${followup}\n`;
        });
    }

    return content;
}

function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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
    switch (action.schemaName) {
        case "browser":
            switch (action.actionName) {
                case "openWebPage":
                    return openWebPage(context, action);
                case "closeWebPage":
                    return closeWebPage(context);
                case "getWebsiteStats":
                    return getWebsiteStats(context, action);
                case "searchWebMemories":
                    return searchWebMemoriesAction(context, action);
                case "goForward":
                    await getActionBrowserControl(context).goForward();
                    return;
                case "goBack":
                    await getActionBrowserControl(context).goBack();
                    return;
                case "reloadPage":
                    // REVIEW: do we need to clear page schema?
                    await getActionBrowserControl(context).reload();
                    return;
                case "scrollUp":
                    await getActionBrowserControl(context).scrollUp();
                    return;
                case "scrollDown":
                    await getActionBrowserControl(context).scrollDown();
                    return;
                case "zoomIn":
                    await getActionBrowserControl(context).zoomIn();
                    return;
                case "zoomOut":
                    await getActionBrowserControl(context).zoomOut();
                    return;
                case "zoomReset":
                    await getActionBrowserControl(context).zoomReset();
                    return;
                case "search":
                    await getActionBrowserControl(context).search(
                        action.parameters.query,
                    );
                    return createActionResultFromTextDisplay(
                        `Opened new tab with query ${action.parameters.query}`,
                    );
                case "readPage":
                    await getActionBrowserControl(context).readPage();
                    return;
                case "stopReadPage":
                    await getActionBrowserControl(context).stopReadPage();
                    return;
                case "captureScreenshot":
                    const dataUrl =
                        await getActionBrowserControl(
                            context,
                        ).captureScreenshot();
                    return createActionResultFromHtmlDisplay(
                        `<img src="${dataUrl}" alt="Screenshot" width="100%" />`,
                    );
                case "followLinkByText": {
                    const control = getActionBrowserControl(context);
                    const { keywords, openInNewTab } = action.parameters;
                    const url = await control.followLinkByText(
                        keywords,
                        openInNewTab,
                    );
                    if (!url) {
                        throw new Error(`No link found for '${keywords}'`);
                    }

                    return createActionResultFromMarkdownDisplay(
                        `Navigated to link for [${keywords}](${url})`,
                        `Navigated to link for '${keywords}'`,
                    );
                }
                case "followLinkByPosition":
                    const control = getActionBrowserControl(context);
                    const url = await control.followLinkByPosition(
                        action.parameters.position,
                        action.parameters.openInNewTab,
                    );
                    if (!url) {
                        throw new Error(
                            `No link found at position ${action.parameters.position}`,
                        );
                    }
                    return createActionResultFromMarkdownDisplay(
                        `Navigated to [link](${url}) at position ${action.parameters.position}`,
                        `Navigated to link at position ${action.parameters.position}`,
                    );
                case "openSearchResult":
                    return openSearchResult(context, action);
                default:
                    // Should never happen.
                    throw new Error(
                        `Internal error: unknown browser action: ${(action as any).actionName}`,
                    );
            }
        case "browser.external":
            switch (action.actionName) {
                case "closeWindow": {
                    const control = getActionBrowserControl(context);
                    await control.closeWindow();
                    return;
                }
            }
            break;
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

/**
 * Progress update helper function
 */
function sendProgressUpdateViaWebSocket(
    webSocket: WebSocket | undefined,
    importId: string,
    progress: any,
) {
    try {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            // Send progress update message via WebSocket
            const progressMessage = {
                method: "importProgress",
                params: {
                    importId: importId,
                    progress: progress,
                },
                source: "browserAgent",
            };

            webSocket.send(JSON.stringify(progressMessage));
            debug(
                `Progress Update [${importId}] sent via WebSocket:`,
                progress,
            );
        } else {
            debug(
                `Progress Update [${importId}] (WebSocket not available):`,
                progress,
            );
        }
    } catch (error) {
        console.error("Failed to send progress update via WebSocket:", error);
    }
}

/**
 * Setup IPC communication with view service for action retrieval
 */
function setupViewServiceIPC(
    viewServiceProcess: ChildProcess,
    context: SessionContext<BrowserActionContext>,
): void {
    viewServiceProcess.on("message", async (message: any) => {
        try {
            if (message.type === "getAction") {
                await handleGetActionRequest(
                    message,
                    viewServiceProcess,
                    context,
                );
            }
        } catch (error) {
            debug("Error handling IPC message:", error);
        }
    });

    viewServiceProcess.on("error", (error: Error) => {
        debug("View service process error:", error);
    });
}

/**
 * Handle action retrieval request from view service
 */
async function handleGetActionRequest(
    message: any,
    viewServiceProcess: ChildProcess,
    context: SessionContext<BrowserActionContext>,
): Promise<void> {
    const { actionId, requestId } = message;
    const startTime = Date.now();

    try {
        if (!actionId || !requestId) {
            throw new Error(
                "Missing required parameters: actionId or requestId",
            );
        }

        if (typeof actionId !== "string") {
            throw new Error("Invalid actionId format");
        }

        debug(`Handling macro request for ID: ${actionId}`);

        // Get the macros store from context
        const macrosStore = context.agentContext.macrosStore;
        if (!macrosStore) {
            throw new Error("MacroStore not available");
        }

        const macro = await macrosStore.getMacro(actionId);

        if (!macro) {
            viewServiceProcess.send({
                type: "getActionResponse",
                requestId,
                success: false,
                error: "Action not found",
                timestamp: Date.now(),
            });
            return;
        }

        viewServiceProcess.send({
            type: "getActionResponse",
            requestId,
            success: true,
            action: macro,
            timestamp: Date.now(),
        });

        const duration = Date.now() - startTime;
        debug(`Action request completed in ${duration}ms`);
    } catch (error) {
        debug("Error handling action request:", error);

        viewServiceProcess.send({
            type: "getActionResponse",
            requestId,
            success: false,
            error: (error as Error).message || "Unknown error",
            timestamp: Date.now(),
        });
    }
}

export async function createViewServiceHost(
    context: SessionContext<BrowserActionContext>,
) {
    let timeoutHandle: NodeJS.Timeout;
    const port = context.agentContext.localHostPort;
    const sessionDir = await getSessionFolderPath(context);

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(
            () => reject(new Error("Browser views service creation timed out")),
            10000,
        );
    });

    const viewServicePromise = new Promise<ChildProcess | undefined>(
        (resolve, reject) => {
            try {
                const expressService = fileURLToPath(
                    new URL(
                        path.join("..", "./views/server/server.mjs"),
                        import.meta.url,
                    ),
                );

                const folderPath = path.join(sessionDir!, "files");

                fs.mkdirSync(folderPath, { recursive: true });

                const childProcess = fork(expressService, [port.toString()], {
                    env: {
                        ...process.env,
                        TYPEAGENT_BROWSER_FILES: folderPath,
                    },
                });

                // Setup IPC message handling for action retrieval
                setupViewServiceIPC(childProcess, context);

                childProcess.on("message", function (message) {
                    if (message === "Success") {
                        resolve(childProcess);
                    } else if (message === "Failure") {
                        resolve(undefined);
                    }
                });

                childProcess.on("exit", (code) => {
                    console.log("Browser views server exited with code:", code);
                });
            } catch (e: any) {
                console.error(e);
                resolve(undefined);
            }
        },
    );

    return Promise.race([viewServicePromise, timeoutPromise]).then((result) => {
        clearTimeout(timeoutHandle);
        return result;
    });
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

async function handleWebsiteAction(
    actionName: string,
    parameters: any,
    context: SessionContext<BrowserActionContext>,
): Promise<any> {
    switch (actionName) {
        case "importWebsiteData":
            return await importWebsiteDataFromSession(parameters, context);

        case "importWebsiteDataWithProgress":
            // Create progress callback using JSON parsing instead of regex
            const progressCallback = (message: string) => {
                debug("Progress message received:", message);

                let current = 0,
                    total = 0,
                    item = "",
                    phase = "processing";

                // Check if message contains structured JSON progress data
                if (message.includes("PROGRESS_JSON:")) {
                    try {
                        const jsonStart =
                            message.indexOf("PROGRESS_JSON:") +
                            "PROGRESS_JSON:".length;
                        const jsonStr = message.substring(jsonStart);
                        const progressData = JSON.parse(jsonStr);

                        debug("Parsed JSON progress data:", progressData);

                        current = progressData.current || 0;
                        total = progressData.total || 0;
                        item = progressData.description || "";
                        phase = progressData.phase || "processing";
                    } catch (error) {
                        console.error(
                            "Failed to parse JSON progress data:",
                            error,
                        );
                        debug("Raw message:", message);

                        // Fallback to simple message handling
                        item = message;
                        total = parameters.totalItems || 0;

                        // Try to determine phase from message content
                        if (
                            message.toLowerCase().includes("complete") ||
                            message.toLowerCase().includes("finished")
                        ) {
                            phase = "complete";
                        } else if (
                            message.toLowerCase().includes("starting") ||
                            message.toLowerCase().includes("initializing")
                        ) {
                            phase = "initializing";
                        }
                    }
                } else {
                    // Fallback for non-JSON messages
                    debug("Non-JSON message, using as description");
                    item = message;
                    total = parameters.totalItems || 0;

                    // Try to determine phase from message content
                    if (
                        message.toLowerCase().includes("complete") ||
                        message.toLowerCase().includes("finished")
                    ) {
                        phase = "complete";
                    } else if (
                        message.toLowerCase().includes("starting") ||
                        message.toLowerCase().includes("initializing")
                    ) {
                        phase = "initializing";
                    }
                }

                const structuredProgress = {
                    phase: phase,
                    totalItems: total || parameters.totalItems || 0,
                    processedItems: current || 0,
                    currentItem: item,
                    importId: parameters.importId,
                    errors: [],
                };

                debug("Sending structured progress:", structuredProgress);

                // Send structured progress update via WebSocket
                sendProgressUpdateViaWebSocket(
                    context.agentContext.webSocket,
                    parameters.importId,
                    structuredProgress,
                );
            };

            return await importWebsiteDataFromSession(
                parameters,
                context,
                progressCallback,
            );

        case "importHtmlFolder":
            // Create progress callback similar to importWebsiteDataWithProgress
            const folderProgressCallback = (message: string) => {
                // Extract progress info from message if possible
                let current = 0,
                    total = 0,
                    item = "";
                let phase:
                    | "counting"
                    | "initializing"
                    | "fetching"
                    | "processing"
                    | "extracting"
                    | "complete"
                    | "error" = "processing";

                // Handle JSON progress format from logStructuredProgress
                if (message.includes("PROGRESS_JSON:")) {
                    try {
                        const jsonStart =
                            message.indexOf("PROGRESS_JSON:") +
                            "PROGRESS_JSON:".length;
                        const progressData = JSON.parse(
                            message.substring(jsonStart),
                        );

                        current = progressData.current ?? 0;
                        total = progressData.total ?? 0;
                        item = progressData.description ?? "";
                        phase = progressData.phase ?? "processing";

                        debug("Parsed JSON progress data:", progressData);
                        debug(
                            "Extracted values - current:",
                            current,
                            "total:",
                            total,
                            "item:",
                            item,
                        );
                    } catch (error) {
                        console.warn("Failed to parse JSON progress:", error);
                        // Fall back to regex parsing
                    }
                } else {
                    // Existing regex logic for other message formats
                    // Updated regex to match format: "X/Y files processed (Z%): description"
                    const progressMatch = message.match(
                        /(\d+)\/(\d+)\s+files\s+processed.*?:\s*(.+)/,
                    );

                    if (progressMatch) {
                        current = parseInt(progressMatch[1]);
                        total = parseInt(progressMatch[2]);
                        item = progressMatch[3];

                        // Determine phase based on progress
                        if (current === 0) {
                            phase = "initializing";
                        } else if (current === total) {
                            phase = "complete";
                        } else {
                            phase = "processing";
                        }
                    } else {
                        // Fallback: try to extract just the description for other message types
                        item = message;

                        // Determine phase from message content
                        if (
                            message.includes("complete") ||
                            message.includes("finished")
                        ) {
                            phase = "complete";
                        } else if (
                            message.includes("Found") ||
                            message.includes("Starting")
                        ) {
                            phase = "initializing";
                        } else if (message.startsWith("Processing:")) {
                            phase = "processing";
                            // For individual file processing, preserve any previously known total
                            total = parameters.totalItems || 0;
                        }
                    }
                }

                // Create progress data matching ImportProgress interface
                const progressData = {
                    phase,
                    totalItems: total,
                    processedItems: current,
                    currentItem: item,
                    importId: parameters.importId,
                    errors: [],
                };

                // Send structured progress update via WebSocket
                sendProgressUpdateViaWebSocket(
                    context.agentContext.webSocket,
                    parameters.importId,
                    progressData,
                );
            };

            return await importHtmlFolderFromSession(
                parameters,
                context,
                folderProgressCallback,
            );

        case "searchWebMemories":
            return await searchWebMemories(parameters, context);

        case "searchByEntities":
            return await searchByEntities(parameters, context);

        case "searchByTopics":
            return await searchByTopics(parameters, context);

        case "hybridSearch":
            return await hybridSearch(parameters, context);

        case "getWebsiteStats":
            // Convert to ActionContext format for existing function
            const statsAction = {
                schemaName: "browser" as const,
                actionName: "getWebsiteStats" as const,
                parameters: parameters,
            };
            const mockStatsActionContext: ActionContext<BrowserActionContext> =
                {
                    sessionContext: context,
                    actionIO: {
                        setDisplay: () => {},
                        appendDisplay: () => {},
                        clearDisplay: () => {},
                        setError: () => {},
                    } as any,
                    streamingContext: undefined,
                    activityContext: undefined,
                    queueToggleTransientAgent: async () => {},
                };
            const statsResult = await getWebsiteStats(
                mockStatsActionContext,
                statsAction,
            );
            return {
                success: !statsResult.error,
                result: statsResult.literalText || "Stats retrieved",
                error: statsResult.error,
            };

        default:
            throw new Error(`Unknown website action: ${actionName}`);
    }
}

async function handleMacroStoreAction(
    actionName: string,
    parameters: any,
    context: SessionContext<BrowserActionContext>,
): Promise<any> {
    const macrosStore = context.agentContext.macrosStore;

    if (!macrosStore) {
        return {
            success: false,
            error: "MacroStore not available",
        };
    }

    try {
        switch (actionName) {
            case "recordActionUsage": {
                const { actionId } = parameters;
                if (!actionId) {
                    return {
                        success: false,
                        error: "Missing actionId parameter",
                    };
                }

                await macrosStore.recordUsage(actionId);
                debug(`Recorded usage for macro: ${actionId}`);

                return {
                    success: true,
                    macroId: actionId,
                };
            }

            case "getActionStatistics": {
                const { url } = parameters;
                let macros: any[] = [];
                let totalMacros = 0;

                if (url) {
                    // Get macros for specific URL
                    macros = await macrosStore.getMacrosForUrl(url);
                    totalMacros = macros.length;
                } else {
                    // Get all macros
                    macros = await macrosStore.getAllMacros();
                    totalMacros = macros.length;
                }

                console.log(
                    `Retrieved statistics: ${totalMacros} total macros`,
                );

                return {
                    success: true,
                    totalMacros: totalMacros,
                    macros: macros.map((macro) => ({
                        id: macro.id,
                        name: macro.name,
                        author: macro.author,
                        category: macro.category,
                        usageCount: macro.metadata.usageCount,
                        lastUsed: macro.metadata.lastUsed,
                    })),
                };
            }

            default:
                return {
                    success: false,
                    error: `Unknown ActionsStore action: ${actionName}`,
                };
        }
    } catch (error) {
        console.error(
            `Failed to execute ActionsStore action ${actionName}:`,
            error,
        );
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
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
        crossword: getCrosswordCommandHandlerTable(),
        open: new OpenWebPageHandler(),
        close: new CloseWebPageHandler(),
        external: {
            description: "Toggle external browser control",
            defaultSubCommand: "on",
            commands: {
                on: {
                    description: "Enable external browser control",
                    run: async (
                        context: ActionContext<BrowserActionContext>,
                    ) => {
                        const agentContext =
                            context.sessionContext.agentContext;
                        if (agentContext.externalBrowserControl === undefined) {
                            throw new Error(
                                "External browser control is not available.",
                            );
                        }
                        agentContext.useExternalBrowserControl = true;
                        await context.queueToggleTransientAgent(
                            "browser.external",
                            true,
                        );
                        displaySuccess(
                            "Using external browser control.",
                            context,
                        );
                    },
                },
                off: {
                    description: "Disable external browser control",
                    run: async (
                        context: ActionContext<BrowserActionContext>,
                    ) => {
                        const agentContext =
                            context.sessionContext.agentContext;
                        if (agentContext.clientBrowserControl === undefined) {
                            throw new Error(
                                "Client browser control is not available.",
                            );
                        }
                        agentContext.useExternalBrowserControl = false;
                        await context.queueToggleTransientAgent(
                            "browser.external",
                            false,
                        );
                        displaySuccess("Use client browser control.", context);
                    },
                },
            },
        },
    },
};
