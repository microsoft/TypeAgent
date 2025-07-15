// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getActiveTab } from "./tabManager";
import { getTabHTMLFragments, getTabAnnotatedScreenshot } from "./capture";
import { getRecordedActions, saveRecordedActions } from "./storage";
import {
    sendActionToAgent,
    ensureWebsocketConnected,
    getWebSocket,
} from "./websocket";

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
            return await handleGetWebsiteLibraryStats();
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
                        actionName: "getActionsForUrl",
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

            return {
                intent: schemaResult.intent,
                intentJson: schemaResult.intentJson,
                actions: schemaResult.actions,
                intentTypeDefinition: schemaResult.intentTypeDefinition,
                actionId: schemaResult.actionId, // For UI feedback
            };
        }
        case "getActionsForUrl": {
            const result = await sendActionToAgent({
                actionName: "getActionsForUrl",
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
                const htmlFragments = await getTabHTMLFragments(targetTab);
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
                        false,
                        false,
                        true,
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
            return { error: "No active tab found" };
        }

        case "queryKnowledge": {
            try {
                const result = await sendActionToAgent({
                    actionName: "queryWebKnowledge",
                    parameters: {
                        query: message.parameters.query,
                        url: message.parameters.url,
                        searchScope:
                            message.parameters.searchScope || "current_page",
                    },
                });

                return {
                    answer: result.answer || "No answer found",
                    sources: result.sources || [],
                    relatedEntities: result.relatedEntities || [],
                };
            } catch (error) {
                console.error("Error querying knowledge:", error);
                return { error: "Failed to query knowledge" };
            }
        }

        case "searchWebMemories": {
            return await handleSearchWebMemories(message);
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
                    },
                );
                return { success };
            }
            return { success: false, error: "No active tab found" };
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
                const result = await sendActionToAgent({
                    actionName: "checkPageIndexStatus",
                    parameters: {
                        url: message.url,
                    },
                });

                return {
                    isIndexed: result.isIndexed || false,
                    lastIndexed: result.lastIndexed || null,
                    entityCount: result.entityCount || 0,
                };
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

        case "checkConnection": {
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

        // Website Library Panel message handlers
        case "importWebsiteDataWithProgress": {
            return await handleImportWebsiteDataWithProgress(message);
        }

        case "getWebsiteLibraryStats": {
            return await handleGetWebsiteLibraryStats();
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

        // Enhanced search message handlers (searchWebsitesEnhanced removed - was broken)

        case "getSearchSuggestions": {
            return await handleGetSearchSuggestions(message);
        }

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

        case "createKnowledgeIndex": {
            return await handleCreateKnowledgeIndex(message);
        }

        case "refreshKnowledgeIndex": {
            return await handleRefreshKnowledgeIndex(message);
        }

        case "deleteKnowledgeIndex": {
            return await handleDeleteKnowledgeIndex();
        }

        case "deleteAction": {
            // Handler for deleting actions from the ActionsStore
            try {
                const result = await sendActionToAgent({
                    actionName: "deleteAction",
                    parameters: {
                        actionId: message.actionId,
                    },
                });
                return result;
            } catch (error) {
                console.error("Failed to delete action:", error);
                return {
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                };
            }
        }
        case "getAllActions": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getActionsForUrl",
                    parameters: {
                        url: null,
                        includeGlobal: true,
                    },
                });

                return { actions: result.actions || [] };
            } catch (error) {
                console.error("Error getting all actions:", error);
                return { actions: [] };
            }
        }
        case "getActionDomains": {
            try {
                const result = await sendActionToAgent({
                    actionName: "getActionDomains",
                    parameters: {},
                });

                return { domains: result.domains || [] };
            } catch (error) {
                console.error("Error getting action domains:", error);
                return { domains: [] };
            }
        }
        case "deleteAction": {
            try {
                const result = await sendActionToAgent({
                    actionName: "deleteAction",
                    parameters: {
                        actionId: message.actionId,
                    },
                });

                return { success: result.success, error: result.error };
            } catch (error) {
                console.error("Error deleting action:", error);
                return {
                    success: false,
                    error:
                        error instanceof Error ? error.message : String(error),
                };
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

async function handleGetWebsiteLibraryStats() {
    try {
        const result = await sendActionToAgent({
            actionName: "getWebsiteStats",
            parameters: {
                groupBy: "source",
                limit: 50,
            },
        });

        if (result.error) {
            return {
                success: false,
                error: result.error,
            };
        }

        // Parse the stats from the result text
        const stats = parseWebsiteStatsFromText(
            result.literalText || result.text || result.result || "",
        );

        return {
            totalWebsites: stats.totalWebsites,
            totalBookmarks: stats.totalBookmarks,
            totalHistory: stats.totalHistory,
            topDomains: stats.topDomains,
        };
    } catch (error) {
        console.error("Error getting website library stats:", error);
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

        const query = message.parameters.query.toLowerCase();
        const suggestions = searchHistory
            .filter((search: string) => search.toLowerCase().includes(query))
            .slice(0, message.parameters.limit || 5);

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
function parseWebsiteStatsFromText(text: string) {
    const defaultStats = {
        totalWebsites: 0,
        totalBookmarks: 0,
        totalHistory: 0,
        topDomains: 0,
    };

    if (!text) return defaultStats;

    try {
        // Parse the text response to extract statistics
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

        // Count domain entries (rough approximation)
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
        console.error("Error parsing website stats:", error);
        return defaultStats;
    }
}

// Helper functions for knowledge indexing
async function indexPageContent(
    tab: chrome.tabs.Tab,
    showNotification: boolean = true,
    options: {
        quality?: "fast" | "balanced" | "deep";
        textOnly?: boolean;
        mode?: "basic" | "content" | "actions" | "full";
    } = {},
): Promise<boolean> {
    try {
        const htmlFragments = await getTabHTMLFragments(
            tab,
            false,
            false,
            true, // extract text
            false, // useTimestampIds
        );

        await sendActionToAgent({
            actionName: "indexWebPageContent",
            parameters: {
                url: tab.url,
                title: tab.title,
                htmlFragments: htmlFragments,
                extractKnowledge: true,
                timestamp: new Date().toISOString(),
                quality: options.quality || "balanced",
                textOnly: options.textOnly || false,
                mode: options.mode || "content",
            },
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

async function handleCreateKnowledgeIndex(message: any) {
    try {
        const result = await sendActionToAgent({
            actionName: "indexWebsiteContent",
            parameters: {
                rebuildIndex: true,
                showProgress: message.parameters?.showProgress || false,
            },
        });

        return {
            success: !result.error,
            message: result.error
                ? result.error
                : "Knowledge index created successfully",
            itemsIndexed: result.itemsIndexed || 0,
        };
    } catch (error) {
        console.error("Error creating knowledge index:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

async function handleRefreshKnowledgeIndex(message: any) {
    try {
        // This would refresh/rebuild the existing index
        const result = await sendActionToAgent({
            actionName: "refreshWebsiteIndex",
            parameters: {
                fullRebuild: true,
                showProgress: message.parameters?.showProgress || false,
            },
        });

        return {
            success: !result.error,
            message: result.error
                ? result.error
                : "Knowledge index refreshed successfully",
            itemsReindexed: result.itemsReindexed || 0,
        };
    } catch (error) {
        console.error("Error refreshing knowledge index:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

async function handleDeleteKnowledgeIndex() {
    try {
        // This would delete the knowledge index but preserve the raw data
        const result = await sendActionToAgent({
            actionName: "deleteWebsiteIndex",
            parameters: {},
        });

        return {
            success: !result.error,
            message: result.error
                ? result.error
                : "Knowledge index deleted successfully",
        };
    } catch (error) {
        console.error("Error deleting knowledge index:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// Search helper functions
async function generateSearchSummary(
    websites: any[],
    query: string,
): Promise<string> {
    try {
        // Use the first few websites to generate a summary
        const topSites = websites.slice(0, 5);
        const domains = [...new Set(topSites.map((site) => site.domain))];
        const sources =
            topSites.filter((site) => site.source === "bookmarks").length > 0
                ? topSites.filter((site) => site.source === "history").length >
                  0
                    ? "bookmarks and browsing history"
                    : "bookmarks"
                : "browsing history";

        return `Found ${websites.length} results for "${query}" across ${domains.length} domains from your ${sources}. Top domains include: ${domains.slice(0, 3).join(", ")}.`;
    } catch (error) {
        console.error("Error generating search summary:", error);
        return `Found ${websites.length} results for "${query}".`;
    }
}

function extractSources(websites: any[]): any[] {
    return websites.slice(0, 10).map((site) => ({
        url: site.url,
        title: site.title || site.url,
        relevance: site.relevanceScore || 0.5,
    }));
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
