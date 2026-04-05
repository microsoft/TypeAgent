// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getActiveTab } from "./tabManager";
import { getRecordedActions, saveRecordedActions } from "./storage";
import {
    sendActionToAgent,
    ensureWebsocketConnected,
    getWebSocket,
} from "./websocket";
import { screenshotCoordinator } from "./screenshotCoordinator";
import {
    connectToDispatcher,
    isDispatcherConnected,
} from "./dispatcherConnection";
import {
    startRecording,
    stopRecording,
    captureHtmlFragments,
    takeScreenshot,
} from "./recording";
import {
    handleImportWebsiteDataWithProgress,
    handleImportHtmlFolder,
    handleClearWebsiteLibrary,
    handleCancelImport,
    handleGetFileImportProgress,
    handleCancelFileImport,
    handleDownloadContentWithBrowser,
    handleProcessHtmlContent,
    handleTestOffscreenDocument,
    handleSearchWebMemories,
    handleSearchByEntities,
    handleSearchByTopics,
    handleHybridSearch,
    handleGetHierarchicalTopics,
    handleGetTopicMetrics,
    handleGetSearchSuggestions,
    handleSaveSearchHistory,
    handleGetSearchHistory,
    handleGetSuggestedSearches,
    handleCheckIndexStatus,
    indexPageContent,
    shouldIndexPage,
} from "./messageHandlers";
import type { AllServiceWorkerInvokeFunctions } from "../../common/serviceTypes.mjs";

/**
 * Creates ALL service worker RPC invoke handlers, covering every operation
 * that the extension views can request. These replace the handleMessage switch.
 */
export function createAllHandlers(): AllServiceWorkerInvokeFunctions {
    async function forward(method: string, params: any): Promise<any> {
        return sendActionToAgent({
            actionName: method,
            parameters: params || {},
        });
    }

    return {
        // =============================================================
        // Local operations (handled directly in service worker)
        // =============================================================

        async checkWebSocketConnection() {
            const ws = getWebSocket();
            return {
                connected: ws !== undefined && ws.readyState === WebSocket.OPEN,
            };
        },

        async checkConnection() {
            const ws = getWebSocket();
            return {
                connected: ws !== undefined && ws.readyState === WebSocket.OPEN,
            };
        },

        async initialize() {
            console.log("Browser Agent Service Worker started");
            try {
                const connected = await ensureWebsocketConnected();
                if (!connected) {
                    console.log("WebSocket connection failed on initialize");
                }
            } catch (error) {
                console.error("Error during initialization:", error);
            }
            return "initialized";
        },

        async takeScreenshot() {
            return screenshotCoordinator.captureScreenshot();
        },

        async saveRecordedActions(params: any) {
            await saveRecordedActions(
                params.recordedActions,
                params.recordedActionPageHTML,
                params.recordedActionScreenshot,
                params.actionIndex,
                params.isCurrentlyRecording,
            );
            return {};
        },

        async recordingStopped(params: any) {
            await saveRecordedActions(
                params.recordedActions,
                params.recordedActionPageHTML,
                params.recordedActionScreenshot,
                params.actionIndex,
                false,
            );
            return {};
        },

        async getRecordedActions() {
            return getRecordedActions();
        },

        async downloadData(params: any) {
            const jsonString = JSON.stringify(params.data, null, 2);
            const dataUrl =
                "data:application/json;charset=utf-8," +
                encodeURIComponent(jsonString);
            chrome.downloads.download({
                url: dataUrl,
                filename: params.filename || "schema-metadata.json",
                saveAs: true,
            });
            return {};
        },

        async settingsUpdated(params: any) {
            console.log("Settings updated:", params.settings);
            await chrome.storage.local.set({
                knowledgeSettings: params.settings,
            });
            return { success: true };
        },

        async autoIndexSettingChanged(params: any) {
            console.log("Auto-indexing setting changed:", params.enabled);
            return { success: true };
        },

        // =============================================================
        // Search history (local storage)
        // =============================================================

        async saveSearchHistory(params: any) {
            return handleSaveSearchHistory(params);
        },

        async getSearchHistory() {
            return handleGetSearchHistory();
        },

        async getSearchSuggestions(params: any) {
            return handleGetSearchSuggestions(params);
        },

        async getSuggestedSearches() {
            return handleGetSuggestedSearches();
        },

        // =============================================================
        // Index status & content download
        // =============================================================

        async checkIndexStatus() {
            return handleCheckIndexStatus();
        },

        async downloadContentWithBrowser(params: any) {
            return handleDownloadContentWithBrowser(params);
        },

        async processHtmlContent(params: any) {
            return handleProcessHtmlContent(params);
        },

        async testOffscreenDocument(params: any) {
            return handleTestOffscreenDocument(params);
        },

        async enableSiteAgent(params: any) {
            try {
                await sendActionToAgent({
                    actionName: "enableSiteTranslator",
                    parameters: { translator: params.agentName },
                });
                return { success: true };
            } catch (error: any) {
                return {
                    success: false,
                    error: error?.message || "Failed to enable site agent",
                };
            }
        },

        // =============================================================
        // Chat panel / dispatcher
        // =============================================================

        async chatPanelConnect() {
            try {
                await connectToDispatcher();
                await ensureWebsocketConnected();
                return { connected: true };
            } catch (error: any) {
                console.error(
                    "Failed to connect to Agent Server:",
                    error?.message || error,
                );
                return { connected: false, error: error?.message };
            }
        },

        async chatPanelConnectionStatus() {
            return { connected: isDispatcherConnected() };
        },

        async chatPanelProcessCommand(params: any) {
            try {
                const dispatcher = await connectToDispatcher();
                const result = await dispatcher.processCommand(
                    params.command,
                    params.clientRequestId,
                    params.attachments,
                );
                return { success: true, result };
            } catch (error: any) {
                console.error(
                    "Failed to process command:",
                    error?.message || error,
                );
                return { error: error?.message || "Command failed" };
            }
        },

        async chatPanelGetCompletions(params: any) {
            try {
                const dispatcher = await connectToDispatcher();
                const result = await dispatcher.getCommandCompletion(
                    params.input,
                    "forward",
                );
                if (result.completions.length === 0) return null;
                const completions: string[] = [];
                for (const group of result.completions) {
                    for (const c of group.completions) {
                        completions.push(c);
                    }
                }
                const startIndex = result.startIndex;
                const prefix = params.input.substring(0, startIndex);
                const separator =
                    result.separatorMode === "space" ||
                    result.separatorMode === "spacePunctuation"
                        ? " "
                        : "";
                return {
                    completions,
                    startIndex,
                    prefix: prefix + separator,
                };
            } catch {
                return null;
            }
        },

        async chatPanelGetHistory() {
            try {
                const dispatcher = await connectToDispatcher();
                const entries = await dispatcher.getDisplayHistory();
                return entries ?? [];
            } catch {
                return [];
            }
        },

        async chatPanelGetDynamicDisplay(params: any) {
            try {
                const dispatcher = await connectToDispatcher();
                return await dispatcher.getDynamicDisplay(
                    params.source,
                    "html",
                    params.displayId,
                );
            } catch (error: any) {
                return {
                    content: error?.message ?? "Refresh failed",
                    nextRefreshMs: -1,
                };
            }
        },

        async chatPanelQueryKnowledge(params: any) {
            try {
                return await forward("searchWebMemories", {
                    query: params.query,
                    searchScope: "current_page",
                    metadata: { url: params.url },
                });
            } catch (error: any) {
                return { error: error?.message || "Query failed" };
            }
        },

        async chatPanelGenerateQuestions(params: any) {
            try {
                return await forward("generatePageQuestions", {
                    url: params.url,
                    pageKnowledge: params.knowledge,
                });
            } catch (error: any) {
                return {
                    error: error?.message || "Failed to generate questions",
                };
            }
        },

        async chatPanelStartRecording() {
            try {
                await startRecording();
                return { success: true };
            } catch (error: any) {
                return { success: false, error: error?.message };
            }
        },

        async chatPanelStopRecording() {
            try {
                const recorded = await stopRecording();
                const steps = recorded?.recordedActions || [];
                // Capture page context for later WebFlow creation
                const html = await captureHtmlFragments();
                const screenshot = await takeScreenshot();
                // Store for later use by chatPanelCreateWebFlowFromRecording
                (globalThis as any).__lastRecording = {
                    steps,
                    html,
                    screenshot,
                    url:
                        (await (await import("./tabManager")).getActiveTab())
                            ?.url || "",
                };
                return { success: true, stepCount: steps.length };
            } catch (error: any) {
                return { success: false, stepCount: 0, error: error?.message };
            }
        },

        async chatPanelCreateWebFlowFromRecording(params: any) {
            try {
                const recording = (globalThis as any).__lastRecording;
                if (!recording) {
                    return { success: false, error: "No recording available" };
                }
                if (!recording.steps || recording.steps.length === 0) {
                    (globalThis as any).__lastRecording = undefined;
                    return {
                        success: false,
                        error: "Cannot save an action with 0 recorded steps",
                    };
                }
                // Format parameters to match the agent's
                // CreateWebFlowFromRecording schema
                const htmlFragments = Array.isArray(recording.html)
                    ? recording.html.map((f: any) =>
                          typeof f === "string"
                              ? { content: f, frameId: 0 }
                              : f,
                      )
                    : [];
                const result = await forward("createWebFlowFromRecording", {
                    actionName: params.actionName,
                    actionDescription: params.actionDescription,
                    recordedSteps: JSON.stringify(recording.steps),
                    startUrl: recording.url,
                    fragments: htmlFragments,
                    screenshots: recording.screenshot
                        ? [recording.screenshot]
                        : [],
                });
                (globalThis as any).__lastRecording = undefined;
                // The agent returns { displayText, data: { webFlowName } }
                const savedName =
                    result?.data?.webFlowName ||
                    result?.webFlowName ||
                    result?.flowName ||
                    result?.displayText?.match(/Created action:\s*(.+)/)?.[1] ||
                    params.actionName;
                return {
                    success: true,
                    flowName: savedName,
                };
            } catch (error: any) {
                return { success: false, error: error?.message };
            }
        },

        // =============================================================
        // Complex local handlers (HTML capture + agent forward)
        // =============================================================

        async indexPageContentDirect(params: any) {
            const targetTab = await getActiveTab();
            if (targetTab) {
                const success = await indexPageContent(
                    targetTab,
                    params.showNotification !== false,
                    {
                        mode: params.mode,
                        extractedKnowledge: params.extractedKnowledge,
                    },
                );
                return { success };
            }
            return {
                success: false,
                error: "No browser tabs are currently open. Please open a browser tab to continue.",
            };
        },

        async autoIndexPage(params: any) {
            const targetTab = await getActiveTab();
            if (targetTab && (await shouldIndexPage(targetTab.url!))) {
                const success = await indexPageContent(targetTab, false, {
                    quality: params.quality,
                    textOnly: params.textOnly,
                });
                return { success };
            }
            return {
                success: false,
                error: "Page not eligible for indexing",
            };
        },

        async autoDiscoverActions(params: any) {
            try {
                const result = await forward("autoDiscoverActions", {
                    url: params.url,
                    domain: params.domain,
                    mode: params.mode || "scope",
                });
                return {
                    success: true,
                    flowCount: result?.flowCount ?? 0,
                };
            } catch (error) {
                return {
                    success: false,
                    error:
                        error instanceof Error ? error.message : String(error),
                };
            }
        },

        async indexExtractedKnowledge(params: any) {
            try {
                const result = await forward("indexWebPageContent", {
                    url: params.url,
                    title: params.title,
                    extractKnowledge: false,
                    timestamp: params.timestamp || new Date().toISOString(),
                    mode: params.mode || "content",
                    extractedKnowledge: params.extractedKnowledge,
                });
                return {
                    success: result.indexed,
                    entityCount: result.entityCount,
                    error: result.indexed ? null : "Failed to index knowledge",
                };
            } catch (error) {
                console.error("Error indexing extracted knowledge:", error);
                return {
                    success: false,
                    entityCount: 0,
                    error: "Failed to index extracted knowledge",
                };
            }
        },

        // =============================================================
        // Simple agent forwards
        // =============================================================

        async getLibraryStats(params: any) {
            return forward("getLibraryStats", params || {});
        },

        async getWebsiteLibraryStats() {
            return forward("getLibraryStats", {});
        },

        async getAllWebFlows() {
            return forward("getAllWebFlows", {});
        },

        async deleteWebFlow(params: any) {
            try {
                const result = await forward("deleteWebFlow", {
                    name: params.name,
                });
                return result;
            } catch (error) {
                console.error("Failed to delete webFlow:", error);
                return {
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                };
            }
        },

        async getViewHostUrl() {
            return forward("getViewHostUrl", {});
        },

        async queryKnowledge(params: any) {
            try {
                return await forward("searchWebMemories", {
                    query: params.parameters?.query || params.query,
                    searchScope:
                        params.parameters?.searchScope || "current_page",
                    metadata: { url: params.parameters?.url || params.url },
                });
            } catch (error) {
                console.error("Error querying knowledge:", error);
                return { error: "Failed to query knowledge" };
            }
        },

        async discoverRelationships(params: any) {
            try {
                const result = await forward("discoverRelationships", {
                    url: params.url,
                    knowledge: params.knowledge,
                    maxResults: params.maxResults || 10,
                });
                return {
                    success: result.success || false,
                    relationships: result.relationships || [],
                    totalFound: result.totalFound || 0,
                };
            } catch (error) {
                console.error("Error discovering relationships:", error);
                return {
                    success: false,
                    relationships: [],
                    totalFound: 0,
                    error: "Failed to discover relationships",
                };
            }
        },

        async analyzeKnowledgeGaps(params: any) {
            try {
                const result = await forward("analyzeKnowledgeGaps", {
                    url: params.url,
                    knowledge: params.knowledge,
                    relatedContent: params.relatedContent || [],
                });
                return {
                    success: result.success || false,
                    gaps: result.gaps || [],
                    totalGaps: result.totalGaps || 0,
                };
            } catch (error) {
                console.error("Error analyzing knowledge gaps:", error);
                return {
                    success: false,
                    gaps: [],
                    totalGaps: 0,
                    error: "Failed to analyze knowledge gaps",
                };
            }
        },

        async getPageIndexStatus(params: any) {
            try {
                return await forward("checkPageIndexStatus", {
                    url: params.url,
                });
            } catch (error) {
                console.error("Error checking page index status:", error);
                return { isIndexed: false, error: "Failed to check status" };
            }
        },

        async getPageIndexedKnowledge(params: any) {
            try {
                const result = await forward("getPageIndexedKnowledge", {
                    url: params.url,
                });
                return {
                    isIndexed: result.isIndexed || false,
                    knowledge: result.knowledge || null,
                    error: result.error || null,
                };
            } catch (error) {
                console.error("Error getting page indexed knowledge:", error);
                return {
                    isIndexed: false,
                    knowledge: null,
                    error: "Failed to retrieve indexed knowledge",
                };
            }
        },

        async getIndexStats() {
            try {
                const result = await forward("getKnowledgeIndexStats", {});
                return {
                    totalPages: result.totalPages || 0,
                    totalEntities: result.totalEntities || 0,
                    totalRelationships: result.totalRelationships || 0,
                    lastIndexed: result.lastIndexed || "Never",
                    indexSize: result.indexSize || "0 MB",
                };
            } catch (error) {
                console.error("Error getting index stats:", error);
                return {
                    totalPages: 0,
                    totalEntities: 0,
                    totalRelationships: 0,
                    lastIndexed: "Error",
                    indexSize: "Unknown",
                };
            }
        },

        async getPageQualityMetrics(params: any) {
            try {
                const result = await forward("getKnowledgeIndexStats", {
                    url: params.url,
                });
                const pageStats = result.pageStats || {};
                return {
                    success: !result.error,
                    quality: {
                        score: pageStats.qualityScore || 0.5,
                        entityCount: pageStats.entityCount || 0,
                        topicCount: pageStats.topicCount || 0,
                        actionCount: pageStats.actionCount || 0,
                        extractionMode: pageStats.extractionMode || "unknown",
                        lastUpdated: pageStats.lastUpdated || null,
                    },
                };
            } catch (error) {
                console.error("Error getting page quality metrics:", error);
                return {
                    success: false,
                    quality: {
                        score: 0,
                        entityCount: 0,
                        topicCount: 0,
                        actionCount: 0,
                        extractionMode: "unknown",
                        lastUpdated: null,
                    },
                    error:
                        error instanceof Error ? error.message : String(error),
                };
            }
        },

        async getAnalyticsData(params: any) {
            try {
                const result = await forward("getAnalyticsData", {
                    timeRange: params.timeRange || "30d",
                    includeQuality: params.includeQuality !== false,
                    includeProgress: params.includeProgress !== false,
                    topDomainsLimit: params.topDomainsLimit || 10,
                    activityGranularity: params.activityGranularity || "day",
                });
                return {
                    success: !result.error,
                    analytics: result,
                    error: result.error,
                };
            } catch (error) {
                console.error("Error getting analytics data:", error);
                return {
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                };
            }
        },

        async getKnowledgeGraphStatus() {
            try {
                const result = await forward("getKnowledgeGraphStatus", {});
                return {
                    hasGraph: result.hasGraph || false,
                    entityCount: result.entityCount || 0,
                    relationshipCount: result.relationshipCount || 0,
                    communityCount: result.communityCount || 0,
                    isBuilding: result.isBuilding || false,
                    error: result.error || null,
                };
            } catch (error) {
                console.error("Error getting knowledge graph status:", error);
                return {
                    hasGraph: false,
                    entityCount: 0,
                    relationshipCount: 0,
                    communityCount: 0,
                    isBuilding: false,
                    error: "Failed to get graph status",
                };
            }
        },

        async buildKnowledgeGraph(params: any) {
            try {
                const result = await forward(
                    "buildKnowledgeGraph",
                    params.parameters || params || {},
                );
                return {
                    success: result.success || false,
                    message: result.message || "Graph building started",
                };
            } catch (error) {
                console.error("Error building knowledge graph:", error);
                return {
                    success: false,
                    error: "Failed to build knowledge graph",
                };
            }
        },

        async rebuildKnowledgeGraph() {
            try {
                const result = await forward("rebuildKnowledgeGraph", {});
                return {
                    success: result.success || false,
                    message: result.message || "Graph rebuilding started",
                };
            } catch (error) {
                console.error("Error rebuilding knowledge graph:", error);
                return {
                    success: false,
                    error: "Failed to rebuild knowledge graph",
                };
            }
        },

        async testMergeTopicHierarchies() {
            try {
                return await forward("testMergeTopicHierarchies", {});
            } catch (error) {
                console.error("Error testing topic merge:", error);
                return {
                    success: false,
                    mergeCount: 0,
                    error: "Failed to test topic merge",
                };
            }
        },

        async mergeTopicHierarchies() {
            try {
                return await forward("mergeTopicHierarchies", {});
            } catch (error) {
                console.error("Error merging topic hierarchies:", error);
                return {
                    success: false,
                    mergeCount: 0,
                    error: "Failed to merge topic hierarchies",
                };
            }
        },

        async getGlobalGraphLayoutData(params: any) {
            try {
                return await forward(
                    "getGlobalGraphLayoutData",
                    params.parameters || params || {},
                );
            } catch (error) {
                console.error("Error getting global graph layout data:", error);
                return {
                    graphologyLayout: {
                        elements: [],
                        layoutDuration: 0,
                        avgSpacing: 0,
                        communityCount: 0,
                    },
                    metadata: {
                        totalEntitiesInSystem: 0,
                        selectedEntityCount: 0,
                        coveragePercentage: 0,
                        importanceThreshold: 0,
                        layer: "global_graph_layout",
                    },
                };
            }
        },

        async getEntityNeighborhood(params: any) {
            try {
                return await forward("getEntityNeighborhood", {
                    entityId: params.entityId,
                    depth: params.depth,
                    maxNodes: params.maxNodes,
                });
            } catch (error) {
                console.error("Error getting entity neighborhood:", error);
                return [];
            }
        },

        async getEntityNeighborhoodLayoutData(params: any) {
            try {
                return await forward("getEntityNeighborhoodLayoutData", {
                    entityId: params.entityId,
                    depth: params.depth,
                    maxNodes: params.maxNodes,
                });
            } catch (error) {
                console.error(
                    "Error getting entity neighborhood layout:",
                    error,
                );
                return {
                    graphologyLayout: {
                        elements: [],
                        layoutDuration: 0,
                        avgSpacing: 0,
                        communityCount: 0,
                    },
                    metadata: {
                        entityId: params.entityId,
                        queryDepth: params.depth || 2,
                        maxNodes: params.maxNodes || 100,
                        actualNodes: 0,
                        actualEdges: 0,
                        layer: "entity_neighborhood",
                        source: "graphology",
                    },
                };
            }
        },

        async getGlobalImportanceLayer(params: any) {
            try {
                return await forward("getGlobalImportanceLayer", {
                    maxNodes: params.maxNodes,
                    includeConnectivity: params.includeConnectivity,
                });
            } catch (error) {
                console.error("Error getting global importance layer:", error);
                return {
                    entities: [],
                    relationships: [],
                    metadata: {
                        error:
                            error instanceof Error
                                ? error.message
                                : "Unknown error",
                    },
                };
            }
        },

        async getImportanceStatistics() {
            try {
                return await forward("getImportanceStatistics", {});
            } catch (error) {
                console.error("Error getting importance statistics:", error);
                return {
                    distribution: [],
                    recommendedLevel: 1,
                    levelPreview: [],
                };
            }
        },

        async getViewportBasedNeighborhood(params: any) {
            try {
                return await forward("getViewportBasedNeighborhood", {
                    centerEntity: params.centerEntity,
                    viewportNodeNames: params.viewportNodeNames,
                    maxNodes: params.maxNodes,
                    importanceWeighting: params.importanceWeighting,
                    includeGlobalContext: params.includeGlobalContext,
                    exploreFromAllViewportNodes:
                        params.exploreFromAllViewportNodes,
                    minDepthFromViewport: params.minDepthFromViewport,
                });
            } catch (error) {
                console.error(
                    "Error getting viewport-based neighborhood:",
                    error,
                );
                return {
                    entities: [],
                    relationships: [],
                    metadata: {
                        error:
                            error instanceof Error
                                ? error.message
                                : "Unknown error",
                    },
                };
            }
        },

        async getTopicImportanceLayer(params: any) {
            try {
                return await forward("getTopicImportanceLayer", {
                    maxNodes: params.maxNodes,
                    minImportanceThreshold: params.minImportanceThreshold,
                });
            } catch (error) {
                console.error("Error getting topic importance layer:", error);
                return {
                    topics: [],
                    relationships: [],
                    metadata: {
                        error:
                            error instanceof Error
                                ? error.message
                                : "Unknown error",
                    },
                };
            }
        },

        async getTopicViewportNeighborhood(params: any) {
            try {
                return await forward("getTopicViewportNeighborhood", {
                    centerTopic: params.centerTopic,
                    viewportTopicIds: params.viewportTopicIds,
                    maxNodes: params.maxNodes,
                    maxDepth: params.maxDepth,
                });
            } catch (error) {
                console.error(
                    "Error getting topic viewport neighborhood:",
                    error,
                );
                return {
                    topics: [],
                    relationships: [],
                    metadata: {
                        error:
                            error instanceof Error
                                ? error.message
                                : "Unknown error",
                    },
                };
            }
        },

        async getTopicMetrics(params: any) {
            return handleGetTopicMetrics(params);
        },

        async getTopicDetails(params: any) {
            try {
                return await forward("getTopicDetails", {
                    topicId: params.parameters?.topicId || params.topicId,
                });
            } catch (error) {
                console.error("Error fetching topic details:", error);
                return {
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to fetch topic details",
                };
            }
        },

        async getEntityDetails(params: any) {
            try {
                return await forward("getEntityDetails", {
                    entityName:
                        params.parameters?.entityName || params.entityName,
                });
            } catch (error) {
                console.error("Error getting entity details:", error);
                return {
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to fetch entity details",
                };
            }
        },

        async getTopicTimelines(params: any) {
            try {
                return await forward("getTopicTimelines", {
                    topicNames:
                        params.parameters?.topicNames || params.topicNames,
                    maxTimelineEntries:
                        params.parameters?.maxTimelineEntries ||
                        params.maxTimelineEntries,
                    timeRange: params.parameters?.timeRange || params.timeRange,
                    includeRelatedTopics:
                        params.parameters?.includeRelatedTopics ??
                        params.includeRelatedTopics,
                    neighborhoodDepth:
                        params.parameters?.neighborhoodDepth ||
                        params.neighborhoodDepth,
                });
            } catch (error) {
                console.error("Error getting topic timelines:", error);
                return {
                    success: false,
                    timelines: [],
                    metadata: {
                        totalEntries: 0,
                        timeRange: { earliest: "", latest: "" },
                        topicsWithActivity: 0,
                    },
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                };
            }
        },

        async getHierarchicalTopics(params: any) {
            return handleGetHierarchicalTopics(params);
        },

        // =============================================================
        // Delegations to existing helpers (search, import, etc.)
        // =============================================================

        async searchWebMemories(params: any) {
            return handleSearchWebMemories(params);
        },

        async searchByEntities(params: any) {
            return handleSearchByEntities(params);
        },

        async searchByTopics(params: any) {
            return handleSearchByTopics(params);
        },

        async hybridSearch(params: any) {
            return handleHybridSearch(params);
        },

        async importWebsiteDataWithProgress(params: any) {
            return handleImportWebsiteDataWithProgress(params);
        },

        async clearWebsiteLibrary() {
            return handleClearWebsiteLibrary();
        },

        async cancelImport(params: any) {
            return handleCancelImport(params.importId);
        },

        async importHtmlFolder(params: any) {
            return handleImportHtmlFolder(params);
        },

        async getFileImportProgress(params: any) {
            return handleGetFileImportProgress(params.importId);
        },

        async cancelFileImport(params: any) {
            return handleCancelFileImport(params.importId);
        },

        // =============================================================
        // Aliases used by ExtensionServiceBase views
        // =============================================================

        async saveSearch(params: any) {
            return handleSaveSearchHistory(params);
        },

        async getRecentSearches() {
            return handleGetSearchHistory();
        },

        async openOptionsPage() {
            try {
                chrome.runtime.openOptionsPage();
            } catch (error) {
                console.error("Failed to open options page:", error);
            }
        },

        async createTab(params: any) {
            try {
                return await chrome.tabs.create({
                    url: params.url,
                    active: params.active ?? true,
                });
            } catch (error) {
                console.error("Failed to create tab:", error);
                throw error;
            }
        },

        async extractKnowledge(params: any) {
            return forward("extractKnowledgeFromPage", {
                url: params.url,
            });
        },

        async checkKnowledgeStatus(params: any) {
            return forward("checkPageIndexStatus", {
                url: params.url,
            });
        },

        async getAutoIndexSetting() {
            try {
                const settings = await chrome.storage.sync.get([
                    "autoIndexing",
                ]);
                return { enabled: settings.autoIndexing || false };
            } catch (error) {
                console.error("Failed to get auto-index setting:", error);
                return { enabled: false };
            }
        },

        async setAutoIndexSetting(params: any) {
            try {
                await chrome.storage.sync.set({
                    autoIndexing: params.enabled,
                });
            } catch (error) {
                console.error("Failed to set auto-index setting:", error);
                throw error;
            }
        },

        async getExtractionSettings() {
            try {
                const settings = await chrome.storage.sync.get([
                    "extractionSettings",
                ]);
                return settings.extractionSettings || null;
            } catch (error) {
                console.error("Failed to get extraction settings:", error);
                return null;
            }
        },

        async saveExtractionSettings(params: any) {
            try {
                await chrome.storage.sync.set({
                    extractionMode: params.settings?.mode || params.mode,
                    suggestQuestions:
                        params.settings?.suggestQuestions ??
                        params.suggestQuestions,
                });
            } catch (error) {
                console.error("Failed to save extraction settings:", error);
                throw error;
            }
        },

        async notifyAutoIndexSettingChanged(params: any) {
            console.log("Auto-indexing setting changed:", params.enabled);
            return { success: true };
        },

        async generateTemporalSuggestions(params: any) {
            return forward("generateTemporalSuggestions", {
                maxSuggestions: params.maxSuggestions,
            });
        },

        async searchWebMemoriesAdvanced(params: any) {
            return handleSearchWebMemories({
                parameters: params.parameters || params,
            });
        },

        async getPageSourceInfo(params: any) {
            return forward("getKnowledgeIndexStats", {
                url: params.url,
            });
        },
    };
}
