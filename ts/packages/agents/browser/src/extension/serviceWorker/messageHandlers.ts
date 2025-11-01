// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getActiveTab } from "./tabManager";
import { getTabHTMLFragments, CompressionMode } from "./capture";
import { getRecordedActions, saveRecordedActions } from "./storage";
import {
    sendActionToAgent,
    ensureWebsocketConnected,
    getWebSocket,
} from "./websocket";
import { BrowserContentDownloader } from "./contentDownloader.js";
import type { KnowledgeExtractionProgress } from "../interfaces/knowledgeExtraction.types";

// Store active extraction callbacks
const knowledgeExtractionCallbacks = new Map<
    string,
    (progress: KnowledgeExtractionProgress) => void
>();

/**
 * Handle knowledge extraction progress updates from WebSocket
 */
export function handleKnowledgeExtractionProgress(
    extractionId: string,
    progress: KnowledgeExtractionProgress,
) {
    const callback = knowledgeExtractionCallbacks.get(extractionId);
    if (typeof callback === "function") {
        callback(progress);

        // Cleanup on completion
        if (progress.phase === "complete" || progress.phase === "error") {
            knowledgeExtractionCallbacks.delete(extractionId);
        }
    }
}

/**
 * Handles messages from content scripts
 * @param message The message received
 * @param sender The sender of the message
 * @returns Promise resolving to the result of handling the message
 */
export async function handleMessage(
    message: any,
    sender: chrome.runtime.MessageSender,
): Promise<any> {
    switch (message.type) {
        case "checkWebSocketConnection": {
            try {
                const websocket = getWebSocket();
                return {
                    connected:
                        websocket && websocket.readyState === WebSocket.OPEN,
                };
            } catch (error) {
                return { connected: false };
            }
        }

        case "getLibraryStats": {
            return await sendActionToAgent({
                actionName: "getLibraryStats",
                parameters: message.parameters || {},
            });
        }

        case "getSearchSuggestions": {
            return await handleGetSearchSuggestions(message);
        }

        case "getRecentSearches": {
            return await handleGetSearchHistory();
        }

        case "saveSearch": {
            return await handleSaveSearchHistory({
                query: message.query,
                results: message.results,
            });
        }

        case "initialize": {
            console.log("Browser Agent Service Worker started");
            try {
                const connected = await ensureWebsocketConnected();
                if (!connected) {
                    console.log("WebSocket connection failed on initialize");
                }
            } catch (error) {
                console.error("Error during initialization:", error);
            }

            return "Service worker initialize called";
        }
        case "refreshSchema": {
            // Discovery now auto-saves actions
            const discoveryResult = await sendActionToAgent({
                actionName: "detectPageActions",
                parameters: {
                    registerAgent: false,
                },
            });

            return {
                schema: discoveryResult.schema,
                actionDefinitions: discoveryResult.typeDefinitions,
            };
        }
        case "registerTempSchema": {
            // First try to get actions from ActionsStore for enhanced schema registration
            try {
                const currentTab = await getActiveTab();
                if (currentTab?.url) {
                    const actionsResult = await sendActionToAgent({
                        actionName: "getMacrosForUrl",
                        parameters: {
                            url: currentTab.url,
                            includeGlobal: true,
                        },
                    });

                    if (
                        actionsResult.actions &&
                        actionsResult.actions.length > 0
                    ) {
                        console.log(
                            `Found ${actionsResult.actions.length} actions for schema registration from ActionsStore`,
                        );

                        console.log(
                            "Actions for schema registration:",
                            actionsResult.actions,
                        );
                    }
                }
            } catch (error) {
                console.warn(
                    "Failed to get actions from ActionsStore for schema registration:",
                    error,
                );
            }

            // Register the dynamic agent schema
            const schemaResult = await sendActionToAgent({
                actionName: "registerPageDynamicAgent",
                parameters: {
                    agentName: message.agentName,
                },
            });
            return { schema: schemaResult };
        }
        case "getIntentFromRecording": {
            // Authoring now auto-saves actions
            const schemaResult = await sendActionToAgent({
                actionName: "getIntentFromRecording",
                parameters: {
                    recordedActionName: message.actionName,
                    recordedActionDescription: message.actionDescription,
                    recordedActionSteps: message.steps,
                    existingActionNames: message.existingActionNames,
                    fragments: message.html,
                    screenshots: message.screenshot,
                },
            });

            // Notify sidepanel that a macro was added
            if (schemaResult.actionId) {
                chrome.runtime
                    .sendMessage({
                        type: "macroAdded",
                        actionId: schemaResult.actionId,
                    })
                    .catch(() => {
                        // Ignore errors if no listeners
                    });
            }

            return {
                intent: schemaResult.intent,
                intentJson: schemaResult.intentJson,
                actions: schemaResult.actions,
                intentTypeDefinition: schemaResult.intentTypeDefinition,
                actionId: schemaResult.actionId, // For UI feedback
            };
        }
        case "getMacrosForUrl": {
            const result = await sendActionToAgent({
                actionName: "getMacrosForUrl",
                parameters: {
                    url: message.url,
                    includeGlobal: message.includeGlobal ?? true,
                    author: message.author,
                },
            });
            return result;
        }
        case "getViewHostUrl": {
            const result = await sendActionToAgent({
                actionName: "getViewHostUrl",
                parameters: {},
            });
            return result;
        }
        case "startRecording": {
            const targetTab = await getActiveTab();
            if (targetTab?.id) {
                await chrome.tabs.sendMessage(
                    targetTab.id,
                    {
                        type: "startRecording",
                    },
                    { frameId: 0 }, // Limit action recording to the top frame for now
                );
            }
            return {};
        }
        case "stopRecording": {
            const targetTab = await getActiveTab();
            if (targetTab?.id) {
                const response = await chrome.tabs.sendMessage(
                    targetTab.id,
                    {
                        type: "stopRecording",
                    },
                    { frameId: 0 },
                );
                return response;
            }
            return {};
        }
        case "takeScreenshot": {
            const screenshotUrl = await chrome.tabs.captureVisibleTab({
                format: "png",
            });

            return screenshotUrl;
        }
        case "captureHtmlFragments": {
            const targetTab = await getActiveTab();
            if (targetTab) {
                const htmlFragments = await getTabHTMLFragments(
                    targetTab,
                    CompressionMode.Automation,
                );
                return htmlFragments;
            }
            return [];
        }
        case "saveRecordedActions": {
            await saveRecordedActions(
                message.recordedActions,
                message.recordedActionPageHTML,
                message.recordedActionScreenshot,
                message.actionIndex,
                message.isCurrentlyRecording,
            );
            return {};
        }
        case "recordingStopped": {
            await saveRecordedActions(
                message.recordedActions,
                message.recordedActionPageHTML,
                message.recordedActionScreenshot,
                message.actionIndex,
                false,
            );
            return {};
        }
        case "getRecordedActions": {
            const result = await getRecordedActions();
            return result;
        }
        case "downloadData": {
            const jsonString = JSON.stringify(message.data, null, 2);
            const dataUrl =
                "data:application/json;charset=utf-8," +
                encodeURIComponent(jsonString);

            chrome.downloads.download({
                url: dataUrl,
                filename: message.filename || "schema-metadata.json",
                saveAs: true,
            });
            return {};
        }

        case "extractPageKnowledge": {
            const targetTab = await getActiveTab();
            if (targetTab) {
                try {
                    const htmlFragments = await getTabHTMLFragments(
                        targetTab,
                        CompressionMode.KnowledgeExtraction,
                        false,
                        true,
                        false, // useTimestampIds
                        true, // filterToReadingView - use reading view for knowledge extraction
                        true, // keepMetaTags - preserve metadata for context
                    );

                    const knowledgeResult = await sendActionToAgent({
                        actionName: "extractKnowledgeFromPage",
                        parameters: {
                            url: targetTab.url,
                            title: targetTab.title,
                            htmlFragments: htmlFragments,
                            extractEntities: true,
                            extractRelationships: true,
                            suggestQuestions: true,
                            mode: message.extractionSettings?.mode || "content", // Use extraction mode parameter
                        },
                    });

                    console.log(
                        "Knowledge extraction result:",
                        knowledgeResult,
                    );

                    return {
                        knowledge: {
                            entities: knowledgeResult.entities || [],
                            relationships: knowledgeResult.relationships || [],
                            keyTopics: knowledgeResult.keyTopics || [],
                            suggestedQuestions:
                                knowledgeResult.suggestedQuestions || [],
                            summary: knowledgeResult.summary || "",
                            contentActions:
                                knowledgeResult.contentActions || [],
                            // Enhanced content data
                            detectedActions:
                                knowledgeResult.detectedActions || [],
                            actionSummary: knowledgeResult.actionSummary,
                            contentMetrics: knowledgeResult.contentMetrics || {
                                readingTime: 0,
                                wordCount: 0,
                            },
                        },
                    };
                } catch (error) {
                    console.error("Error extracting knowledge:", error);
                    return { error: "Failed to extract knowledge from page" };
                }
            }
            return {
                error: "No browser tabs are currently open. Please open a browser tab to continue.",
            };
        }

        case "extractPageKnowledgeStreaming": {
            const targetTab = await getActiveTab();
            if (targetTab && message.streamingEnabled) {
                const extractionId = message.extractionId;

                const progressCallback = (
                    progress: KnowledgeExtractionProgress,
                ) => {
                    try {
                        chrome.runtime.sendMessage({
                            type: "knowledgeExtractionProgress",
                            extractionId,
                            progress: progress,
                        });
                        /*
                            .catch((error) => {
                                // Handle case where no listeners are available
                                console.log("No listeners for progress update:", error);
                            })*/
                    } catch (error) {
                        console.error("Failed to send progress to UI:", error);
                    }
                };

                // Register progress handler
                knowledgeExtractionCallbacks.set(
                    extractionId,
                    progressCallback,
                );

                try {
                    const htmlFragments = await getTabHTMLFragments(
                        targetTab,
                        CompressionMode.KnowledgeExtraction,
                        false,
                        false,
                        false, // useTimestampIds
                        true, // filterToReadingView - use reading view for knowledge extraction
                        true, // keepMetaTags - preserve metadata for context
                    );

                    // Start extraction with streaming flag
                    const knowledgeResult = await sendActionToAgent({
                        actionName: "extractKnowledgeFromPageStreaming",
                        parameters: {
                            url: targetTab.url,
                            title: targetTab.title,
                            mode: message.mode || "content",
                            extractionId: extractionId,
                            htmlFragments: htmlFragments,
                            extractionSettings: message.extractionSettings,
                            saveToIndex: message.saveToIndex || false,
                        },
                    });

                    return {
                        success: true,
                        extractionId: extractionId,
                        finalData: knowledgeResult,
                    };
                } catch (error) {
                    console.error(
                        "Error in streaming knowledge extraction:",
                        error,
                    );

                    // Send error progress update
                    const errorProgress: KnowledgeExtractionProgress = {
                        extractionId,
                        phase: "error",
                        totalItems: 1,
                        processedItems: 0,
                        errors: [
                            {
                                message:
                                    (error as Error).message || String(error),
                                timestamp: Date.now(),
                            },
                        ],
                    };

                    const callback =
                        knowledgeExtractionCallbacks.get(extractionId);
                    if (callback) {
                        callback(errorProgress);
                        knowledgeExtractionCallbacks.delete(extractionId);
                    }

                    return {
                        error: "Failed to extract knowledge from page",
                        extractionId: extractionId,
                        success: false,
                    };
                }
            } else {
                // Return error if streaming was requested but cannot be performed
                return {
                    error: targetTab
                        ? "Streaming mode is disabled"
                        : "No browser tabs are currently open",
                    extractionId: message.extractionId,
                    success: false,
                };
            }
        }

        case "queryKnowledge": {
            try {
                return await sendActionToAgent({
                    actionName: "searchWebMemories",
                    parameters: {
                        query: message.parameters.query,
                        searchScope:
                            message.parameters.searchScope || "current_page",
                        metadata: {
                            url: message.parameters.url,
                        },
                    },
                });
            } catch (error) {
                console.error("Error querying knowledge:", error);
                return { error: "Failed to query knowledge" };
            }
        }

        case "generatePageQuestions": {
            try {
                return await sendActionToAgent({
                    actionName: "generatePageQuestions",
                    parameters: {
                        url: message.url,
                        pageKnowledge: message.pageKnowledge,
                    },
                });
            } catch (error) {
                console.error("Error generating page questions:", error);
                return { error: "Failed to generate page questions" };
            }
        }

        case "discoverRelatedKnowledge": {
            try {
                return await sendActionToAgent({
                    actionName: "discoverRelatedKnowledge",
                    parameters: {
                        entities: message.entities || [],
                        topics: message.topics || [],
                        depth: message.depth || 2,
                        maxEntities: message.maxEntities || 10,
                        maxTopics: message.maxTopics || 10,
                    },
                });
            } catch (error) {
                console.error("Error discovering related knowledge:", error);
                return {
                    relatedEntities: [],
                    relatedTopics: [],
                    success: false,
                };
            }
        }

        case "generateGraphQuestions": {
            try {
                return await sendActionToAgent({
                    actionName: "generateGraphQuestions",
                    parameters: {
                        url: message.url,
                        relatedEntities: message.relatedEntities,
                        relatedTopics: message.relatedTopics,
                    },
                });
            } catch (error) {
                console.error("Error generating graph questions:", error);
                return { error: "Failed to generate graph questions" };
            }
        }

        case "searchWebMemories": {
            return await handleSearchWebMemories(message);
        }

        case "searchByEntities": {
            return await handleSearchByEntities(message);
        }

        case "searchByTopics": {
            return await handleSearchByTopics(message);
        }

        case "getHierarchicalTopics": {
            return await handleGetHierarchicalTopics(message);
        }

        case "getTopicImportanceLayer": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getTopicImportanceLayer",
                    parameters: {
                        maxNodes: message.maxNodes,
                        minImportanceThreshold: message.minImportanceThreshold,
                    },
                });
                return result;
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
        }

        case "getTopicViewportNeighborhood": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getTopicViewportNeighborhood",
                    parameters: {
                        centerTopic: message.centerTopic,
                        viewportTopicIds: message.viewportTopicIds,
                        maxNodes: message.maxNodes,
                        maxDepth: message.maxDepth,
                    },
                });
                return result;
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
        }

        case "getTopicMetrics": {
            return await handleGetTopicMetrics(message);
        }

        case "getTopicDetails": {
            try {
                console.log("Fetching topic details from agent...");

                const result = await sendActionToAgent({
                    actionName: "getTopicDetails",
                    parameters: {
                        topicId: message.parameters?.topicId,
                    },
                });

                return result;
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
        }

        case "getEntityDetails": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getEntityDetails",
                    parameters: {
                        entityName: message.parameters?.entityName,
                    },
                });
                return result;
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
        }

        case "getTopicTimelines": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getTopicTimelines",
                    parameters: {
                        topicNames: message.parameters.topicNames,
                        maxTimelineEntries:
                            message.parameters.maxTimelineEntries,
                        timeRange: message.parameters.timeRange,
                        includeRelatedTopics:
                            message.parameters.includeRelatedTopics,
                        neighborhoodDepth: message.parameters.neighborhoodDepth,
                    },
                });
                return result;
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
        }

        case "hybridSearch": {
            return await handleHybridSearch(message);
        }

        // Cross-page intelligence handlers
        case "discoverRelationships": {
            try {
                const result = await sendActionToAgent({
                    actionName: "discoverRelationships",
                    parameters: {
                        url: message.url,
                        knowledge: message.knowledge,
                        maxResults: message.maxResults || 10,
                    },
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
        }

        case "analyzeKnowledgeGaps": {
            try {
                const result = await sendActionToAgent({
                    actionName: "analyzeKnowledgeGaps",
                    parameters: {
                        url: message.url,
                        knowledge: message.knowledge,
                        relatedContent: message.relatedContent || [],
                    },
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
        }

        case "indexPageContentDirect": {
            const targetTab = await getActiveTab();
            if (targetTab) {
                const success = await indexPageContent(
                    targetTab,
                    message.showNotification !== false,
                    {
                        mode: message.mode,
                        extractedKnowledge: message.extractedKnowledge,
                    },
                );
                return { success };
            }
            return {
                success: false,
                error: "No browser tabs are currently open. Please open a browser tab to continue.",
            };
        }

        case "autoIndexPage": {
            const targetTab = await getActiveTab();
            if (targetTab && (await shouldIndexPage(targetTab.url!))) {
                const success = await indexPageContent(targetTab, false, {
                    quality: message.quality,
                    textOnly: message.textOnly,
                });
                return { success };
            }
            return { success: false, error: "Page not eligible for indexing" };
        }

        case "getPageIndexStatus": {
            try {
                return await sendActionToAgent({
                    actionName: "checkPageIndexStatus",
                    parameters: {
                        url: message.url,
                    },
                });
            } catch (error) {
                console.error("Error checking page index status:", error);
                return { isIndexed: false, error: "Failed to check status" };
            }
        }

        case "getPageIndexedKnowledge": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getPageIndexedKnowledge",
                    parameters: {
                        url: message.url,
                    },
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
        }

        case "indexExtractedKnowledge": {
            try {
                console.log(
                    `📥 Indexing extracted knowledge for ${message.url}`,
                );
                const result = await sendActionToAgent({
                    actionName: "indexWebPageContent",
                    parameters: {
                        url: message.url,
                        title: message.title,
                        extractKnowledge: false, // Knowledge already extracted
                        timestamp:
                            message.timestamp || new Date().toISOString(),
                        mode: message.mode || "content",
                        extractedKnowledge: message.extractedKnowledge,
                    },
                });

                console.log(
                    `✅ Knowledge indexed for ${message.url}: ${result.entityCount} entities`,
                );
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
        }

        case "getIndexStats": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getKnowledgeIndexStats",
                    parameters: {},
                });

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
        }

        case "checkConnection": {
            const webSocket = getWebSocket();
            return {
                connected: webSocket && webSocket.readyState === WebSocket.OPEN,
            };
        }

        case "autoIndexSettingChanged": {
            console.log("Auto-indexing setting changed:", message.enabled);
            return { success: true };
        }

        // Website Library Panel message handlers
        case "importWebsiteDataWithProgress": {
            return await handleImportWebsiteDataWithProgress(message);
        }

        case "getWebsiteLibraryStats": {
            return await sendActionToAgent({
                actionName: "getLibraryStats",
                parameters: {},
            });
        }

        case "clearWebsiteLibrary": {
            return await handleClearWebsiteLibrary();
        }

        case "cancelImport": {
            return await handleCancelImport(message.importId);
        }

        // HTML Folder Import message handlers
        case "importHtmlFolder": {
            return await handleImportHtmlFolder(message);
        }

        case "getFileImportProgress": {
            return await handleGetFileImportProgress(message.importId);
        }

        case "cancelFileImport": {
            return await handleCancelFileImport(message.importId);
        }

        // Content Download Adapter message handlers
        case "downloadContentWithBrowser": {
            return await handleDownloadContentWithBrowser(message);
        }

        case "processHtmlContent": {
            return await handleProcessHtmlContent(message);
        }

        case "testOffscreenDocument": {
            return await handleTestOffscreenDocument(message);
        }

        // Enhanced search message handlers (searchWebsitesEnhanced removed - was broken)

        case "saveSearchHistory": {
            return await handleSaveSearchHistory(message);
        }

        case "getSearchHistory": {
            return await handleGetSearchHistory();
        }

        case "getSuggestedSearches": {
            return await handleGetSuggestedSearches();
        }

        // Index management message handlers
        case "checkIndexStatus": {
            return await handleCheckIndexStatus();
        }

        case "deleteMacro": {
            // Handler for deleting macros from the MacroStore
            try {
                const result = await sendActionToAgent({
                    actionName: "deleteMacro",
                    parameters: {
                        macroId: message.macroId,
                    },
                });

                // Notify sidepanel that a macro was deleted
                if (result.success) {
                    chrome.runtime
                        .sendMessage({
                            type: "macroDeleted",
                            macroId: message.macroId,
                        })
                        .catch(() => {
                            // Ignore errors if no listeners
                        });
                }

                return result;
            } catch (error) {
                console.error("Failed to delete macro:", error);
                return {
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                };
            }
        }
        case "getAllMacros": {
            try {
                return await sendActionToAgent({
                    actionName: "getAllMacros",
                    parameters: {
                        includeGlobal: true,
                    },
                });
            } catch (error) {
                console.error("Error getting all actions:", error);
                return { actions: [] };
            }
        }
        case "getActionDomains": {
            try {
                return await sendActionToAgent({
                    actionName: "getActionDomains",
                    parameters: {},
                });
            } catch (error) {
                console.error("Error getting action domains:", error);
                return { domains: [] };
            }
        }

        case "getMacroDomains": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getActionDomains", // Maps to existing action
                    parameters: {},
                });
                return result; // Should return { domains: string[] }
            } catch (error) {
                console.error("Error getting macro domains:", error);
                return { domains: [] };
            }
        }

        case "checkAIModelAvailability": {
            try {
                // Check if AI model is available by attempting a simple extraction
                const result = await sendActionToAgent({
                    actionName: "extractKnowledgeFromPage",
                    parameters: {
                        url: "test://ai-check",
                        title: "AI Availability Test",
                        htmlFragments: [
                            { text: "test content for AI availability check" },
                        ],
                        extractEntities: false,
                        extractRelationships: false,
                        suggestQuestions: false,
                        mode: "basic",
                    },
                });

                return {
                    available: !result.error,
                    version: result.version || "unknown",
                    endpoint: result.endpoint || "unknown",
                };
            } catch (error) {
                console.error("Error checking AI model availability:", error);
                return {
                    available: false,
                    error:
                        error instanceof Error ? error.message : String(error),
                };
            }
        }

        case "getPageQualityMetrics": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getKnowledgeIndexStats",
                    parameters: {
                        url: message.url,
                    },
                });

                // Extract quality metrics for the specific page
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
        }

        case "settingsUpdated": {
            // Handle settings update notification
            console.log("Settings updated:", message.settings);

            // Store the new settings for use by other handlers
            await chrome.storage.local.set({
                knowledgeSettings: message.settings,
            });

            return { success: true };
        }

        case "getRecentKnowledgeItems": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getRecentKnowledgeItems",
                    parameters: {
                        limit: message.limit || 10,
                        type: message.itemType || "both",
                    },
                });

                return {
                    success: result.success || false,
                    entities: result.entities || [],
                    topics: result.topics || [],
                };
            } catch (error) {
                console.error("Error getting recent knowledge items:", error);
                return {
                    success: false,
                    entities: [],
                    topics: [],
                    error:
                        error instanceof Error ? error.message : String(error),
                };
            }
        }

        case "getDiscoverInsights": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getDiscoverInsights",
                    parameters: {
                        limit: message.limit || 10,
                        timeframe: message.timeframe || "30d",
                    },
                });

                return {
                    success: result.success || false,
                    trendingTopics: result.trendingTopics || [],
                    readingPatterns: result.readingPatterns || [],
                    popularPages: result.popularPages || [],
                    topDomains: result.topDomains || [],
                };
            } catch (error) {
                console.error("Error getting discover insights:", error);
                return {
                    success: false,
                    trendingTopics: [],
                    readingPatterns: [],
                    popularPages: [],
                    topDomains: [],
                    error:
                        error instanceof Error ? error.message : String(error),
                };
            }
        }

        case "getAnalyticsData": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getAnalyticsData",
                    parameters: {
                        timeRange: message.timeRange || "30d",
                        includeQuality: message.includeQuality !== false,
                        includeProgress: message.includeProgress !== false,
                        topDomainsLimit: message.topDomainsLimit || 10,
                        activityGranularity:
                            message.activityGranularity || "day",
                    },
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
        }

        case "getKnowledgeGraphStatus": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getKnowledgeGraphStatus",
                    parameters: {},
                });

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
        }

        case "buildKnowledgeGraph": {
            try {
                const result = await sendActionToAgent({
                    actionName: "buildKnowledgeGraph",
                    parameters: message.parameters || {},
                });

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
        }

        case "rebuildKnowledgeGraph": {
            try {
                const result = await sendActionToAgent({
                    actionName: "rebuildKnowledgeGraph",
                    parameters: {},
                });

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
        }

        case "testMergeTopicHierarchies": {
            try {
                const result = await sendActionToAgent({
                    actionName: "testMergeTopicHierarchies",
                    parameters: {},
                });

                return result;
            } catch (error) {
                console.error("Error testing topic merge:", error);
                return {
                    success: false,
                    mergeCount: 0,
                    error: "Failed to test topic merge",
                };
            }
        }

        case "mergeTopicHierarchies": {
            try {
                const result = await sendActionToAgent({
                    actionName: "mergeTopicHierarchies",
                    parameters: {},
                });

                return result;
            } catch (error) {
                console.error("Error merging topic hierarchies:", error);
                return {
                    success: false,
                    mergeCount: 0,
                    error: "Failed to merge topic hierarchies",
                };
            }
        }

        case "getAllRelationships": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getAllRelationships",
                    parameters: {},
                });

                return result;
            } catch (error) {
                console.error("Error getting all relationships:", error);
                return [];
            }
        }

        case "getAllCommunities": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getAllCommunities",
                    parameters: {},
                });

                return result;
            } catch (error) {
                console.error("Error getting all communities:", error);
                return [];
            }
        }

        case "getAllEntitiesWithMetrics": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getAllEntitiesWithMetrics",
                    parameters: {},
                });

                return result;
            } catch (error) {
                console.error(
                    "Error getting all entities with metrics:",
                    error,
                );
                return [];
            }
        }

        case "getEntityNeighborhood": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getEntityNeighborhood",
                    parameters: {
                        entityId: message.entityId,
                        depth: message.depth,
                        maxNodes: message.maxNodes,
                    },
                });

                return result;
            } catch (error) {
                console.error("Error getting entity neighborhood:", error);
                return [];
            }
        }

        case "getGlobalImportanceLayer": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getGlobalImportanceLayer",
                    parameters: {
                        maxNodes: message.maxNodes,
                        includeConnectivity: message.includeConnectivity,
                    },
                });
                return result;
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
        }

        case "getImportanceStatistics": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getImportanceStatistics",
                    parameters: {},
                });
                return result;
            } catch (error) {
                console.error("Error getting importance statistics:", error);
                return {
                    distribution: [],
                    recommendedLevel: 1,
                    levelPreview: [],
                };
            }
        }

        case "getViewportBasedNeighborhood": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getViewportBasedNeighborhood",
                    parameters: {
                        centerEntity: message.centerEntity,
                        viewportNodeNames: message.viewportNodeNames,
                        maxNodes: message.maxNodes,
                        importanceWeighting: message.importanceWeighting,
                        includeGlobalContext: message.includeGlobalContext,
                        exploreFromAllViewportNodes:
                            message.exploreFromAllViewportNodes,
                        minDepthFromViewport: message.minDepthFromViewport,
                    },
                });
                return result;
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
        }

        default:
            return null;
    }
}

// Website Library Panel handlers
async function handleImportWebsiteDataWithProgress(message: any) {
    const importId = message.importId;
    const totalItems = message.totalItems || 0;

    try {
        // Send initial progress update
        sendProgressToUI(importId, {
            importId,
            phase: "initializing",
            totalItems: totalItems,
            processedItems: 0,
            errors: [],
        });

        const startTime = Date.now();

        const result = await sendActionToAgent({
            actionName: "importWebsiteDataWithProgress",
            parameters: {
                source: message.parameters.source,
                type: message.parameters.type,
                limit: message.parameters.limit,
                days: message.parameters.days,
                folder: message.parameters.folder,
                mode: message.parameters.mode || "basic",
                maxConcurrent: message.parameters.maxConcurrent,
                contentTimeout: message.parameters.contentTimeout,
                importId: importId,
                totalItems: totalItems,
                progressCallback: true,
            },
        });

        // Send completion progress
        sendProgressToUI(importId, {
            importId,
            phase: "complete",
            totalItems: totalItems,
            processedItems: totalItems,
            errors: [],
        });

        return {
            success: !result.error,
            itemCount: result.itemCount || totalItems,
            error: result.error,
        };
    } catch (error) {
        console.error("Error importing website data:", error);

        // Send error progress to UI
        sendProgressToUI(importId, {
            importId,
            phase: "error",
            totalItems: totalItems,
            processedItems: 0,
            errors: [
                {
                    type: "processing",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                    timestamp: Date.now(),
                },
            ],
        });

        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

function sendProgressToUI(importId: string, progress: any) {
    // Ensure progress has required structure
    const structuredProgress = {
        importId: importId,
        phase: progress.phase || "processing",
        totalItems: progress.totalItems || 0,
        processedItems: progress.processedItems || 0,
        currentItem: progress.currentItem,
        errors: progress.errors || [],
        ...progress,
    };

    // Send to all connected library panels via runtime messaging
    try {
        chrome.runtime
            .sendMessage({
                type: "importProgress",
                importId,
                progress: structuredProgress,
            })
            .catch((error) => {
                // Handle case where no listeners are available
                console.log("No listeners for progress update:", error);
            });
    } catch (error) {
        console.error("Failed to send progress to UI:", error);
    }
}

async function handleClearWebsiteLibrary() {
    try {
        await sendActionToAgent({
            actionName: "clearKnowledgeIndex",
            parameters: {},
        });

        return { success: true };
    } catch (error) {
        console.error("Error clearing website library:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

async function handleCancelImport(importId: string) {
    try {
        // Implementation would depend on how imports are tracked
        // For now, just return success
        return { success: true };
    } catch (error) {
        console.error("Error cancelling import:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// HTML Folder Import handlers
async function handleImportHtmlFolder(message: any) {
    try {
        const { parameters } = message;
        const { folderPath, options, importId } = parameters;

        // Send action to backend agent using the new ImportHtmlFolder action
        const result = await sendActionToAgent({
            actionName: "importHtmlFolder",
            parameters: {
                folderPath,
                options: {
                    mode: options?.mode || "basic",
                    preserveStructure: options?.preserveStructure ?? true,
                    recursive: options?.recursive ?? true,
                    fileTypes: options?.fileTypes ?? [
                        ".html",
                        ".htm",
                        ".mhtml",
                    ],
                    limit: options?.limit,
                    maxFileSize: options?.maxFileSize,
                    skipHidden: options?.skipHidden ?? true,
                },
                importId,
            },
        });

        return {
            success: !result.error,
            itemCount: result.websiteCount || 0,
            importId: importId,
            duration: result.duration || 0,
            errors: result.errors || [],
            summary: {
                totalProcessed: result.websiteCount || 0,
                successfullyImported: result.websiteCount || 0,
                knowledgeExtracted: result.knowledgeCount || 0,
                entitiesFound: result.entityCount || 0,
                topicsIdentified: result.topicCount || 0,
                actionsDetected: result.actionCount || 0,
            },
        };
    } catch (error) {
        console.error("Folder import error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            importId: message.parameters?.importId || "unknown",
            itemCount: 0,
            errors: [(error as Error).message],
            summary: {
                totalProcessed: 0,
                successfullyImported: 0,
                knowledgeExtracted: 0,
                entitiesFound: 0,
                topicsIdentified: 0,
                actionsDetected: 0,
            },
        };
    }
}

async function handleGetFileImportProgress(importId: string) {
    try {
        // For now, return a basic progress response
        // In a full implementation, this would track actual import progress
        return {
            success: true,
            progress: {
                importId: importId,
                phase: "complete",
                totalItems: 0,
                processedItems: 0,
                errors: [],
            },
        };
    } catch (error) {
        console.error("Error getting file import progress:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

async function handleCancelFileImport(importId: string) {
    try {
        // Implementation would depend on how file imports are tracked
        // For now, just return success
        return { success: true };
    } catch (error) {
        console.error("Error cancelling file import:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// Enhanced search handlers
async function handleSearchWebMemories(message: any) {
    try {
        const startTime = Date.now();

        // Use the new unified search action
        const result = await sendActionToAgent({
            actionName: "searchWebMemories",
            parameters: {
                query: message.parameters.query,
                generateAnswer: true, // Knowledge Library wants answers
                includeRelatedEntities: true,
                enableAdvancedSearch: true,
                limit: message.parameters.limit || 20,
                minScore: message.parameters.filters?.minRelevance || 0.3,
                ...message.parameters.filters,
            },
        });

        return {
            success: true,
            results: {
                websites: result.websites || [],
                summary: {
                    text: result.answer || "",
                    totalFound: result.websites?.length || 0,
                    searchTime:
                        result.summary?.searchTime || Date.now() - startTime,
                    sources: result.answerSources || [],
                    entities: result.relatedEntities || [],
                },
                query: message.parameters.query,
                filters: message.parameters.filters || {},
                topTopics: result.topTopics || [],
                suggestedFollowups: result.suggestedFollowups || [],
                relatedEntities: result.relatedEntities || [],
            },
        };
    } catch (error) {
        console.error("Error in unified search:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

async function handleGetSearchSuggestions(message: any) {
    try {
        // Get recent searches from storage for suggestions
        const storage = await chrome.storage.local.get(["searchHistory"]);
        const searchHistory = storage.searchHistory || [];

        const query = message.query.toLowerCase();
        const suggestions = searchHistory
            .filter((search: string) => search.toLowerCase().includes(query))
            .slice(0, message.limit || 5);

        return {
            success: true,
            suggestions: suggestions,
        };
    } catch (error) {
        console.error("Error getting search suggestions:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

async function handleSaveSearchHistory(message: any) {
    try {
        const storage = await chrome.storage.local.get(["searchHistory"]);
        const searchHistory = storage.searchHistory || [];

        // Add new search to beginning, remove duplicates, keep last 20
        const updatedHistory = [
            message.query,
            ...searchHistory.filter((s: string) => s !== message.query),
        ].slice(0, 20);

        await chrome.storage.local.set({
            searchHistory: updatedHistory,
        });

        return { success: true };
    } catch (error) {
        console.error("Error saving search history:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

async function handleGetSearchHistory() {
    try {
        const storage = await chrome.storage.local.get(["searchHistory"]);
        return {
            success: true,
            searches: storage.searchHistory || [],
        };
    } catch (error) {
        console.error("Error getting search history:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

async function handleGetSuggestedSearches() {
    try {
        // Get website stats to generate suggestions
        const statsResult = await sendActionToAgent({
            actionName: "getWebsiteStats",
            parameters: {
                groupBy: "domain",
                limit: 20,
            },
        });

        const suggestions = generateSuggestionsFromStats(
            statsResult.literalText ||
                statsResult.text ||
                statsResult.result ||
                "",
        );

        return {
            success: true,
            suggestions: suggestions,
        };
    } catch (error) {
        console.error("Error getting suggested searches:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// Helper function to parse website stats from text response

// Helper functions for knowledge indexing
async function indexPageContent(
    tab: chrome.tabs.Tab,
    showNotification: boolean = true,
    options: {
        quality?: "fast" | "balanced" | "deep";
        textOnly?: boolean;
        mode?: "basic" | "content" | "actions" | "full";
        extractedKnowledge?: any;
    } = {},
): Promise<boolean> {
    try {
        let htmlFragments = null;
        let extractKnowledge = true;

        if (options.extractedKnowledge) {
            extractKnowledge = false;
        } else {
            htmlFragments = await getTabHTMLFragments(
                tab,
                CompressionMode.KnowledgeExtraction,
                false,
                true, // extract text
                false, // useTimestampIds
                true, // filterToReadingView - use reading view for indexing
                true, // keepMetaTags - preserve metadata for indexing context
            );
        }

        const parameters: any = {
            url: tab.url,
            title: tab.title,
            extractKnowledge: extractKnowledge,
            timestamp: new Date().toISOString(),
            quality: options.quality || "balanced",
            textOnly: options.textOnly || false,
            mode: options.mode || "content",
        };

        if (options.extractedKnowledge) {
            parameters.extractedKnowledge = options.extractedKnowledge;
        } else {
            parameters.htmlFragments = htmlFragments;
        }

        await sendActionToAgent({
            actionName: "indexWebPageContent",
            parameters: parameters,
        });

        if (showNotification) {
            chrome.action.setBadgeText({ text: "✓", tabId: tab.id });
            chrome.action.setBadgeBackgroundColor({
                color: "#28a745",
                tabId: tab.id,
            });
            setTimeout(() => {
                chrome.action.setBadgeText({ text: "", tabId: tab.id });
            }, 3000);
        }

        return true;
    } catch (error) {
        console.error("Error indexing page content:", error);

        if (showNotification) {
            chrome.action.setBadgeText({ text: "✗", tabId: tab.id });
            chrome.action.setBadgeBackgroundColor({
                color: "#dc3545",
                tabId: tab.id,
            });
            setTimeout(() => {
                chrome.action.setBadgeText({ text: "", tabId: tab.id });
            }, 3000);
        }

        return false;
    }
}

// Enhanced shouldIndexPage with more sophisticated checks
async function shouldIndexPage(url: string): Promise<boolean> {
    const settings = await chrome.storage.sync.get([
        "autoIndexing",
        "excludeSensitiveSites",
        "indexOnlyTextContent",
    ]);

    if (!settings.autoIndexing) {
        return false;
    }

    // Check sensitive sites
    if (settings.excludeSensitiveSites) {
        const sensitivePatterns = [
            /banking/i,
            /bank\./i,
            /login/i,
            /signin/i,
            /auth/i,
            /healthcare/i,
            /medical/i,
            /patient/i,
            /health/i,
            /paypal/i,
            /payment/i,
            /checkout/i,
            /billing/i,
            /admin/i,
            /dashboard/i,
            /account/i,
            /profile/i,
        ];

        if (sensitivePatterns.some((pattern) => pattern.test(url))) {
            return false;
        }
    }

    // Don't index localhost, internal IPs, or file:// URLs
    if (
        url.includes("localhost") ||
        url.startsWith("file://") ||
        url.includes("127.0.0.1") ||
        url.includes("192.168.") ||
        url.includes(".local")
    ) {
        return false;
    }

    // Don't index media files or downloads
    const mediaExtensions =
        /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|exe|dmg|pkg|mp4|mp3|avi|mov|jpg|jpeg|png|gif|svg)$/i;
    if (mediaExtensions.test(url)) {
        return false;
    }

    return true;
}

// Index management handlers
async function handleCheckIndexStatus() {
    try {
        const result = await sendActionToAgent({
            actionName: "getKnowledgeIndexStats",
            parameters: {},
        });

        // getKnowledgeIndexStats returns stats object directly when successful
        if (result && result.totalPages !== undefined) {
            return {
                success: true,
                exists: result.totalPages > 0,
            };
        } else {
            return {
                success: false,
                exists: false,
                error: result?.error || "Failed to get index stats",
            };
        }
    } catch (error) {
        console.error("Error checking index status:", error);
        return {
            success: false,
            exists: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

function generateSuggestionsFromStats(statsText: string): any {
    const suggestions = {
        recentFinds: [] as any[],
        popularDomains: [] as any[],
        exploreTopics: [] as any[],
    };

    try {
        const lines = statsText.split("\n");

        // Extract domain information for popular domains
        const domainLines = lines.filter(
            (line) =>
                line.includes(":") &&
                line.includes("sites") &&
                !line.includes("Total") &&
                !line.includes("Source"),
        );

        // Generate popular domain suggestions
        domainLines.slice(0, 3).forEach((line) => {
            const domainMatch = line.match(/^([^:]+):/);
            if (domainMatch) {
                const domain = domainMatch[1].trim();
                suggestions.popularDomains.push({
                    query: `site:${domain}`,
                    category: "Popular Domains",
                    description: `Search content from ${domain}`,
                    estimatedResults: parseInt(
                        line.match(/(\d+)\s*sites?/)?.[1] || "0",
                    ),
                });
            }
        });

        // Generate topic suggestions based on common patterns
        const topicSuggestions = [
            {
                query: "documentation",
                description: "Find technical documentation and guides",
                estimatedResults: 0,
            },
            {
                query: "tutorial",
                description: "Discover learning resources and tutorials",
                estimatedResults: 0,
            },
            {
                query: "github",
                description: "Explore your saved repositories and code",
                estimatedResults: 0,
            },
        ];

        suggestions.exploreTopics = topicSuggestions;

        // Generate recent finds suggestions
        const recentSuggestions = [
            {
                query: "last week",
                description: "Recently visited or bookmarked sites",
                estimatedResults: 0,
            },
            {
                query: "today",
                description: "Sites from today",
                estimatedResults: 0,
            },
        ];

        suggestions.recentFinds = recentSuggestions;
    } catch (error) {
        console.error("Error generating suggestions from stats:", error);
    }

    return suggestions;
}

// Content Download Adapter handler functions
let contentDownloader: BrowserContentDownloader | null = null;

/**
 * Get or create a content downloader instance
 */
function getContentDownloader(): BrowserContentDownloader {
    if (!contentDownloader) {
        contentDownloader = new BrowserContentDownloader();
    }
    return contentDownloader;
}

/**
 * Handle browser-based content download requests
 */
async function handleDownloadContentWithBrowser(message: any): Promise<any> {
    try {
        const downloader = getContentDownloader();

        // Clamp timeout to safe range (min 1000 ms, max 10000 ms)
        const requestedTimeout = Number(message.options?.timeout);
        const safeTimeout =
            Number.isFinite(requestedTimeout) && requestedTimeout >= 1000
                ? Math.min(requestedTimeout, 10000)
                : 3000; // fallback to 3 seconds if invalid

        const result = await downloader.downloadContent(message.url, {
            useAuthentication: message.options?.useAuthentication ?? true,
            timeout: safeTimeout,
            fallbackToFetch: message.options?.fallbackToFetch ?? true,
            waitForDynamic: message.options?.waitForDynamic ?? false,
            scrollBehavior:
                message.options?.scrollBehavior ?? "capture-initial",
            processing: message.options?.processing ?? {
                filterToReadingView: true,
                keepMetaTags: true,
                extractText: true,
            },
        });

        return result;
    } catch (error) {
        console.error("Error in handleDownloadContentWithBrowser:", error);
        return {
            success: false,
            method: "failed",
            error:
                error instanceof Error
                    ? error.message
                    : "Unknown error occurred",
        };
    }
}

/**
 * Handle HTML content processing requests (for folder imports)
 */
async function handleProcessHtmlContent(message: any): Promise<any> {
    try {
        const downloader = getContentDownloader();

        const result = await downloader.processHtmlContent(
            message.htmlContent,
            {
                filterToReadingView:
                    message.options?.filterToReadingView ?? true,
                keepMetaTags: message.options?.keepMetaTags ?? true,
                extractText: message.options?.extractText ?? true,
                preserveStructure: message.options?.preserveStructure ?? true,
                maxElements: message.options?.maxElements,
            },
        );

        return {
            success: true,
            data: result,
        };
    } catch (error) {
        console.error("Error in handleProcessHtmlContent:", error);
        return {
            success: false,
            error:
                error instanceof Error
                    ? error.message
                    : "HTML processing failed",
        };
    }
}

/**
 * Handle offscreen document testing requests
 */
async function handleTestOffscreenDocument(message: any): Promise<any> {
    try {
        const downloader = getContentDownloader();
        const status = downloader.getStatus();

        if (!status.available) {
            return {
                success: false,
                error: "Offscreen document API not available",
                status,
            };
        }

        // Test basic functionality with a simple page
        const testUrl = message.testUrl || "https://example.com";
        const result = await downloader.downloadContent(testUrl, {
            timeout: 10000,
            fallbackToFetch: false, // Force browser method for testing
            processing: {
                filterToReadingView: false,
                extractText: true,
            },
        });

        return {
            success: result.success,
            testUrl,
            method: result.method,
            contentLength: result.htmlContent?.length || 0,
            textLength: result.textContent?.length || 0,
            loadTime: result.metadata?.loadTime || 0,
            error: result.error,
            status,
        };
    } catch (error) {
        console.error("Error in handleTestOffscreenDocument:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Test failed",
            status: { available: false, method: "unknown", capabilities: [] },
        };
    }
}

// Entity-based search handlers - Preserves full entity graph data
async function handleSearchByEntities(message: any): Promise<any> {
    try {
        const startTime = Date.now();

        // Send action to agent for entity-based search
        const result = await sendActionToAgent({
            actionName: "searchByEntities",
            parameters: {
                entities: message.entities || [],
                url: message.url || "",
                maxResults: message.maxResults || 10,
                searchScope: "all_indexed",
                includeMetadata: true,
            },
        });

        // Preserve full response data for entity graph view
        return {
            success: true,
            // Core search results
            websites: result.websites || [],
            summary: result.summary || {
                totalFound: 0,
                searchTime: Date.now() - startTime,
                strategies: ["entity-direct"],
                confidence: 0,
            },
            // Entity graph specific data
            answer: result.answer || "Entity search completed",
            answerType: result.answerType || "direct",
            answerSources: result.answerSources || [],
            queryIntent: result.queryIntent || "discovery",
            relatedEntities: result.relatedEntities || [],
            suggestedFollowups: result.suggestedFollowups || [],
            topTopics: result.topTopics || [],
            // Legacy compatibility
            results: result.websites || [],
            searchTime: Date.now() - startTime,
            totalFound: (result.websites || []).length,
            searchMethod: "entity-direct",
            entities: message.entities,
        };
    } catch (error) {
        console.error("Error in searchByEntities:", error);
        return {
            success: false,
            websites: [],
            results: [],
            summary: {
                totalFound: 0,
                searchTime: 0,
                strategies: ["entity-direct"],
                confidence: 0,
            },
            answer: "Entity search failed",
            answerType: "noAnswer",
            answerSources: [],
            queryIntent: "discovery",
            relatedEntities: [],
            suggestedFollowups: [],
            topTopics: [],
            error:
                error instanceof Error ? error.message : "Entity search failed",
            searchMethod: "entity-direct",
            entities: message.entities || [],
        };
    }
}

async function handleSearchByTopics(message: any): Promise<any> {
    try {
        const startTime = Date.now();

        // Send action to agent for topic-based search
        const result = await sendActionToAgent({
            actionName: "searchByTopics",
            parameters: {
                topics: message.topics || [],
                url: message.url || "",
                maxResults: message.maxResults || 10,
                searchScope: "all_indexed",
                includeMetadata: true,
            },
        });

        // Return complete response data needed for entity graph view
        return {
            success: true,
            websites: result.websites || [],
            summary: result.summary || {
                text: "",
                keyPoints: [],
                confidence: 0,
                sourceCount: 0,
            },
            relatedEntities: result.relatedEntities || [],
            topTopics: result.topTopics || [],
            answerSources: result.answerSources || [],
            searchTime: Date.now() - startTime,
            totalFound: (result.websites || []).length,
            searchMethod: "topic-direct",
            searchScope: "all_indexed",
            topics: message.topics || [],
            contextualInfo: result.contextualInfo || {},
            metadata: result.metadata || {},
            suggestedFollowups: result.suggestedFollowups || [],
        };
    } catch (error) {
        console.error("Error in searchByTopics:", error);
        return {
            success: false,
            websites: [],
            summary: {
                text: "",
                keyPoints: [],
                confidence: 0,
                sourceCount: 0,
            },
            relatedEntities: [],
            topTopics: [],
            answerSources: [],
            searchTime: Date.now() - Date.now(),
            totalFound: 0,
            contextualInfo: {},
            metadata: {},
            suggestedFollowups: [],
            error:
                error instanceof Error ? error.message : "Topic search failed",
            searchMethod: "topic-direct",
            topics: message.topics || [],
        };
    }
}

async function handleHybridSearch(message: any): Promise<any> {
    try {
        const startTime = Date.now();

        // Send action to agent for hybrid search
        const result = await sendActionToAgent({
            actionName: "hybridSearch",
            parameters: {
                query: message.query || "",
                url: message.url || "",
                maxResults: message.maxResults || 10,
                searchScope: "all_indexed",
                includeMetadata: true,
                combineStrategies: true,
            },
        });

        // Return complete response data needed for entity graph view
        return {
            success: true,
            websites: result.websites || [],
            summary: result.summary || {
                text: "",
                keyPoints: [],
                confidence: 0,
                sourceCount: 0,
            },
            relatedEntities: result.relatedEntities || [],
            topTopics: result.topTopics || [],
            answerSources: result.answerSources || [],
            searchTime: Date.now() - startTime,
            totalFound: (result.websites || []).length,
            searchMethod: "hybrid-direct",
            searchScope: "all_indexed",
            query: message.query || "",
            contextualInfo: result.contextualInfo || {},
            metadata: result.metadata || {},
            suggestedFollowups: result.suggestedFollowups || [],
        };
    } catch (error) {
        console.error("Error in hybridSearch:", error);
        return {
            success: false,
            websites: [],
            summary: {
                text: "",
                keyPoints: [],
                confidence: 0,
                sourceCount: 0,
            },
            relatedEntities: [],
            topTopics: [],
            answerSources: [],
            searchTime: Date.now() - Date.now(),
            totalFound: 0,
            contextualInfo: {},
            metadata: {},
            suggestedFollowups: [],
            error:
                error instanceof Error ? error.message : "Hybrid search failed",
            searchMethod: "hybrid-direct",
            query: message.query || "",
        };
    }
}

/**
 * Handle requests for hierarchical topic data
 */
async function handleGetHierarchicalTopics(message: any): Promise<any> {
    try {
        console.log("Fetching hierarchical topics from agent...");
        const startTime = Date.now();

        // Send action to agent to get hierarchical topics
        const result = await sendActionToAgent({
            actionName: "getHierarchicalTopics",
            parameters: {
                centerTopic: message.parameters?.centerTopic,
                includeRelationships:
                    message.parameters?.includeRelationships ?? true,
                maxDepth: message.parameters?.maxDepth ?? 5,
                domain: message.parameters?.domain, // Optional domain filter
            },
        });

        console.log("Received hierarchical topics result:", result);

        if (result && result.success !== false) {
            return {
                success: true,
                topics: result.topics || [],
                relationships: result.relationships || [],
                centerTopic: message.parameters?.centerTopic || null,
                maxDepth: result.maxDepth || 0,
                metadata: {
                    totalTopics: (result.topics || []).length,
                    queryTime: Date.now() - startTime,
                    source: "hierarchical_storage",
                },
            };
        } else {
            console.warn(
                "No hierarchical topics found or agent returned error:",
                result?.error,
            );
            return {
                success: false,
                topics: [],
                relationships: [],
                centerTopic: null,
                maxDepth: 0,
                error: result?.error || "No hierarchical topics available",
                metadata: {
                    totalTopics: 0,
                    queryTime: Date.now() - startTime,
                    source: "hierarchical_storage",
                },
            };
        }
    } catch (error) {
        console.error("Error fetching hierarchical topics:", error);
        return {
            success: false,
            topics: [],
            relationships: [],
            centerTopic: null,
            maxDepth: 0,
            error:
                error instanceof Error
                    ? error.message
                    : "Failed to fetch hierarchical topics",
            metadata: {
                totalTopics: 0,
                queryTime: 0,
                source: "hierarchical_storage",
            },
        };
    }
}

/**
 * Handle requests for topic metrics data
 */
async function handleGetTopicMetrics(message: any): Promise<any> {
    try {
        console.log("Fetching topic metrics from agent...");

        const result = await sendActionToAgent({
            actionName: "getTopicMetrics",
            parameters: {
                topicId: message.parameters?.topicId,
            },
        });

        if (result && result.success !== false) {
            return {
                success: true,
                metrics: result.metrics || {},
            };
        } else {
            return {
                success: false,
                error: result?.error || "No topic metrics available",
            };
        }
    } catch (error) {
        console.error("Error fetching topic metrics:", error);
        return {
            success: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Failed to fetch topic metrics",
        };
    }
}

