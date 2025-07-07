// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getActiveTab } from "./tabManager";
import { getTabHTMLFragments, getTabAnnotatedScreenshot } from "./capture";
import {
    getRecordedActions,
    clearRecordedActions,
    saveRecordedActions,
} from "./storage";
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
            const schemaResult = await sendActionToAgent({
                actionName: "detectPageActions",
                parameters: {
                    registerAgent: false,
                },
            });

            return {
                schema: schemaResult.schema,
                actionDefinitions: schemaResult.typeDefinitions,
            };
        }
        case "registerTempSchema": {
            const schemaResult = await sendActionToAgent({
                actionName: "registerPageDynamicAgent",
                parameters: {
                    agentName: message.agentName,
                },
            });

            return { schema: schemaResult };
        }
        case "getIntentFromRecording": {
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
            };
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
        case "clearRecordedActions": {
            try {
                await clearRecordedActions();
            } catch (error) {
                console.error("Error clearing storage data:", error);
            }
            return {};
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
                            quality: message.quality || "balanced",
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
                        query: message.query,
                        url: message.url,
                        searchScope: message.searchScope || "current_page",
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

        case "indexPageContentDirect": {
            const targetTab = await getActiveTab();
            if (targetTab) {
                const success = await indexPageContent(
                    targetTab,
                    message.showNotification !== false,
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

        case "openPanelWithGesture": {
            const tabId = message.tabId;
            const panel = message.panel;

            try {
                if (panel === "schema") {
                    await chrome.sidePanel.setOptions({
                        tabId: tabId,
                        path: "sidepanel.html",
                        enabled: true,
                    });
                    await chrome.sidePanel.open({ tabId });
                } else if (panel === "knowledge") {
                    await chrome.sidePanel.setOptions({
                        tabId: tabId,
                        path: "knowledgePanel.html",
                        enabled: true,
                    });
                    await chrome.sidePanel.open({ tabId });

                    // If there's a specific action, trigger it
                    if (message.action === "extractKnowledge") {
                        setTimeout(() => {
                            chrome.tabs.sendMessage(
                                tabId,
                                {
                                    type: "triggerKnowledgeExtraction",
                                },
                                { frameId: 0 },
                            );
                        }, 500);
                    }
                }

                return { success: true };
            } catch (error) {
                console.error("Error opening panel with gesture:", error);
                return { success: false, error: String(error) };
            }
        }

        case "autoIndexSettingChanged": {
            console.log("Auto-indexing setting changed:", message.enabled);
            return { success: true };
        }

        default:
            return null;
    }
}

// Helper functions for knowledge indexing
async function indexPageContent(
    tab: chrome.tabs.Tab,
    showNotification: boolean = true,
    options: {
        quality?: "fast" | "balanced" | "deep";
        textOnly?: boolean;
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
