// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction } from "./types";

/**
 * Gets the currently active tab
 * @returns Promise resolving to the active tab or undefined
 */
export function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    return new Promise((resolve) => {
        chrome.windows.getAll({ populate: true }, (windows) => {
            // Filter out DevTools windows. These will sometimes interfere with automation operations
            const contentWindows = windows.filter((window) => {
                if (window.type === "devtools" || window.type === "panel") {
                    return false;
                }

                // DevTools can also be of type 'normal' but with specific properties
                if (window.type === "normal") {
                    if (window.tabs && window.tabs.length > 0) {
                        const firstTabUrl = window.tabs[0].url;
                        if (
                            firstTabUrl &&
                            (firstTabUrl.startsWith("chrome-devtools://") ||
                                (firstTabUrl.startsWith("chrome://") &&
                                    firstTabUrl.includes("devtools")))
                        ) {
                            return false;
                        }
                    }
                }

                return true;
            });

            if (contentWindows.length === 0) {
                resolve(undefined);
                return;
            }

            const focusedWindow = contentWindows.find(
                (window) => window.focused,
            );
            if (focusedWindow && focusedWindow.tabs) {
                const activeTab = focusedWindow.tabs.find((tab) => tab.active);
                if (activeTab) {
                    resolve(activeTab);
                    return;
                }
            }

            // If we couldn't find a focused window or an active tab in it,
            // fall back to the first active tab in any content window
            for (const window of contentWindows) {
                if (window.tabs) {
                    const activeTab = window.tabs.find((tab) => tab.active);
                    if (activeTab) {
                        resolve(activeTab);
                        return;
                    }
                }
            }

            resolve(undefined);
        });
    });
}

/**
 * Gets a tab by its title
 * @param title The title to search for
 * @returns Promise resolving to the tab or undefined
 */
export async function getTabByTitle(title: string): Promise<chrome.tabs.Tab | undefined> {
    if (!title) {
        return undefined;
    }

    const getTabAction = {
        actionName: "getTabIdFromIndex",
        parameters: {
            query: title,
        },
    };
    
    const matchedId = await sendActionToTabIndex(getTabAction);
    if (matchedId) {
        const tabId = parseInt(matchedId);
        const targetTab = await chrome.tabs.get(tabId);
        return targetTab;
    } else {
        const tabs = await chrome.tabs.query({
            title: title,
        });

        if (tabs && tabs.length > 0) {
            return tabs[0];
        }
    }
    return undefined;
}

/**
 * Waits for a page to finish loading
 * @param targetTab The tab to wait for
 * @returns Promise resolving when the page is loaded
 */
export async function awaitPageLoad(targetTab: chrome.tabs.Tab): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve, reject) => {
        if (targetTab.status == "complete") {
            resolve("OK");
        }

        const handler = (
            tabId: number,
            changeInfo: chrome.tabs.TabChangeInfo,
            tab: chrome.tabs.Tab,
        ) => {
            if (tabId == targetTab.id && tab.status == "complete") {
                chrome.tabs.onUpdated.removeListener(handler);
                resolve("OK");
            }
        };

        chrome.tabs.onUpdated.addListener(handler);
    });
}

/**
 * Waits for incremental updates to a page
 * @param targetTab The tab to wait for
 * @returns Promise resolving when incremental updates are finished
 */
export async function awaitPageIncrementalUpdates(targetTab: chrome.tabs.Tab): Promise<void> {
    const loadingCompleted = await chrome.tabs.sendMessage(
        targetTab.id!,
        {
            type: "await_page_incremental_load",
        },
        { frameId: 0 },
    );

    if (!loadingCompleted) {
        console.error("Incremental loading did not complete for this page.");
    }
}

/**
 * Sends an action to the tab index
 * @param action The action to send
 * @returns Promise resolving to the result or undefined
 */
export async function sendActionToTabIndex(action: any): Promise<string | undefined> {
    // This function depends on the websocket module, which would be imported
    // The implementation would be updated to use the imported function
    return Promise.resolve(undefined);
}

/**
 * Downloads a string as a file
 * @param targetTab The tab to download in
 * @param data The string data
 * @param filename The filename
 */
export async function downloadStringAsFile(
    targetTab: chrome.tabs.Tab,
    data: string,
    filename: string
): Promise<void> {
    const download = (data: string, filename: string) => {
        const link = document.createElement("a");
        link.href = "data:text/plain;charset=utf-8," + encodeURIComponent(data);
        link.download = filename;
        link.click();
    };

    await chrome.scripting.executeScript({
        func: download,
        target: { tabId: targetTab.id! },
        args: [data, filename],
    });
}

/**
 * Downloads an image as a file
 * @param targetTab The tab to download in
 * @param dataUrl The image data URL
 * @param filename The filename
 */
export async function downloadImageAsFile(
    targetTab: chrome.tabs.Tab,
    dataUrl: string,
    filename: string
): Promise<void> {
    const download = (dataUrl: string, filename: string) => {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = filename;
        link.click();
    };

    await chrome.scripting.executeScript({
        func: download,
        target: { tabId: targetTab.id! },
        args: [dataUrl, filename],
    });
}
