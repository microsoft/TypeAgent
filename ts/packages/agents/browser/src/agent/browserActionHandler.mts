// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionIO,
    ActionResult,
    AppAgent,
    AppAgentEvent,
    AppAgentInitSettings,
    DisplayType,
    DynamicDisplay,
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
import { BrowserClient } from "./agentWebSocketServer.mjs";
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
import { handleKnowledgeAction } from "./knowledge/actions/knowledgeActionRouter.mjs";
import { ExtractKnowledgeHandler } from "./knowledge/extractKnowledgeCommand.mjs";
import {
    performKnowledgeExtraction,
    performKnowledgeExtractionWithNotifications,
    shouldRunKnowledgeExtraction,
    checkKnowledgeInIndex,
    saveKnowledgeToIndex,
    getActiveKnowledgeExtraction,
} from "./knowledge/actions/extractionActions.mjs";
import { initializeWebSocketBridge } from "./knowledge/progress/knowledgeWebSocketBridge.mjs";
import { handleKnowledgeExtractionProgress } from "./knowledge/progress/extractionProgressManager.mjs";
import {
    generateDetailedKnowledgeCards,
    generateDynamicKnowledgeHtml,
} from "./knowledge/ui/knowledgeCardRenderer.mjs";
import { actionContextCache } from "./knowledge/cache/actionContextCache.mjs";
import {
    normalizeUrlForIndex,
    runningExtractionsCache,
    shouldReExtract,
} from "./knowledge/cache/extractionCache.mjs";
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
    DisabledBrowserActions,
} from "./browserActionSchema.mjs";
import {
    resolveURLWithHistory,
    importWebsiteDataFromSession,
    importHtmlFolderFromSession,
    getWebsiteStats,
} from "./websiteMemory.mjs";
import { initializeImportWebSocketHandler } from "./import/importWebSocketHandler.mjs";
import { CrosswordActions } from "./crossword/schema/userActions.mjs";
import { InstacartActions } from "./instacart/schema/userActions.mjs";
import { ShoppingActions } from "./commerce/schema/userActions.mjs";
import { SchemaDiscoveryActions } from "./discovery/schema/discoveryActions.mjs";
import { ExternalBrowserActions } from "./externalBrowserActionSchema.mjs";
import {
    generatePageQuestions,
    generateGraphQuestions,
} from "./knowledge/actions/pageQnAActions.mjs";
import {
    BrowserControl,
    defaultSearchProviders,
} from "../common/browserControl.mjs";
import { openai } from "aiclient";
import { urlResolver } from "azure-ai-foundry";
import { deleteCachedSchema } from "./crossword/cachedSchema.mjs";
import { getCrosswordCommandHandlerTable } from "./crossword/commandHandler.mjs";
import {
    SearchProviderCommandHandlerTable,
    SetCommandHandler,
} from "./searchProvider/searchProviderCommandHandlers.mjs";
import {
    BrowserActionContext,
    getActionBrowserControl,
    getSessionBrowserControl,
    saveSettings,
} from "./browserActions.mjs";
import {
    ChunkChatResponse,
    generateAnswer,
    summarize,
    SummarizeResponse,
} from "typeagent";
import {
    LookupAndAnswerActions,
    LookupAndAnswerInternet,
} from "./lookupAndAnswerSchema.mjs";
import { createExternalBrowserClient } from "./rpc/externalBrowserControlClient.mjs";

const debug = registerDebug("typeagent:browser:action");
const debugWebSocket = registerDebug("typeagent:browser:ws");

// Knowledge extraction progress tracking - types now imported from knowledgeCardRenderer.mjs

// Track retry counts for dynamic display requests
const dynamicDisplayRetryCounters = new Map<string, number>();
const MAX_RETRY_CYCLES = 2;

// Set up periodic cleanup for running extractions cache and retry counters
setInterval(
    () => {
        runningExtractionsCache.cleanup();

        // Clean up old retry counters - simple approach: clear all periodically
        // since retry counters should be short-lived (only during startup phase)
        if (dynamicDisplayRetryCounters.size > 100) {
            debug(
                `Cleaning up ${dynamicDisplayRetryCounters.size} retry counters`,
            );
            dynamicDisplayRetryCounters.clear();
        }
    },
    5 * 60 * 1000,
); // Clean up every 5 minutes

// getDynamicDisplay implementation for browser agent
async function getDynamicDisplayImpl(
    type: DisplayType,
    dynamicDisplayId: string,
    context: SessionContext<BrowserActionContext>,
): Promise<DynamicDisplay> {
    // Handle knowledge extraction dynamic displays
    if (dynamicDisplayId.startsWith("knowledge-extraction-")) {
        const extractionId = dynamicDisplayId.replace(
            "knowledge-extraction-",
            "",
        );
        const activeExtraction = getActiveKnowledgeExtraction(extractionId);

        if (!activeExtraction || !activeExtraction.progressState) {
            // Track retry attempts for this dynamic display ID
            const currentRetries =
                dynamicDisplayRetryCounters.get(dynamicDisplayId) || 0;
            dynamicDisplayRetryCounters.set(
                dynamicDisplayId,
                currentRetries + 1,
            );

            // Only show "not found" after MAX_RETRY_CYCLES attempts
            if (currentRetries >= MAX_RETRY_CYCLES) {
                // Clean up the retry counter since we're giving up
                dynamicDisplayRetryCounters.delete(dynamicDisplayId);

                return {
                    content: {
                        type: "html",
                        content: `<div style="color: #6c757d; font-style: italic;">Knowledge extraction not found or not started (${dynamicDisplayId})</div>`,
                    },
                    nextRefreshMs: -1,
                };
            } else {
                // Show waiting message and continue retrying
                return {
                    content: {
                        type: "html",
                        content: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 16px;">
                            <div style="display: flex; align-items: center; margin-bottom: 12px;">
                                <div style="width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px;"></div>
                                <span style="font-weight: 600; color: #495057;">Waiting for Knowledge Extraction</span>
                            </div>
                            <div style="font-size: 13px; color: #6c757d;">
                                Initializing extraction process... (${currentRetries + 1}/${MAX_RETRY_CYCLES + 1}) (${dynamicDisplayId})
                            </div>
                        </div>
                        <style>
                            @keyframes spin {
                                0% { transform: rotate(0deg); }
                                100% { transform: rotate(360deg); }
                            }
                        </style>
                        `,
                    },
                    nextRefreshMs: 1500, // Continue refreshing
                };
            }
        }

        // Clear retry counter once extraction is found
        dynamicDisplayRetryCounters.delete(dynamicDisplayId);

        const { progressState, aggregatedKnowledge } = activeExtraction;

        // Generate rich, dynamic HTML content
        const dynamicHtml = generateDynamicKnowledgeHtml(
            progressState,
            aggregatedKnowledge,
        );

        // Determine if we should continue refreshing
        const isComplete =
            progressState.phase === "complete" ||
            progressState.phase === "error";

        if (isComplete && activeExtraction.url) {
            await saveKnowledgeToIndex(
                activeExtraction.url,
                aggregatedKnowledge,
                context,
            );
        } else {
            debug(
                "Extraction completed but the URL was empty. results not saved",
            );
        }

        return {
            content: { type: "html", content: dynamicHtml },
            nextRefreshMs: isComplete ? -1 : 1500, // Stop refreshing when complete, otherwise refresh every 1.5 seconds
        };
    }

    throw new Error(`Unknown dynamic display ID: ${dynamicDisplayId}`);
}

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeBrowserContext,
        updateAgentContext: updateBrowserContext,
        executeAction: executeBrowserAction,
        resolveEntity,
        getDynamicDisplay: getDynamicDisplayImpl,
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
        preferredClientType:
            clientBrowserControl === undefined ? "extension" : "electron",
        index: undefined,
        localHostPort,
        macrosStore: undefined,
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

        if (!context.agentContext.agentWebSocketServer) {
            const { AgentWebSocketServer } = await import(
                "./agentWebSocketServer.mjs"
            );
            context.agentContext.agentWebSocketServer =
                new AgentWebSocketServer(8081);

            context.agentContext.agentWebSocketServer.getPreferredClientType =
                () => {
                    return context.agentContext.preferredClientType;
                };

            context.agentContext.agentWebSocketServer.onClientConnected = (
                client: BrowserClient,
            ) => {
                // Recreate externalBrowserControl when a new extension client connects
                if (client.type === "extension") {
                    debug(
                        `Extension client connected: ${client.id}, recreating externalBrowserControl`,
                    );

                    // Dispose old RPC instance to prevent handler chaining
                    if (context.agentContext.externalBrowserControl) {
                        context.agentContext.externalBrowserControl.dispose();
                    }

                    context.agentContext.externalBrowserControl =
                        createExternalBrowserClient(
                            context.agentContext.agentWebSocketServer!,
                        );
                }
            };

            context.agentContext.agentWebSocketServer.onClientDisconnected = (
                client: BrowserClient,
            ) => {
                // Log disconnection for debugging
                if (client.type === "extension") {
                    debug(`Extension client disconnected: ${client.id}`);
                }
            };

            context.agentContext.agentWebSocketServer.onClientMessage = async (
                client: BrowserClient,
                message: string,
            ) => {
                const data = JSON.parse(message);
                debugWebSocket(
                    `Received message from browser client ${client.id}: ${message}`,
                );

                if (isWebAgentMessage(data)) {
                    await processWebAgentMessage(data, context);
                    return;
                }

                if (data.error) {
                    console.error(data.error);
                    throw new Error(data.error);
                }

                if (data.method) {
                    const browserControls = context.agentContext
                        .useExternalBrowserControl
                        ? context.agentContext.externalBrowserControl?.control
                        : context.agentContext.clientBrowserControl;

                    if (
                        (context.agentContext.useExternalBrowserControl &&
                            client.type === "extension") ||
                        (!context.agentContext.useExternalBrowserControl &&
                            client.type === "electron")
                    ) {
                        if (browserControls) {
                            await processBrowserAgentMessage(
                                data,
                                browserControls,
                                context,
                                client,
                            );
                        }
                    } else {
                        debug(
                            `ignoring ${client.type} browser message when in ${context.agentContext.useExternalBrowserControl ? "external" : "internal"} browser control mode`,
                        );
                    }
                }
            };
        }

        // Initialize external browser control using the AgentWebSocketServer
        if (
            !context.agentContext.externalBrowserControl &&
            context.agentContext.agentWebSocketServer
        ) {
            context.agentContext.externalBrowserControl =
                createExternalBrowserClient(
                    context.agentContext.agentWebSocketServer,
                );
        }

        if (!context.agentContext.browserConnector) {
            const browserControls = context.agentContext
                .useExternalBrowserControl
                ? context.agentContext.externalBrowserControl?.control
                : context.agentContext.clientBrowserControl;

            if (browserControls && context.agentContext.agentWebSocketServer) {
                context.agentContext.browserConnector = new BrowserConnector(
                    context.agentContext.agentWebSocketServer,
                    browserControls,
                );
            }
        }

        initializeWebSocketBridge(context);
        initializeImportWebSocketHandler(context);
        debug("Browser agent WebSocket server initialized");

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
        if (context.agentContext.agentWebSocketServer) {
            context.agentContext.agentWebSocketServer.stop();
            delete context.agentContext.agentWebSocketServer;
        }

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
    client: BrowserClient,
) {
    switch (data.method) {
        case "knowledgeExtractionProgress": {
            await handleKnowledgeExtractionProgress(data.params, context);
            break;
        }
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
                    const acrossClues =
                        context.agentContext.crossWordState.across?.length || 0;
                    const downClues =
                        context.agentContext.crossWordState.down?.length || 0;
                    context.notify(
                        AppAgentEvent.Inline,
                        `Crossword page is ready for interaction with ${acrossClues} across and ${downClues} down clues.`,
                    );
                } else {
                    context.notify(
                        AppAgentEvent.Inline,
                        "Failed to extract crossword schema - crossword board initialization failed.",
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

            client.socket.send(
                JSON.stringify({
                    id: data.id,
                    result: discoveryResult.data,
                }),
            );
            break;
        }

        case "extractKnowledgeFromPage":
        case "extractKnowledgeFromPageStreaming":
        case "indexWebPageContent":
        case "checkPageIndexStatus":
        case "getPageIndexedKnowledge":
        case "getRecentKnowledgeItems":
        case "getAnalyticsData":
        case "getDiscoverInsights":
        case "getKnowledgeIndexStats":
        case "clearKnowledgeIndex":
        case "getKnowledgeGraphStatus":
        case "buildKnowledgeGraph":
        case "rebuildKnowledgeGraph":
        case "getAllRelationships":
        case "getAllCommunities":
        case "getAllEntitiesWithMetrics":
        case "getEntityNeighborhood":
        case "getGlobalImportanceLayer":
        case "getImportanceStatistics":
        case "getHierarchicalTopics":
        case "getTopicImportanceLayer":
        case "getTopicViewportNeighborhood":
        case "getTopicMetrics":
        case "getTopicTimelines":
        case "getViewportBasedNeighborhood":
        case "testMergeTopicHierarchies":
        case "mergeTopicHierarchies":
        case "discoverRelatedKnowledge":
        case "getTopicDetails":
        case "getEntityDetails":
        case "getUrlContentBreakdown": {
            const knowledgeResult = await handleKnowledgeAction(
                data.method,
                data.params,
                context,
            );

            client.socket.send(
                JSON.stringify({
                    id: data.id,
                    result: knowledgeResult,
                }),
            );
            break;
        }

        case "handlePageNavigation": {
            await handlePageNavigation(context, data.params);
            break;
        }

        case "generatePageQuestions": {
            const pageQuestionsResult = await generatePageQuestions(
                data.params,
                context,
            );
            client.socket.send(
                JSON.stringify({
                    id: data.id,
                    result: pageQuestionsResult,
                }),
            );
            break;
        }

        case "generateGraphQuestions": {
            const graphQuestionsResult = await generateGraphQuestions(
                data.params,
                context,
            );
            client.socket.send(
                JSON.stringify({
                    id: data.id,
                    result: graphQuestionsResult,
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

            client.socket.send(
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

            client.socket.send(
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

            client.socket.send(
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
            client.socket.send(
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

                    // Check if the index database file exists and try to read it
                    const dbFile = path.join(
                        indexPath,
                        "index_dataFrames.sqlite",
                    );
                    if (fs.existsSync(dbFile)) {
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
                                    `Database exists but collection is empty at ${indexPath}, will create new collection`,
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
                        debug(`No existing database file found at ${dbFile}`);
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

                // Set up index metadata if we have a valid path
                // Directory will be created when writeToFile is called
                if (indexPath) {
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
                        `Index will be created at ${indexPath} when first page is indexed`,
                    );
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
        entityGraph: "typeagent-browser://views/entityGraphView.html",
        knowledgelibrary: "typeagent-browser://views/knowledgeLibrary.html",
        macroslibrary: "typeagent-browser://views/macrosLibrary.html",
        topicGraph: "typeagent-browser://views/topicGraphView.html",
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
            const browserPort = await context.getSharedLocalHostPort("browser");
            if (browserPort !== undefined) {
                debug(`Resolved local site on PORT ${browserPort}`);

                return [`http://localhost:${browserPort}/plans`];
            }
        case "chatview":
            // handle browser views
            const shellPort = await context.getSharedLocalHostPort("shell");
            if (shellPort !== undefined) {
                debug(`Resolved local site on PORT ${shellPort}`);

                return [`http://localhost:${shellPort}/readOnlyChatView.html`];
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

function createKnowledgeActionResult(
    url: string,
    knowledge: any,
    context: ActionContext<BrowserActionContext>,
    dynamicDisplayId?: string,
    dynamicDisplayNextRefreshMs?: number,
): ActionResult {
    let message = "Web page opened successfully";

    if (knowledge) {
        const entitiesCount = knowledge.entities?.length || 0;
        const topicsCount = knowledge.keyTopics?.length || 0;
        const actionsCount = knowledge.actions?.length || 0;

        if (entitiesCount > 0 || topicsCount > 0 || actionsCount > 0) {
            message += ` with knowledge extraction (${entitiesCount} entities, ${topicsCount} topics, ${actionsCount} actions).`;
        } else {
            message +=
                " with knowledge extraction (no structured content found).";
        }
    } else {
        message += " (existing knowledge loaded from index).";
    }

    const result = createActionResult(message);

    result.activityContext = {
        activityName: "browsingWebPage",
        description: "Browsing a web page with knowledge",
        state: {
            site: url,
            hasKnowledge: true,
            knowledgeSource: knowledge ? "extracted" : "cached",
        },
        activityEndAction: {
            actionName: "closeAllWebPages",
        },
    };

    // Include dynamic display information if provided
    if (dynamicDisplayId) {
        result.dynamicDisplayId = dynamicDisplayId;
        result.dynamicDisplayNextRefreshMs =
            dynamicDisplayNextRefreshMs || 1500;
    }

    return result;
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

    // Check for existing knowledge and display it
    const existingKnowledge = await checkKnowledgeInIndex(url, context);
    if (existingKnowledge) {
        const entitiesCount = existingKnowledge.entities?.length || 0;
        const topicsCount = existingKnowledge.topics?.length || 0;
        const relationshipsCount = existingKnowledge.relationships?.length || 0;

        // Display existing knowledge with detailed cards
        const knowledgeHtml = generateDetailedKnowledgeCards(existingKnowledge);
        context.actionIO.appendDisplay(
            {
                type: "html",
                content: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; padding: 12px; background: #d1ecf1; border-left: 4px solid #17a2b8; border-radius: 4px;">
                    <div style="font-weight: 600; color: #0c5460;">📖 Existing Knowledge Found</div>
                    <div style="font-size: 13px; color: #0c5460; margin-top: 4px;">
                        Found ${entitiesCount} entities, ${topicsCount} topics, and ${relationshipsCount} relationships from previous extraction
                    </div>
                    ${knowledgeHtml}
                </div>
                `,
            },
            "block",
        );
        return createKnowledgeActionResult(url, existingKnowledge, context);
    }

    // Start knowledge extraction directly (dedupe cache will prevent duplicates from navigation handler)
    if (await shouldRunKnowledgeExtraction(url, context)) {
        const browserSettings = await browserControl.getBrowserSettings();
        try {
            const extractionInfo = await performKnowledgeExtraction(
                url,
                context,
                browserSettings.extractionMode,
            );
            // Return immediately with dynamic display information for real-time progress
            if (extractionInfo && extractionInfo.dynamicDisplayId) {
                return createKnowledgeActionResult(
                    url,
                    extractionInfo.knowledge,
                    context,
                    extractionInfo.dynamicDisplayId,
                    extractionInfo.dynamicDisplayNextRefreshMs,
                );
            }

            // Fallback in case extraction didn't return expected format
            return createKnowledgeActionResult(url, null, context);
        } catch (error) {
            console.error(
                "Knowledge extraction failed, falling back to basic navigation:",
                error,
            );
        }
    }

    // Fallback to basic result if autoIndex disabled or error occurred
    const result = createActionResult("Web page opened successfully.");

    result.activityContext = {
        activityName: "browsingWebPage",
        description: "Browsing a web page",
        state: {
            site: url,
        },
        activityEndAction: {
            actionName: "closeAllWebPages",
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

async function closeAllWebPages(context: ActionContext<BrowserActionContext>) {
    const browserControl = getActionBrowserControl(context);
    context.actionIO.setDisplay("Closing all web pages.");
    await browserControl.closeAllWebPages();
    const result = createActionResult("Web pages closed successfully.");
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
        | TypeAgentAction<BrowserActions | DisabledBrowserActions, "browser">
        | TypeAgentAction<BrowserActions, "browser">
        | TypeAgentAction<ExternalBrowserActions, "browser.external">
        | TypeAgentAction<CrosswordActions, "browser.crossword">
        | TypeAgentAction<ShoppingActions, "browser.commerce">
        | TypeAgentAction<InstacartActions, "browser.instacart">
        | TypeAgentAction<SchemaDiscoveryActions, "browser.actionDiscovery">
        | TypeAgentAction<LookupAndAnswerActions, "browser.lookupAndAnswer">,

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
                case "closeAllWebPages":
                    return closeAllWebPages(context);
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
                    const pageUrl: URL = await getActionBrowserControl(
                        context,
                    ).search(
                        action.parameters.query,
                        undefined,
                        context.sessionContext.agentContext
                            .activeSearchProvider,
                        {
                            newTab: action.parameters.newTab,
                        },
                    );

                    return summarizeSearchResults(
                        context,
                        action,
                        pageUrl,
                        await getActionBrowserControl(
                            context,
                        ).getPageTextContent(),
                    );
                case "readPageContent":
                    await getActionBrowserControl(context).readPageContent();
                    return;
                case "stopReadPageContent":
                    await getActionBrowserControl(
                        context,
                    ).stopReadPageContent();
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
    const connector = context.sessionContext.agentContext.browserConnector;
    if (connector) {
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
        }
    } else {
        console.error("No WebSocket server available.");
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
async function summarizeSearchResults(
    context: ActionContext<BrowserActionContext>,
    action: Search,
    pageUrl: URL,
    pageContents: string,
) {
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
        true,
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

            return createActionResultFromTextDisplay(
                summaryResponse.summary,
                summaryResponse.summary,
                summaryResponse.entities,
            );
        } else {
            return createActionResultFromTextDisplay(
                (answerResult.data as string[]).join("\n"),
            );
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
    const content = await getActionBrowserControl(context).getPageTextContent();

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
                    {
                        name: "WebPage",
                        type: ["WebPage"],
                        uniqueId: searchURL.toString(),
                    },
                    ...answer.entities,
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

async function handlePageNavigation(
    context: SessionContext<BrowserActionContext>,
    params: { url: string; title: string; tabId?: number },
): Promise<void> {
    const { url, title } = params;

    try {
        // Normalize URL for consistent checking (keep query params)
        const normalizedUrl = normalizeUrlForIndex(url);

        // Check if extraction is already running for this URL
        if (runningExtractionsCache.isRunning(url)) {
            const running = runningExtractionsCache.getRunning(url);
            debug(
                `Extraction already running for ${url} (ID: ${running?.extractionId}), skipping duplicate`,
            );

            // Optionally notify about ongoing extraction
            const cachedContext = actionContextCache.get(url);
            if (cachedContext) {
                displayStatus(
                    `Knowledge extraction in progress for ${url}`,
                    cachedContext,
                );
            } else {
                context.notify(
                    AppAgentEvent.Inline,
                    `Knowledge extraction in progress for ${url}`,
                );
            }
            return;
        }

        // Check if we already have recent knowledge for this URL
        if (!shouldReExtract(normalizedUrl)) {
            debug(`Skipping extraction for ${url} - recently extracted`);

            // Try to load and display existing knowledge from index
            const existingKnowledge = await checkKnowledgeInIndex(url, context);
            const cachedContext = actionContextCache.get(url);

            if (existingKnowledge) {
                const entitiesCount = existingKnowledge.entities?.length || 0;
                const topicsCount = existingKnowledge.topics?.length || 0;
                const relationshipsCount =
                    existingKnowledge.relationships?.length || 0;

                if (cachedContext) {
                    // Display existing knowledge details using action context
                    cachedContext.actionIO.appendDisplay(
                        {
                            type: "html",
                            content: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; padding: 12px; background: #d1ecf1; border-left: 4px solid #17a2b8; border-radius: 4px;">
                            <div style="font-weight: 600; color: #0c5460;">📖 Existing Knowledge Found</div>
                            <div style="font-size: 13px; color: #0c5460; margin-top: 4px;">
                                Loading ${entitiesCount} entities, ${topicsCount} topics, and ${relationshipsCount} relationships from index
                            </div>
                        </div>    
                        ${generateDetailedKnowledgeCards(existingKnowledge)}
                        `,
                        },
                        "block",
                    );
                }
            } else if (cachedContext) {
                displayStatus(
                    `Using cached knowledge for ${url}`,
                    cachedContext,
                );
            } else {
                context.notify(
                    AppAgentEvent.Inline,
                    `Using cached knowledge for ${url}`,
                );
            }
            return;
        }

        // Check if we should run extraction
        const cachedContext = actionContextCache.get(url);

        // Determine if extraction should run
        let shouldExtract = false;
        let extractionMode = "content";

        shouldExtract = await shouldRunKnowledgeExtraction(url, context);

        const browserControl = getSessionBrowserControl(context);
        const settings = await browserControl.getBrowserSettings();

        extractionMode = settings?.extractionMode || "content";

        if (!shouldExtract) {
            return;
        }

        // Send simple navigation notification
        context.notify(
            AppAgentEvent.Inline,
            `Navigated to "${title}". Analyzing the page ...`,
        );

        // Check for existing knowledge in index before starting new extraction
        const existingKnowledge = await checkKnowledgeInIndex(url, context);
        if (existingKnowledge) {
            const entitiesCount = existingKnowledge.entities?.length || 0;
            const topicsCount = existingKnowledge.topics?.length || 0;
            const relationshipsCount =
                existingKnowledge.relationships?.length || 0;

            if (cachedContext) {
                // Display existing knowledge first using ActionContext, then extraction will update it
                cachedContext.actionIO.appendDisplay(
                    {
                        type: "html",
                        content: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; padding: 12px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                        <div style="font-weight: 600; color: #856404;">🔄 Updating Existing Knowledge</div>
                        <div style="font-size: 13px; color: #856404; margin-top: 4px;">
                            Found ${entitiesCount} entities, ${topicsCount} topics, and ${relationshipsCount} relationships. Extracting updated knowledge...
                        </div>
                    </div>    
                    ${generateDetailedKnowledgeCards(existingKnowledge)}
                    `,
                    },
                    "block",
                );
            } else {
                // Use notification when no ActionContext available
                context.notify(
                    AppAgentEvent.Inline,
                    `Updating existing knowledge for ${url}: ${entitiesCount} entities, ${topicsCount} topics, ${relationshipsCount} relationships`,
                );
            }
        }

        // Get page contents
        const htmlFragments =
            await context.agentContext.browserConnector?.getHtmlFragments(
                false,
                "knowledgeExtraction",
            );

        if (!htmlFragments) {
            return;
        }

        // Create extraction parameters
        let extractionId = `navigation-${Date.now()}`;

        const cachedDynamicDisplayId =
            actionContextCache.getDynamicDisplayId(url);
        if (cachedDynamicDisplayId) {
            extractionId = cachedDynamicDisplayId.replace(
                "knowledge-extraction-",
                "",
            );
        }

        const parameters = {
            url,
            title,
            htmlFragments,
            extractionId,
            mode: extractionMode,
        };

        // Start extraction using the running extractions cache
        const extractionPromise = cachedContext
            ? performKnowledgeExtraction(url, cachedContext, extractionMode)
            : performKnowledgeExtractionWithNotifications(
                  url,
                  context,
                  extractionMode,
                  parameters,
              );

        await runningExtractionsCache.startExtraction(
            url,
            extractionId,
            extractionPromise,
        );
    } catch (error) {
        // Send error notification
        context.notify(
            AppAgentEvent.Error,
            `Failed to extract knowledge for ${title}: ${(error as any).message}`,
        );
    }
}

async function handleTabIndexActions(
    action: any,
    context: SessionContext<BrowserActionContext>,
    requestId: string | undefined,
) {
    const agentServer = context.agentContext.agentWebSocketServer;
    const tabTitleIndex = context.agentContext.tabTitleIndex;

    if (agentServer && tabTitleIndex) {
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

            const activeClient = agentServer.getActiveClient();
            if (activeClient) {
                activeClient.socket.send(
                    JSON.stringify({
                        id: requestId,
                        result: responseBody,
                    }),
                );
            }
        } catch (ex: any) {
            if (ex instanceof Error) {
                console.error(ex);
            } else {
                console.error(JSON.stringify(ex));
            }
        }
    } else {
        console.error("No WebSocket server available.");
    }
    return undefined;
}

/**
 * Progress update helper function
 */

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

async function createViewServiceHost(
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
                    debug("Browser views server exited with code:", code);
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
        // Display result message if available
        if ((result as any).displayContent) {
            context.actionIO.setDisplay((result as any).displayContent);
        }
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
        // Display result message if available
        if ((result as any).displayContent) {
            context.actionIO.setDisplay((result as any).displayContent);
        }

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
            const importId = parameters.importId || `website-${Date.now()}`;
            parameters.importId = importId;

            return await importWebsiteDataFromSession(parameters, context);

        case "importHtmlFolder":
            const folderId = parameters.importId || `folder-${Date.now()}`;
            parameters.importId = folderId;

            return await importHtmlFolderFromSession(parameters, context);

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

                debug(`Retrieved statistics: ${totalMacros} total macros`);

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
                        agentContext.preferredClientType = "extension";

                        // Re-select active client based on new preference
                        if (agentContext.agentWebSocketServer) {
                            agentContext.agentWebSocketServer.selectActiveClient(
                                "extension",
                            );
                        }

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
                        agentContext.preferredClientType = "electron";

                        // Re-select active client based on new preference
                        if (agentContext.agentWebSocketServer) {
                            agentContext.agentWebSocketServer.selectActiveClient(
                                "electron",
                            );
                        }

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
        extractKnowledge: new ExtractKnowledgeHandler(),
        search: new SearchProviderCommandHandlerTable(),
    },
};
