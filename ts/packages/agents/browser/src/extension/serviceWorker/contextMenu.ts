// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { sendActionToAgent } from "./websocket";
import { getWebSocket } from "./websocket";
import { PanelManager } from "./panelManager";

/**
 * Initializes the context menu items
 */
export function initializeContextMenu(): void {
    chrome.contextMenus.create({
        title: "Refresh crossword agent",
        id: "reInitCrosswordPage",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        title: "Clear crossword cache",
        id: "clearCrosswordPageCache",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    // Add separator
    chrome.contextMenus.create({
        type: "separator",
        id: "menuSeparator",
    });

    chrome.contextMenus.create({
        title: "Discover page Schema",
        id: "discoverPageSchema",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        id: "sidepanel-registerAgent",
        title: "Update Page Agent",
        contexts: ["all"],
        documentUrlPatterns: ["chrome-extension://*/sidepanel.html"],
    });

    chrome.contextMenus.create({
        type: "separator",
        id: "menuSeparator2",
    });

    chrome.contextMenus.create({
        id: "extractSchemaCurrentPage",
        title: "Get schema.org metadata from this page",
        contexts: ["page"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        id: "extractSchemaLinkedPages",
        title: "Get schema.org metadata from linked pages",
        contexts: ["page"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    // Add separator for knowledge features
    chrome.contextMenus.create({
        type: "separator",
        id: "menuSeparator3",
    });

    // NEW: Knowledge-related menu items
    chrome.contextMenus.create({
        title: "Extract knowledge from page",
        id: "extractKnowledgeFromPage",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        title: "Open Knowledge Panel",
        id: "openKnowledgePanel",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        title: "Index this page content",
        id: "indexPageContent",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
}

/**
 * Handles context menu clicks
 * @param info The clicked menu item info
 * @param tab The tab where the click occurred
 */
export async function handleContextMenuClick(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab,
): Promise<void> {
    if (tab == undefined) {
        return;
    }

    switch (info.menuItemId) {
        case "reInitCrosswordPage": {
            // insert site-specific script
            await chrome.tabs.sendMessage(tab.id!, {
                type: "setup_UniversalCrossword",
            });

            // trigger translator
            const webSocket = getWebSocket();
            if (webSocket && webSocket.readyState === WebSocket.OPEN) {
                webSocket.send(
                    JSON.stringify({
                        method: "enableSiteTranslator",
                        params: { translator: "browser.crossword" },
                    }),
                );
            }

            break;
        }
        case "clearCrosswordPageCache": {
            // remove cached schema for current tab
            // trigger translator
            const webSocket = getWebSocket();
            if (
                tab.url &&
                webSocket &&
                webSocket.readyState === WebSocket.OPEN
            ) {
                webSocket.send(
                    JSON.stringify({
                        method: "removeCrosswordPageCache",
                        params: { url: tab.url },
                    }),
                );
            }
            break;
        }
        case "discoverPageSchema": {
            await PanelManager.openSchemaPanel(tab.id!);
            break;
        }
        case "sidepanel-registerAgent": {
            const schemaResult = await sendActionToAgent({
                actionName: "registerPageDynamicAgent",
                parameters: {},
            });
            break;
        }
        case "extractSchemaCurrentPage": {
            await chrome.tabs.sendMessage(
                tab.id!,
                {
                    type: "extractSchemaCurrentPage",
                },
                { frameId: 0 },
            );
            break;
        }
        case "extractSchemaLinkedPages": {
            await chrome.tabs.sendMessage(
                tab.id!,
                {
                    type: "extractSchemaLinkedPages",
                },
                { frameId: 0 },
            );
            break;
        }

        // NEW: Knowledge-related cases
        case "extractKnowledgeFromPage": {
            await PanelManager.openKnowledgePanel(tab.id!);
            // Send message to knowledge panel to start extraction
            setTimeout(() => {
                chrome.tabs.sendMessage(tab.id!, {
                    type: "triggerKnowledgeExtraction",
                }, { frameId: 0 });
            }, 500); // Small delay to ensure panel is loaded
            break;
        }

        case "openKnowledgePanel": {
            await PanelManager.openKnowledgePanel(tab.id!);
            break;
        }

        case "indexPageContent": {
            // Index page without opening panel
            await chrome.tabs.sendMessage(tab.id!, {
                type: "indexPageContentDirect",
            });
            
            // Show brief success notification
            chrome.action.setBadgeText({ text: "✓", tabId: tab.id });
            setTimeout(() => {
                chrome.action.setBadgeText({ text: "", tabId: tab.id });
            }, 2000);
            break;
        }
    }
}
