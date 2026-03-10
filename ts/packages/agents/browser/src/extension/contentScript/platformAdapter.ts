// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

declare global {
    interface Window {
        electronAPI?: {
            getTabId?: () => string | null;
        };
        _tabId?: string;
    }
}

let cachedTabId: string | null = null;
let tabIdPromise: Promise<string | null> | null = null;

// Listen for tabId message from content script (for MAIN world)
if (typeof window !== "undefined") {
    window.addEventListener("message", (event) => {
        if (
            event.source === window &&
            event.data?.type === "typeagent-tabId" &&
            event.data?.tabId
        ) {
            cachedTabId = event.data.tabId;
            window._tabId = event.data.tabId;
        }
    });
}

export const platformAdapter = {
    isElectron(): boolean {
        return !!(
            (typeof window !== "undefined" && window.electronAPI?.getTabId) ||
            (typeof window !== "undefined" && window._tabId)
        );
    },

    async getTabId(): Promise<string | null> {
        // Return cached value if available
        if (cachedTabId) {
            return cachedTabId;
        }

        // Electron path - check for electronAPI or _tabId
        if (typeof window !== "undefined") {
            if (window.electronAPI?.getTabId) {
                cachedTabId = window.electronAPI.getTabId();
                return cachedTabId;
            }
            if (window._tabId) {
                cachedTabId = window._tabId;
                return cachedTabId;
            }
        }

        // Chrome extension MAIN world path - wait for tabId from content script
        // The content script injects window._tabId, but it may not be ready yet
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
            // In MAIN world without chrome APIs, wait for the message
            if (!tabIdPromise) {
                tabIdPromise = new Promise((resolve) => {
                    // Check again if _tabId was set while we were setting up
                    if (window._tabId) {
                        cachedTabId = window._tabId;
                        resolve(cachedTabId);
                        return;
                    }

                    const handler = (event: MessageEvent) => {
                        if (
                            event.source === window &&
                            event.data?.type === "typeagent-tabId" &&
                            event.data?.tabId
                        ) {
                            cachedTabId = event.data.tabId;
                            window._tabId = event.data.tabId;
                            window.removeEventListener("message", handler);
                            resolve(cachedTabId);
                        }
                    };
                    window.addEventListener("message", handler);

                    // Timeout after 5 seconds
                    setTimeout(() => {
                        window.removeEventListener("message", handler);
                        if (!cachedTabId && window._tabId) {
                            cachedTabId = window._tabId;
                        }
                        resolve(cachedTabId);
                    }, 5000);
                });
            }
            return tabIdPromise;
        }

        // Chrome extension content script path - use chrome APIs
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getTabId",
            });
            cachedTabId = response?.tabId ?? null;
            return cachedTabId;
        } catch (e) {
            console.error("[platformAdapter] Failed to get tabId:", e);
            return null;
        }
    },
};
