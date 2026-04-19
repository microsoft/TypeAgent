// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { sendActionToAgent } from "./websocket";

// RPC send function — set after RPC server is created in index.ts
let rpcSendFn: ((name: string, ...args: any[]) => void) | undefined;

export function setContextMenuRpcSend(
    fn: (name: string, ...args: any[]) => void,
) {
    rpcSendFn = fn;
}

async function openChatAndInjectCommand(
    tabId: number,
    command: string,
): Promise<void> {
    await chrome.sidePanel.open({ tabId });
    await chrome.sidePanel.setOptions({
        tabId,
        path: "views/chatPanel.html",
        enabled: true,
    });
    // Small delay to let the chat panel initialize before injecting
    setTimeout(() => {
        rpcSendFn?.("injectCommand", { command });
    }, 500);
}

async function openChatAndStartMacroAuthoring(tabId: number): Promise<void> {
    await chrome.sidePanel.open({ tabId });
    await chrome.sidePanel.setOptions({
        tabId,
        path: "views/chatPanel.html",
        enabled: true,
    });
    // Small delay to let the chat panel initialize before starting authoring
    setTimeout(() => {
        rpcSendFn?.("startMacroAuthoring", {});
    }, 500);
}

/**
 * Initializes the context menu items
 */
export function initializeContextMenu(): void {
    chrome.contextMenus.create({
        title: "Open TypeAgent Chat",
        id: "openChatPanel",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        type: "separator",
        id: "menuSeparator1",
    });

    chrome.contextMenus.create({
        title: "Ask about this page",
        id: "askAboutPage",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        type: "separator",
        id: "menuSeparator2",
    });

    chrome.contextMenus.create({
        title: "Show actions on this page",
        id: "inferNewActions",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        title: "Add actions to this page",
        id: "addNewMacro",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        title: "Match known actions",
        id: "matchKnownActions",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        type: "separator",
        id: "menuSeparator3",
    });

    chrome.contextMenus.create({
        title: "Action Library",
        id: "manageMacros",
        documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    chrome.contextMenus.create({
        title: "Knowledge Library",
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
        case "matchKnownActions": {
            await openChatAndInjectCommand(tab.id!, "@browser actions match");
            break;
        }
        case "addNewMacro": {
            await openChatAndStartMacroAuthoring(tab.id!);
            break;
        }
        case "inferNewActions": {
            await openChatAndInjectCommand(tab.id!, "@browser actions infer");
            break;
        }
        case "manageMacros": {
            // Check if macrosLibrary tab already exists
            const existingTabs = await chrome.tabs.query({
                url: chrome.runtime.getURL("views/macrosLibrary.html"),
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
                    url: chrome.runtime.getURL("views/macrosLibrary.html"),
                    active: true,
                });
            }
            break;
        }
        case "extractKnowledgeFromPage": {
            await openChatAndInjectCommand(
                tab.id!,
                "@browser extractKnowledge",
            );
            break;
        }

        case "askAboutPage": {
            await openChatAndInjectCommand(
                tab.id!,
                "@browser ask What is this page about?",
            );
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

        case "showAnnotationsLibrary": {
            const annotationsLibraryUrl = chrome.runtime.getURL(
                "views/annotationsLibrary.html",
            );

            // Check if knowledge library tab is already open
            const existingTabs = await chrome.tabs.query({
                url: annotationsLibraryUrl,
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
                    url: annotationsLibraryUrl,
                    active: true,
                });
            }

            break;
        }

        case "openChatPanel": {
            // open() must be the first await to preserve the user gesture context
            await chrome.sidePanel.open({ tabId: tab.id! });
            await chrome.sidePanel.setOptions({
                tabId: tab.id!,
                path: "views/chatPanel.html",
                enabled: true,
            });
            break;
        }
    }
}
