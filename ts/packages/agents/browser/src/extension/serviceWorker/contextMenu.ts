// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { sendActionToAgent } from "./websocket";
import { getWebSocket } from "./websocket";

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
        title: "Extract knowledge from page",
        id: "extractKnowledgeFromPage",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        title: "View Web Activity",
        id: "showWebsiteLibrary",
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
            await chrome.sidePanel.open({ tabId: tab.id! });

            await chrome.sidePanel.setOptions({
                tabId: tab.id!,
                path: "sidepanel.html",
                enabled: true,
            });
            break;
        }
        case "sidepanel-registerAgent": {
            const schemaResult = await sendActionToAgent({
                actionName: "registerPageDynamicAgent",
                parameters: {},
            });
            break;
        }

        case "extractKnowledgeFromPage": {
            await chrome.sidePanel.open({ tabId: tab.id! });

            await chrome.sidePanel.setOptions({
                tabId: tab.id!,
                path: "knowledgePanel.html",
                enabled: true,
            });

            break;
        }

        case "showWebsiteLibrary": {
            await chrome.sidePanel.open({ tabId: tab.id! });

            await chrome.sidePanel.setOptions({
                tabId: tab.id!,
                path: "websiteLibraryPanel.html",
                enabled: true,
            });

            break;
        }
    }
}
