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
        title: "Manage Actions",
        id: "manageActions",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        id: "sidepanel-registerAgent",
        title: "Update Page Agent",
        contexts: ["all"],
        documentUrlPatterns: ["chrome-extension://*/views/pageActions.html"],
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
                path: "views/pageActions.html",
                enabled: true,
            });
            break;
        }
        case "manageActions": {
            // Check if actionsLibrary tab already exists
            const existingTabs = await chrome.tabs.query({
                url: chrome.runtime.getURL("views/actionsLibrary.html"),
            });

            if (existingTabs.length > 0) {
                // Switch to existing tab
                await chrome.tabs.update(existingTabs[0].id!, { active: true });
                await chrome.windows.update(existingTabs[0].windowId!, {
                    focused: true,
                });
            } else {
                // Create new tab
                await chrome.tabs.create({
                    url: chrome.runtime.getURL("views/actionsLibrary.html"),
                    active: true,
                });
            }
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
                path: "views/pageKnowledge.html",
                enabled: true,
            });

            break;
        }

        case "showWebsiteLibrary": {
            const knowledgeLibraryUrl = chrome.runtime.getURL(
                "views/knowledgeLibrary.html",
            );

            // Check if knowledge library tab is already open
            const existingTabs = await chrome.tabs.query({
                url: knowledgeLibraryUrl,
            });

            if (existingTabs.length > 0) {
                // Switch to existing tab
                await chrome.tabs.update(existingTabs[0].id!, { active: true });
                // Focus the window containing the tab
                if (existingTabs[0].windowId) {
                    await chrome.windows.update(existingTabs[0].windowId, {
                        focused: true,
                    });
                }
            } else {
                // Create new tab
                await chrome.tabs.create({
                    url: knowledgeLibraryUrl,
                    active: true,
                });
            }

            break;
        }
    }
}
