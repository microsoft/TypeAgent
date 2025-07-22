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
    createActionResultFromMarkdownDisplay,
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
} from "./searchWebMemories.mjs";

import {
    loadAllowDynamicAgentDomains,
    processWebAgentMessage,
    WebAgentChannels,
} from "./webTypeAgent.mjs";
import { isWebAgentMessage } from "../common/webAgentMessageTypes.mjs";
import { handleSchemaDiscoveryAction } from "./discovery/actionHandler.mjs";
import { BrowserActions, OpenWebPage } from "./actionsSchema.mjs";
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
                context,
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
                        case "searchWebMemories": {
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

        // Format the response for display
        const summary = `Found ${searchResponse.websites.length} result(s) in ${searchResponse.summary.searchTime}ms`;
        let displayText = `${summary}\n\n`;

        // Add answer if available
        if (searchResponse.answer && searchResponse.answerType !== "noAnswer") {
            displayText += `**Answer:** ${searchResponse.answer}\n\n`;
        }

        // Add top results
        const topResults = searchResponse.websites.slice(0, 5);
        if (topResults.length > 0) {
            displayText += "**Top Results:**\n";
            topResults.forEach((site: any, index: number) => {
                displayText += `${index + 1}. [${site.title}](${site.url})\n`;
                if (site.snippet) {
                    displayText += `   ${site.snippet}\n`;
                }
                displayText += "\n";
            });
        }

        // Add entities if available
        if (
            searchResponse.relatedEntities &&
            searchResponse.relatedEntities.length > 0
        ) {
            displayText += "\n**Related Entities:**\n";
            const topEntities = searchResponse.relatedEntities.slice(0, 3);
            topEntities.forEach((entity: any) => {
                displayText += `• ${entity.name}\n`;
            });
        }

        // Add topics if available
        if (searchResponse.topTopics && searchResponse.topTopics.length > 0) {
            displayText += "\n**Top Topics:**\n";
            const topTopics = searchResponse.topTopics.slice(0, 3);
            topTopics.forEach((topic: string) => {
                displayText += `• ${topic}\n`;
            });
        }

        // Add follow-up suggestions if available
        if (
            searchResponse.suggestedFollowups &&
            searchResponse.suggestedFollowups.length > 0
        ) {
            displayText += "\n**Suggested follow-ups:**\n";
            searchResponse.suggestedFollowups.forEach((followup: string) => {
                displayText += `• ${followup}\n`;
            });
        }

        return createActionResultFromMarkdownDisplay(displayText, summary);
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : "Unknown error occurred";
        context.actionIO.appendDisplay(`Search failed: ${errorMessage}`);
        return createActionResult(`Search failed: ${errorMessage}`);
    }
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
            }
            break;
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
