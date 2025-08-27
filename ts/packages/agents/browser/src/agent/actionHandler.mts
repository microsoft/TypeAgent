// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWebSocket } from "common-utils/ws";
import { WebSocket } from "ws";
import {
    ActionContext,
    ActionIO,
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
    createActionResultFromError,
    createActionResultFromHtmlDisplay,
    createActionResultFromMarkdownDisplay,
    createActionResultFromTextDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import {
    displayError,
    displayStatus,
    displaySuccess,
    getMessage,
} from "@typeagent/agent-sdk/helpers/display";
import {
    getBoardSchema,
    handleCrosswordAction,
} from "./crossword/actionHandler.mjs";

import { BrowserConnector } from "./browserConnector.mjs";
import { handleCommerceAction } from "./commerce/actionHandler.mjs";
import { createTabTitleIndex } from "./tabTitleIndex.mjs";
import { ChildProcess, fork } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs, { readFileSync } from "node:fs";

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
    generateWebSearchMarkdown,
} from "./searchWebMemories.mjs";

import {
    loadAllowDynamicAgentDomains,
    processWebAgentMessage,
} from "./webTypeAgent.mjs";
import { isWebAgentMessage } from "../common/webAgentMessageTypes.mjs";
import { handleSchemaDiscoveryAction } from "./discovery/actionHandler.mjs";
import {
    BrowserActions,
    OpenWebPage,
    OpenSearchResult,
    ChangeTabs,
    Search,
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
import {
    BrowserControl,
    defaultSearchProviders,
} from "../common/browserControl.mjs";
import { openai } from "aiclient";
import { urlResolver } from "azure-ai-foundry";
import { createExternalBrowserClient } from "./rpc/externalBrowserControlClient.mjs";
import { deleteCachedSchema } from "./crossword/cachedSchema.mjs";
import { getCrosswordCommandHandlerTable } from "./crossword/commandHandler.mjs";
import {
    SearchProviderCommandHandlerTable,
    SetCommandHandler,
} from "./searchProvider/searchProviderCommandHandlers.mjs";
import {
    BrowserActionContext,
    getActionBrowserControl,
    saveSettings,
} from "./browserActions.mjs";
import { ChunkChatResponse, generateAnswer, summarize, SummarizeResponse } from "typeagent";
import {
    BrowserLookupActions,
    LookupAndAnswerInternet,
} from "./lookupAndAnswerSchema.mjs";

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
        resolverSettings: {
            searchResolver: true,
            keywordResolver: true,
            wikipediaResolver: true,
            historyResolver: false,
        },
        searchProviders: defaultSearchProviders,
        activeSearchProvider: defaultSearchProviders[0],
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
            await initializeWebsiteIndex(context);
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
                    throw new Error(data.error);
                }

                if (data.method) {
                    await processBrowserAgentMessage(
                        data,
                        browserControls,
                        context,
                        webSocket,
                    );
                }
            });
        }

        // rehydrate cached settings
        const sessionDir: string | undefined =
            await getSessionFolderPath(context);
        const contents: string = await readFileSync(
            path.join(sessionDir!, "settings.json"),
            "utf-8",
        );

        if (contents.length > 0) {
            const config = JSON.parse(contents);

            // resolver settings
            context.agentContext.resolverSettings.searchResolver =
                config.resolverSettings.searchResolver;
            context.agentContext.resolverSettings.keywordResolver =
                config.resolverSettings.keywordResolver;
            context.agentContext.resolverSettings.wikipediaResolver =
                config.resolverSettings.wikipediaResolver;
            context.agentContext.resolverSettings.historyResolver =
                config.resolverSettings.historyResolver;

            // search provider settings
            context.agentContext.searchProviders =
                config.searchProviders || defaultSearchProviders;
            context.agentContext.activeSearchProvider =
                config.activeSearchProvider ||
                context.agentContext.searchProviders[0];
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

async function processBrowserAgentMessage(
    data: any,
    browserControls: BrowserControl,
    context: SessionContext<BrowserActionContext>,
    webSocket: WebSocket,
) {
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
            await context.toggleTransientAgent(targetTranslator, true);
            break;
        }
        case "disableSiteTranslator": {
            const targetTranslator = data.params.translator;
            await context.toggleTransientAgent(targetTranslator, false);
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
        case "getAllMacros":
        case "deleteMacro": {
            const discoveryResult = await handleSchemaDiscoveryAction(
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

        case "getLibraryStats": {
            const libraryStatsResult = await handleWebsiteLibraryStats(
                data.params,
                context,
            );

            webSocket.send(
                JSON.stringify({
                    id: data.id,
                    result: libraryStatsResult,
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

async function initializeWebsiteIndex(
    context: SessionContext<BrowserActionContext>,
) {
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
            let websiteCollection: website.WebsiteCollection | undefined;

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
                                    size: websiteCollection.messages.length,
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

                        debug(`Created index structure at ${indexPath}`);
                    } catch (createError) {
                        debug(`Error creating index directory: ${createError}`);
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
            const resolveStarted = Date.now();

            const urls = await resolveWebPage(context, name, undefined, true);
            const duration = Date.now() - resolveStarted;

            debug(`URL Resolution Duration: ${duration}`);

            if (urls.length === 1) {
                return {
                    match: "exact",
                    entities: [
                        {
                            name,
                            type: ["WebPage"],
                            uniqueId: urls[0],
                        },
                    ],
                };
            } else {
                return {
                    match: "fuzzy",
                    entities: urls.map((url) => ({
                        name: `${url}`,
                        type: ["WebPage"],
                        uniqueId: url,
                    })),
                };
            }
        } catch {}
    }
    return undefined;
}

async function resolveWebPage(
    context: SessionContext<BrowserActionContext>,
    site: string,
    io?: ActionIO,
    fastResolution?: boolean, // flag that indicates whether to use fast resolution only
): Promise<string[]> {
    debug(`Resolving site '${site}'`);

    // Handle library pages with custom protocol
    const libraryPages: Record<string, string> = {
        annotationslibrary: "typeagent-browser://views/annotationsLibrary.html",
        knowledgelibrary: "typeagent-browser://views/knowledgeLibrary.html",
        macroslibrary: "typeagent-browser://views/macrosLibrary.html",
    };

    const libraryUrl = libraryPages[site.toLowerCase()];
    if (libraryUrl) {
        debug(`Resolved library page: ${site} -> ${libraryUrl}`);
        return [libraryUrl];
    }

    switch (site.toLowerCase()) {
        case "paleobiodb":
            return ["https://paleobiodb.org/navigator/"];

        case "crossword":
            return ["https://aka.ms/typeagent/sample-crossword"];

        case "commerce":
            return ["https://www.target.com/"];

        case "turtlegraphics":
            return ["http://localhost:9000/"];
        case "planviewer":
            // handle browser views
            const port = await context.getSharedLocalHostPort("browser");
            if (port !== undefined) {
                debug(`Resolved local site on PORT ${port}`);

                return [`http://localhost:${port}/plans`];
            }
        default: {
            // if the site is a valid URL, return it directly
            if (URL.canParse(site)) {
                debug(`Site is a valid URL: ${site}`);
                return [site];
            }

            // local sites
            try {
                const port = await context.getSharedLocalHostPort(site);

                if (port !== undefined) {
                    debug(`Resolved local site on PORT ${port}`);

                    return [`http://localhost:${port}`];
                }
            } catch (e) {
                debug(`Unable to find local host port for '${site}. ${e}'`);
            }

            // try to resolve URL string using known keyword matching
            if (
                context.agentContext.resolverSettings.keywordResolver ||
                fastResolution
            ) {
                const cachehitUrls = urlResolver.resolveURLByKeyword(site);
                if (cachehitUrls && cachehitUrls.length > 0) {
                    debug(`Resolved URLs from cache: ${cachehitUrls}`);

                    return cachehitUrls;
                }

                // nothing else found, just return
                if (fastResolution) {
                    return [];
                }
            }

            // anything below here is considered "SLOW"

            // Search for the URL in browser history, and then fallback on web search
            // if we get singular matches we assume those are correct and we just return it.
            // if we get more than one result then we'll return all of them and let the user decide
            // which URL they want via clarification

            // try to resolve URL using browser history
            if (context.agentContext.resolverSettings.historyResolver) {
                const startTime = Date.now();
                io?.appendDisplay(
                    getMessage(
                        `Trying to resolve '${site}' by looking at browsing history.\n`,
                        "status",
                    ),
                    "temporary",
                );
                const historyUrls = await resolveURLWithHistory(context, site);

                if (historyUrls && historyUrls.length > 0) {
                    const msg = `Found ${historyUrls.length} in browser history.\n`;
                    debug(msg);
                    io?.appendDisplay(getMessage(msg, "status"), "temporary");

                    debug(
                        `History resolution duration: ${Date.now() - startTime}`,
                    );

                    return historyUrls;
                }
            }

            // default to search
            return [
                context.agentContext.activeSearchProvider.url.replace(
                    "%s",
                    encodeURIComponent(site),
                ),
            ];
        }
    }

    // can't get a URL
    throw new Error(`Unable to find a URL for: '${site}'`);
}

async function openWebPage(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<OpenWebPage>,
) {
    const browserControl = getActionBrowserControl(context);

    displayStatus(`Opening web page for ${action.parameters.site}.`, context);
    const url = (
        await resolveWebPage(
            context.sessionContext,
            action.parameters.site,
            context.actionIO,
        )
    )[0];

    if (url !== action.parameters.site) {
        displayStatus(
            `Opening web page for ${action.parameters.site} at ${url}.`,
            context,
        );
    }
    await browserControl.openWebPage(url, {
        newTab: action.parameters.tab === "new",
    });
    const result = createActionResult("Web page opened successfully.");

    result.activityContext = {
        activityName: "browsingWebPage",
        description: "Browsing a web page",
        state: {
            site: url,
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

async function changeTabs(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<ChangeTabs>,
) {
    const browserControl = getActionBrowserControl(context);

    displayStatus(
        `Activating tab: ${action.parameters.tabDescription}.`,
        context,
    );
    let result: ActionResult | undefined = undefined;
    if (
        await browserControl.switchTabs(
            action.parameters.tabDescription,
            action.parameters.tabIndex,
        )
    ) {
        result = createActionResult("Switched tabs successfully.");
    } else {
        result = createActionResultFromError(
            `Unable to find a tab corresponding to '${action.parameters.tabDescription}'`,
        );
    }

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

    await browserControl.openWebPage(targetUrl, {
        newTab: openInNewTab ? openInNewTab : false,
    });

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

async function changeSearchProvider(
    context: ActionContext<BrowserActionContext>,
    action: TypeAgentAction<any>,
) {
    if (
        context.sessionContext.agentContext.searchProviders.filter(
            (sp) =>
                sp.name.toLowerCase() === action.parameters.name.toLowerCase(),
        ).length > 0
    ) {
        const cmd = new SetCommandHandler();

        const params: ParsedCommandParams<any> = {
            args: { provider: `${action.parameters.name}` },
            flags: {},
            tokens: [],
            lastCompletableParam: undefined,
            lastParamImplicitQuotes: false,
            nextArgs: [],
        };

        await cmd.run(context, params);
        return createActionResult(
            `Search provider changed to ${action.parameters.name}`,
        );
    } else {
        return createActionResult(
            `No search provider by the name '${action.parameters.name}' found.  Search provider is still '${context.sessionContext.agentContext.activeSearchProvider.name}'`,
        );
    }
}

async function executeBrowserAction(
    action:
        | TypeAgentAction<BrowserActions, "browser">
        | TypeAgentAction<ExternalBrowserActions, "browser.external">
        | TypeAgentAction<CrosswordActions, "browser.crossword">
        | TypeAgentAction<ShoppingActions, "browser.commerce">
        | TypeAgentAction<InstacartActions, "browser.instacart">
        | TypeAgentAction<SchemaDiscoveryActions, "browser.actionDiscovery">
        | TypeAgentAction<BrowserLookupActions, "browser.lookupAndAnswer">,

    context: ActionContext<BrowserActionContext>,
) {
    // try {
    switch (action.schemaName) {
        case "browser":
            switch (action.actionName) {
                case "openWebPage":
                    return openWebPage(context, action);
                case "closeWebPage":
                    return closeWebPage(context);
                case "changeTab":
                    return changeTabs(context, action);
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
                    const pageUrl: URL = await getActionBrowserControl(context).search(
                        action.parameters.query,
                        undefined,
                        context.sessionContext.agentContext
                            .activeSearchProvider,
                        {
                            newTab: action.parameters.newTab,
                        },
                    );

                    return summarizeSearchResults(context, 
                        action, 
                        pageUrl,
                        await getActionBrowserControl(context).getPageContents()
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
                case "changeSearchProvider":
                    return changeSearchProvider(context, action);
                case "searchImageAction": {
                    return openWebPage(context, {
                        schemaName: "browser",
                        actionName: "openWebPage",
                        parameters: {
                            site: `https://www.bing.com/images/search?q=${action.parameters.searchTerm}`,
                            tab: "new",
                        },
                    });
                }
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
        case "browser.lookupAndAnswer":
            switch (action.actionName) {
                case "lookupAndAnswerInternet":
                    return await lookup(context, action);
                default: {
                    throw new Error(
                        `Unknown action for lookupAndAnswer: ${(action as any).actionName}`,
                    );
                }
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

/**
 * Summarizes the search results and does entity extraction on it.
 * @param context - The current context
 * @param action - The search action
 * @param pageUrl - The URL of the search page 
 * @param pageContents - The contents of the search page
 * @returns - The action result 
 */
async function summarizeSearchResults(context: ActionContext<BrowserActionContext>, 
    action: Search, 
    pageUrl: URL,
    pageContents: string) {

    displayStatus(
        `Reading and summarizing search results, please stand by...`,
        context,
    );                    
    
    const model = openai.createJsonChatModel("GPT_35_TURBO", [
        "SearchPageSummary",
    ]);
    const answerResult = await summarize(
        model,
        pageContents,
        4096 * 8,
        (text: string) => {
            //displayStatus(text, context);
        },
        true
    );

    if (answerResult.success) {
        const summaryResponse = answerResult.data as SummarizeResponse;
        if (summaryResponse) {

            // add the search results page as an entity
            if (!summaryResponse.entities) {
                summaryResponse.entities = [];
            }

            summaryResponse.entities.push({
                name: pageUrl.toString(),
                type: ["WebPage"],
            });

            return createActionResultFromTextDisplay(summaryResponse.summary, summaryResponse.summary, summaryResponse.entities)
        } else {
            return createActionResultFromTextDisplay((answerResult.data as string[]).join("\n"));
        }
    }

    return createActionResultFromTextDisplay(
        `Opened new tab with query ${action.parameters.query}`,
    );
}

async function lookup(
    context: ActionContext<BrowserActionContext>,
    action: LookupAndAnswerInternet,
) {
    // run a search for the lookup, wait for the page to load
    displayStatus(
        `Searching the web for '${action.parameters.internetLookups.join(" ")}'`,
        context,
    );

    const searchURL: URL = await getActionBrowserControl(context).search(
        action.parameters.internetLookups.join(" "),
        action.parameters.sites,
        context.sessionContext.agentContext.activeSearchProvider,
        { waitForPageLoad: true },
    );

    // go get the page contents
    const content = await getActionBrowserControl(context).getPageContents();

    // now try to generate an answer from the page contents
    displayStatus(
        `Generating the answer for '${action.parameters.originalRequest}'`,
        context,
    );
    const model = openai.createJsonChatModel("GPT_35_TURBO", [
        "InternetLookupAnswerGenerator",
    ]); // TODO: GPT_5_MINI/NANO?
    const answerResult = await generateAnswer(
        action.parameters.originalRequest,
        content,
        4096 * 4,
        model,
        1,
        (text: string, result: ChunkChatResponse) => {
            displayStatus(result.generatedText!, context);
        },
    );

    if (answerResult.success) {
        const answer: ChunkChatResponse =
            answerResult.data as ChunkChatResponse;
        if (
            answer.answerStatus === "Answered" ||
            answer.answerStatus === "PartiallyAnswered"
        ) {
            return createActionResult(
                `${answer.generatedText}`,
                { speak: true },
                [
                    // the web page
                    {
                        name: "WebPage",
                        type: ["WebPage"],
                        uniqueId: searchURL.toString(),
                    },
                ],
            );
        } else {
            return createActionResultFromTextDisplay(
                `No answer found for '${action.parameters.originalRequest}'.  Try navigating to a search result or trying another query.`,
            );
        }
    } else {
        return createActionResultFromError(
            `There was an error generating the answer: ${answerResult.message} `,
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
                tab: "current",
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
                result: statsResult.historyText || "Stats retrieved",
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

function formatLibraryStatsResponse(text: string) {
    const defaultStats = {
        totalWebsites: 0,
        totalBookmarks: 0,
        totalHistory: 0,
        topDomains: 0,
    };

    if (!text) return defaultStats;

    try {
        const lines = text.split("\n");
        let totalWebsites = 0;
        let totalBookmarks = 0;
        let totalHistory = 0;
        let topDomains = 0;

        // Look for total count line
        const totalMatch = text.match(/Total:\s*(\d+)\s*sites/i);
        if (totalMatch) {
            totalWebsites = parseInt(totalMatch[1]);
        }

        // Look for source breakdown
        const bookmarkMatch = text.match(/bookmark:\s*(\d+)/i);
        if (bookmarkMatch) {
            totalBookmarks = parseInt(bookmarkMatch[1]);
        }

        const historyMatch = text.match(/history:\s*(\d+)/i);
        if (historyMatch) {
            totalHistory = parseInt(historyMatch[1]);
        }

        // Count domain entries
        const domainLines = lines.filter(
            (line) =>
                line.includes(":") &&
                line.includes("sites") &&
                !line.includes("Total") &&
                !line.includes("Source"),
        );
        topDomains = domainLines.length;

        return {
            totalWebsites,
            totalBookmarks,
            totalHistory,
            topDomains,
        };
    } catch (error) {
        console.error("Error parsing library stats:", error);
        return defaultStats;
    }
}

async function handleWebsiteLibraryStats(
    parameters: any,
    context: SessionContext<BrowserActionContext>,
): Promise<any> {
    try {
        // Call existing getWebsiteStats action with proper ActionContext
        const statsAction = {
            schemaName: "browser" as const,
            actionName: "getWebsiteStats" as const,
            parameters: {
                groupBy: "source",
                limit: 50,
                ...parameters, // Allow override of defaults
            },
        };

        const mockActionContext: ActionContext<BrowserActionContext> = {
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
            mockActionContext,
            statsAction,
        );

        if (statsResult.error) {
            return {
                success: false,
                error: statsResult.error,
                totalWebsites: 0,
                totalBookmarks: 0,
                totalHistory: 0,
                topDomains: 0,
            };
        }

        // Parse and format the response - extract text from ActionResult
        let responseText = "";
        if (statsResult.historyText) {
            responseText = statsResult.historyText;
        } else if (statsResult.displayContent) {
            // Handle different types of display content
            if (typeof statsResult.displayContent === "string") {
                responseText = statsResult.displayContent;
            } else if (Array.isArray(statsResult.displayContent)) {
                responseText = statsResult.displayContent.join("\n");
            } else if (
                typeof statsResult.displayContent === "object" &&
                statsResult.displayContent.content
            ) {
                // Handle DisplayMessage type
                responseText =
                    typeof statsResult.displayContent.content === "string"
                        ? statsResult.displayContent.content
                        : String(statsResult.displayContent.content);
            }
        }

        const formattedStats = formatLibraryStatsResponse(responseText);

        return {
            success: true,
            ...formattedStats,
        };
    } catch (error) {
        console.error("Error getting library stats:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            totalWebsites: 0,
            totalBookmarks: 0,
            totalHistory: 0,
            topDomains: 0,
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
        resolver: {
            description: "Toggle URL resolver methods",
            defaultSubCommand: "list",
            commands: {
                list: {
                    description: "List all available URL resolvers",
                    run: async (
                        context: ActionContext<BrowserActionContext>,
                    ) => {
                        const agentContext =
                            context.sessionContext.agentContext;
                        const resolvers = Object.entries(
                            agentContext.resolverSettings,
                        )
                            .filter(([, enabled]) => enabled !== undefined)
                            .map(([name, enabled]) => ({
                                name,
                                enabled,
                            }));
                        displaySuccess(
                            `Available resolvers: ${JSON.stringify(resolvers)}`,
                            context,
                        );
                    },
                },
                keyword: {
                    description: "Toggle keyword resolver",
                    run: async (
                        context: ActionContext<BrowserActionContext>,
                    ) => {
                        const agentContext =
                            context.sessionContext.agentContext;
                        agentContext.resolverSettings.keywordResolver =
                            !agentContext.resolverSettings.keywordResolver;
                        displaySuccess(
                            `Keyword resolver is now ${
                                agentContext.resolverSettings.keywordResolver
                                    ? "enabled"
                                    : "disabled"
                            }`,
                            context,
                        );
                        saveSettings(context.sessionContext);
                    },
                },
                history: {
                    description: "Toggle history resolver",
                    run: async (
                        context: ActionContext<BrowserActionContext>,
                    ) => {
                        const agentContext =
                            context.sessionContext.agentContext;
                        agentContext.resolverSettings.historyResolver =
                            !agentContext.resolverSettings.historyResolver;
                        displaySuccess(
                            `History resolver is now ${
                                agentContext.resolverSettings.historyResolver
                                    ? "enabled"
                                    : "disabled"
                            }`,
                            context,
                        );
                        saveSettings(context.sessionContext);
                    },
                },
            },
        },
        search: new SearchProviderCommandHandlerTable(),
    },
};
