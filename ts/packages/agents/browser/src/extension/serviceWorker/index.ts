// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { initializeContextMenu, handleContextMenuClick } from "./contextMenu";
import {
    ensureWebsocketConnected,
    getWebSocket,
    reconnectWebSocket,
    sendActionToAgent,
} from "./websocket";
import { toggleSiteTranslator } from "./siteTranslator";
import { showBadgeError, showBadgeHealthy } from "./ui";
import { getActiveTab } from "./tabManager";
import { screenshotCoordinator } from "./screenshotCoordinator";
import { createChromeRpcServer } from "./chromeRpcServer";
import { createAllHandlers } from "./serviceWorkerRpcHandlers";
import { setChatPanelRpc } from "./dispatcherConnection";
import { setContextMenuRpcSend } from "./contextMenu";

import {
    isWebAgentMessage,
    isWebAgentMessageFromDispatcher,
    WebAgentDisconnectMessage,
} from "./types";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:serviceWorker");
const debugError = registerDebug("typeagent:browser:serviceWorker:error");

const debugWebAgentProxy = registerDebug("typeagent:webAgent:proxy");

let serviceWorkerHandlers: ReturnType<typeof createAllHandlers> | undefined;

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

    // Set up RPC server for typed view communication
    const allHandlers = createAllHandlers();
    const { rpc } = createChromeRpcServer(allHandlers);
    setChatPanelRpc(rpc as any);
    setContextMenuRpcSend((rpc as any).send.bind(rpc));
    serviceWorkerHandlers = allHandlers;

    // Set up event listeners
    setupEventListeners();
}

/**
 * Sets up all event listeners
 */
function setupEventListeners(): void {
    // Handle simple content script and view messages (not RPC)
    chrome.runtime.onMessage.addListener(
        (message: any, sender: chrome.runtime.MessageSender, sendResponse) => {
            if (message.type === "getTabId") {
                sendResponse({
                    tabId: sender.tab?.id ? String(sender.tab.id) : null,
                });
                return false;
            }

            // Macro library messages — route to RPC handlers
            if (
                message.type === "getAllWebFlows" ||
                message.type === "deleteWebFlow"
            ) {
                if (serviceWorkerHandlers) {
                    const handlers = serviceWorkerHandlers;
                    const handler = (handlers as any)[message.type];
                    if (handler) {
                        handler(message)
                            .then((result: any) => sendResponse(result))
                            .catch((err: any) =>
                                sendResponse({
                                    success: false,
                                    error:
                                        err instanceof Error
                                            ? err.message
                                            : String(err),
                                }),
                            );
                        return true; // async sendResponse
                    }
                }
                sendResponse({
                    success: false,
                    error: "Handler not available",
                });
                return false;
            }
        },
    );

    // Browser action click
    chrome.action?.onClicked.addListener(async (tab: any) => {
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
    chrome.tabs.onActivated.addListener(async (activeInfo: any) => {
        const targetTab = await chrome.tabs.get(activeInfo.tabId);
        await toggleSiteTranslator(targetTab);
    });

    // Tab updates
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        if (changeInfo.status === "complete" && tab.active) {
            await toggleSiteTranslator(tab);

            // Knowledge extraction on navigation is disabled for now
            // to simplify debugging of the chat panel feature.
            // if (tab.url && tab.title) {
            //     try {
            //         await sendNavigationMessage(tab.url, tab.title, tab.id);
            //     } catch (error) {
            //         console.error("Error sending navigation message:", error);
            //     }
            // }
        }
        if (changeInfo.title) {
            const addTabAction = {
                actionName: "addTabIdToIndex",
                parameters: {
                    id: tab.id,
                    title: tab.title,
                },
            };
            await sendActionToAgent(addTabAction).catch(() => {});
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
        await sendActionToAgent(addTabAction).catch(() => {});
    });

    // Tab removal
    chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
        const removeTabAction = {
            actionName: "deleteTabIdFromIndex",
            parameters: {
                id: tabId,
            },
        };
        await sendActionToAgent(removeTabAction).catch(() => {});
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
                    await sendActionToAgent(addTabAction).catch(() => {});
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

    // Command shortcuts
    chrome.commands?.onCommand.addListener(async (command) => {
        if (command === "open_action_index") {
            // Open action index panel
            try {
                const tabs = await chrome.tabs.query({
                    active: true,
                    currentWindow: true,
                });
                if (tabs.length > 0) {
                    await chrome.sidePanel.open({ windowId: tabs[0].windowId });
                    // The action index will be opened via URL navigation in the sidepanel
                }
            } catch (error) {
                console.error("Error opening action index:", error);
            }
        }
    });

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
            const message = event.data;
            const data = JSON.parse(message);
            if (isWebAgentMessageFromDispatcher(data)) {
                debugWebAgentProxy(`Dispatcher -> WebAgent (${url})`, data);
                port.postMessage(data);
            }
        };
        webSocket.addEventListener("message", handler);

        const agentNames = new Set<string>();
        const tabId = tab.id;
        const frameId = port.sender?.frameId;
        port.onMessage.addListener((data) => {
            if (isWebAgentMessage(data)) {
                debugWebAgentProxy(
                    `WebAgent -> Dispatcher (${url}, tabId=${tabId}, frameId=${frameId})`,
                    data,
                );
                // relay message from the browser agent message sent via content script to the browser agent via the websocket.
                if (data.method === "webAgent/register") {
                    type WebAgentRegisterParam = {
                        name: string;
                        title?: string;
                        url?: string;
                        tabId?: number;
                        frameId?: number;
                    };
                    const param = (
                        data.params as { args: [WebAgentRegisterParam] }
                    ).args[0];
                    agentNames.add(param.name);
                    // Fill in identification information
                    param.title = title;
                    param.url = url;
                    param.tabId = tabId;
                    param.frameId = frameId;
                }
                webSocket.send(JSON.stringify(data));
            }
        });

        port.onDisconnect.addListener(() => {
            debugWebAgentProxy(`Web page disconnected: ${url}`);
            const disconnectMessage: WebAgentDisconnectMessage = {
                source: "webAgent",
                method: "webAgent/disconnect",
                params: Array.from(agentNames),
            };

            webSocket.send(JSON.stringify(disconnectMessage));
            agentNames.clear();
            webSocket.removeEventListener("message", handler);
        });
    });
}

// Start initialization
initialize();

// Expose screenshotCoordinator globally for testing/debugging
(globalThis as any).screenshotCoordinator = screenshotCoordinator;

// Track recent navigation events for debouncing
const recentNavigations = new Map<string, number>();

// Re-export functions that need to be accessible from other modules
async function sendNavigationMessage(
    url: string,
    title: string,
    tabId?: number,
): Promise<void> {
    try {
        // Debounce rapid navigation events
        const navigationKey = `${tabId}-${url}`;
        if (recentNavigations.has(navigationKey)) {
            const lastNav = recentNavigations.get(navigationKey);
            if (lastNav && Date.now() - lastNav < 2000) {
                console.log(`Debouncing navigation to ${url}`);
                return;
            }
        }
        recentNavigations.set(navigationKey, Date.now());

        // Clean up old entries periodically
        if (recentNavigations.size > 100) {
            const cutoff = Date.now() - 60000;
            for (const [key, time] of recentNavigations.entries()) {
                if (time < cutoff) {
                    recentNavigations.delete(key);
                }
            }
        }

        await sendActionToAgent({
            actionName: "handlePageNavigation",
            parameters: { url, title, tabId },
        });
    } catch (error) {
        console.error("Error sending navigation message:", error);
    }
}

export { sendNavigationMessage };
