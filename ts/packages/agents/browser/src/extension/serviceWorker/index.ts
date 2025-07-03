// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { initializeContextMenu, handleContextMenuClick } from "./contextMenu";
import {
    ensureWebsocketConnected,
    getWebSocket,
    reconnectWebSocket,
} from "./websocket";
import { toggleSiteTranslator } from "./siteTranslator";
import { showBadgeError, showBadgeHealthy } from "./ui";
import { getActiveTab } from "./tabManager";
import { handleMessage } from "./messageHandlers";

import {
    isWebAgentMessage,
    isWebAgentMessageFromDispatcher,
    WebAgentDisconnectMessage,
} from "./types";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:serviceWorker");
const debugError = registerDebug("typeagent:browser:serviceWorker:error");

const debugWebAgentProxy = registerDebug("typeagent:webAgent:proxy");

/**
 * Initializes the service worker
 */
export async function initialize(): Promise<void> {
    debug("Browser Agent Service Worker initializing");

    try {
        const connected = await ensureWebsocketConnected();
        if (!connected) {
            reconnectWebSocket();
            showBadgeError();
        }
    } catch (error) {
        debugError("Error during initialization:", error);
        reconnectWebSocket();
        showBadgeError();
    }

    // Initialize context menu
    initializeContextMenu();

    // Set up event listeners
    setupEventListeners();
}

/**
 * Sets up all event listeners
 */
function setupEventListeners(): void {
    // Browser action click
    chrome.action?.onClicked.addListener(async (tab) => {
        try {
            const connected = await ensureWebsocketConnected();
            if (!connected) {
                reconnectWebSocket();
                showBadgeError();
            } else {
                await toggleSiteTranslator(tab);
                showBadgeHealthy();
            }
        } catch (error) {
            console.error("Error on browser action click:", error);
            reconnectWebSocket();
            showBadgeError();
        }
    });

    // Tab activation
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
        const targetTab = await chrome.tabs.get(activeInfo.tabId);
        await toggleSiteTranslator(targetTab);
    });

    // Tab updates
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        if (changeInfo.status === "complete" && tab.active) {
            await toggleSiteTranslator(tab);
        }
        if (changeInfo.title) {
            const addTabAction = {
                actionName: "addTabIdToIndex",
                parameters: {
                    id: tab.id,
                    title: tab.title,
                },
            };
            await sendActionToTabIndex(addTabAction);
        }
    });

    // Tab creation
    chrome.tabs.onCreated.addListener(async (tab) => {
        if (!tab.title) {
            return;
        }

        const addTabAction = {
            actionName: "addTabIdToIndex",
            parameters: {
                id: tab.id,
                title: tab.title,
            },
        };
        await sendActionToTabIndex(addTabAction);
    });

    // Tab removal
    chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
        const removeTabAction = {
            actionName: "deleteTabIdFromIndex",
            parameters: {
                id: tabId,
            },
        };
        await sendActionToTabIndex(removeTabAction);
    });

    let embeddingsInitializedWindowId: number;

    // Window focus change
    chrome.windows?.onFocusChanged.addListener(async (windowId) => {
        if (windowId == chrome.windows.WINDOW_ID_NONE) {
            return;
        }

        const connected = await ensureWebsocketConnected();
        if (!connected) {
            reconnectWebSocket();
            showBadgeError();
        }

        const targetTab = await getActiveTab();
        if (targetTab) {
            await toggleSiteTranslator(targetTab);
        }

        if (embeddingsInitializedWindowId !== windowId) {
            const tabs = await chrome.tabs.query({
                windowId: windowId,
            });
            tabs.forEach(async (tab) => {
                if (tab.title) {
                    const addTabAction = {
                        actionName: "addTabIdToIndex",
                        parameters: {
                            id: tab.id,
                            title: tab.title,
                        },
                    };
                    await sendActionToTabIndex(addTabAction);
                }
            });

            embeddingsInitializedWindowId = windowId;
        }
    });

    // Window creation
    chrome.windows?.onCreated.addListener(() => {
        console.log("Window Created");
    });

    // Window removal
    chrome.windows?.onRemoved.addListener(() => {
        console.log("Window Removed");
    });

    // Browser startup
    chrome.runtime.onStartup.addListener(async () => {
        console.log("Browser Agent Service Worker started");
        try {
            const connected = await ensureWebsocketConnected();
            if (!connected) {
                reconnectWebSocket();
                showBadgeError();
            }
        } catch (error) {
            console.error("Error on browser startup:", error);
            reconnectWebSocket();
        }
    });

    // Message handling
    chrome.runtime.onMessage.addListener(
        (message: any, sender: chrome.runtime.MessageSender, sendResponse) => {
            const handleAction = async () => {
                const result = await handleMessage(message, sender);
                sendResponse(result);
            };

            handleAction();
            return true; // Important: indicates we'll send response asynchronously
        },
    );

    // Context menu clicks
    chrome.contextMenus?.onClicked.addListener(handleContextMenuClick);

    // Storage changes
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === "sync" && changes.websocketHost) {
            console.log(
                "WebSocket host changed:",
                changes.websocketHost.newValue,
            );

            const webSocket = getWebSocket();
            if (webSocket) {
                // close the socket to force reconnect
                try {
                    webSocket.close();
                } catch (error) {
                    console.error(
                        "Error closing WebSocket on host change:",
                        error,
                    );
                }
            }
        }
    });

    // Port connections
    chrome.runtime.onConnect.addListener(async (port) => {
        if (port.name !== "typeagent") {
            // This shouldn't happen.
            return;
        }

        const tab = port.sender?.tab;
        if (tab === undefined) {
            // This shouldn't happen.
            return;
        }

        const { title, url } = tab;
        if (title === undefined || url === undefined) {
            // This shouldn't happen.
            return;
        }

        const webSocket = getWebSocket();
        if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
            port.disconnect();
            return;
        }

        debugWebAgentProxy("Web page connected:", url);
        const handler = async (event: MessageEvent) => {
            const message = await (event.data as Blob).text();
            const data = JSON.parse(message);
            if (isWebAgentMessageFromDispatcher(data)) {
                debugWebAgentProxy(`Dispatcher -> WebAgent (${url})`, data);
                port.postMessage(data);
            }
        };
        webSocket.addEventListener("message", handler);

        const agentNames: string[] = [];
        port.onMessage.addListener((data) => {
            if (isWebAgentMessage(data)) {
                debugWebAgentProxy(`WebAgent -> Dispatcher (${url})`, data);
                // relay message from the browser agent message sent via content script to the browser agent via the websocket.
                if (data.method === "webAgent/register") {
                    agentNames.push(data.params.param.name);
                    // Fill in identification information
                    data.params.param.title = title;
                    data.params.param.url = url;
                }

                webSocket.send(JSON.stringify(data));
            }
        });

        port.onDisconnect.addListener(() => {
            debugWebAgentProxy(`Web page disconnected: ${url}`);
            for (const name of agentNames) {
                const message: WebAgentDisconnectMessage = {
                    source: "webAgent",
                    method: "webAgent/disconnect",
                    params: name,
                };
                webSocket.send(JSON.stringify(message));
            }
            webSocket.removeEventListener("message", handler);
        });
    });
}

/**
 * Sends an action to the tab index
 * This is a temporary function that will be replaced when the circular dependency is resolved
 */
async function sendActionToTabIndex(action: any): Promise<string | undefined> {
    const webSocket = getWebSocket();
    if (!webSocket) {
        return undefined;
    }

    return new Promise<string | undefined>((resolve, reject) => {
        try {
            const callId = new Date().getTime().toString();

            webSocket.send(
                JSON.stringify({
                    method: action.actionName,
                    id: callId,
                    params: action.parameters,
                }),
            );

            const handler = async (event: MessageEvent) => {
                let text: string;
                if (typeof event.data === "string") {
                    text = event.data;
                } else if (event.data instanceof Blob) {
                    text = await event.data.text();
                } else if (event.data instanceof ArrayBuffer) {
                    text = new TextDecoder().decode(event.data);
                } else {
                    console.warn("Unknown message type:", typeof event.data);
                    return;
                }

                const data = JSON.parse(text);
                if (data.id == callId && data.result) {
                    webSocket.removeEventListener("message", handler);
                    resolve(data.result);
                }
            };

            webSocket.addEventListener("message", handler);
        } catch (error) {
            console.error("Unable to contact dispatcher backend:", error);
            reject("Unable to contact dispatcher backend.");
        }
    });
}

// Start initialization
initialize();

// Re-export functions that need to be accessible from other modules
export { sendActionToTabIndex };
