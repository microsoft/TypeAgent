// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chat panel side view for the Chrome extension.
 *
 * Creates a ChatPanel from the shared chat-ui package and connects
 * it to the TypeAgent dispatcher via the service worker using the
 * typed RPC channel.
 */

import { ChatPanel, PlatformAdapter } from "chat-ui";
import type { DisplayAppendMode, DisplayContent } from "@typeagent/agent-sdk";
import { createChromeRpcClient } from "./chromeRpcClient.js";
import type {
    ChatPanelInvokeFunctions,
    ChatPanelCallFunctions,
} from "../../common/serviceTypes.mjs";

// Platform adapter: open links in a real Chrome tab
const platformAdapter: PlatformAdapter = {
    handleLinkClick(href: string, _target: string | null) {
        chrome.tabs.create({ url: href });
    },
};

let chatPanel: ChatPanel;
let connectionBanner: HTMLDivElement;
let requestCounter = 0;
let reconnectTimer: ReturnType<typeof setInterval> | undefined;
let bannerHideTimer: ReturnType<typeof setTimeout> | undefined;

// RPC client for communicating with the service worker
let rpc: ReturnType<typeof createChromeRpcClient>["rpc"];

/**
 * Initialize the chat panel.
 */
function initialize() {
    const root = document.getElementById("chat-root")!;

    // Connection status banner
    connectionBanner = document.createElement("div");
    connectionBanner.className = "connection-banner";
    connectionBanner.textContent = "Connecting to TypeAgent...";
    root.appendChild(connectionBanner);

    // Chat panel container
    const chatContainer = document.createElement("div");
    chatContainer.style.height = "calc(100% - 30px)";
    root.appendChild(chatContainer);

    chatPanel = new ChatPanel(chatContainer, {
        platformAdapter,
        onSend: handleUserMessage,
        getCompletions: async (input: string) => {
            try {
                return await rpc.invoke("chatPanelGetCompletions", {
                    input,
                }) as any;
            } catch {
                return null;
            }
        },
    });

    // Create RPC client with call handlers for inbound dispatcher callbacks
    const client = createChromeRpcClient<
        ChatPanelInvokeFunctions,
        {},
        {},
        ChatPanelCallFunctions
    >(undefined, {
        dispatcherClear(_data) {
            chatPanel.clear();
        },
        dispatcherExit(_data) {
            // No-op in extension
        },
        dispatcherSetDisplayInfo(data) {
            chatPanel.setDisplayInfo(data.source, data.actionIndex);
        },
        dispatcherSetDisplay(data) {
            chatPanel.addAgentMessage(
                data.message.message as DisplayContent,
                data.message.source,
                data.message.sourceIcon,
            );
        },
        dispatcherAppendDisplay(data) {
            chatPanel.addAgentMessage(
                data.message.message as DisplayContent,
                data.message.source,
                data.message.sourceIcon,
                data.mode as DisplayAppendMode,
            );
        },
        dispatcherSetDynamicDisplay(_data) {
            // Not supported in extension chat panel
        },
        dispatcherNotify(data) {
            if (data.event === "explained" && data.data?.error) {
                chatPanel.addAgentMessage(
                    {
                        type: "text",
                        content: data.data.error,
                        kind: "warning",
                    },
                    data.source,
                );
            }
        },
        dispatcherTakeAction(_data) {
            // Not supported in extension chat panel
        },
        dispatcherConnectionStatus(data) {
            setConnectionStatus(data.connected);
        },
    });
    rpc = client.rpc;

    // Request connection to the dispatcher
    attemptConnect();

    chatPanel.focus();
}

/**
 * Handle a message typed by the user.
 */
function handleUserMessage(text: string) {
    chatPanel.setEnabled(false);
    chatPanel.showStatus("Processing...");

    const requestId = `ext-${++requestCounter}`;

    rpc.invoke("chatPanelProcessCommand", {
        command: text,
        clientRequestId: requestId,
    })
        .then((response: any) => {
            if (response?.error) {
                chatPanel.addAgentMessage(
                    {
                        type: "text",
                        content: `Error: ${response.error}`,
                        kind: "error",
                    },
                    "system",
                );
            }
            chatPanel.setEnabled(true);
            chatPanel.focus();
        })
        .catch((err: any) => {
            chatPanel.addAgentMessage(
                {
                    type: "text",
                    content: `Failed to send command: ${err.message || err}`,
                    kind: "error",
                },
                "system",
            );
            chatPanel.setEnabled(true);
            chatPanel.focus();
        });
}

/**
 * Attempt to connect to the dispatcher via the service worker.
 */
let historyLoaded = false;

function attemptConnect() {
    rpc.invoke("chatPanelConnect")
        .then(async (response: any) => {
            if (response?.connected) {
                setConnectionStatus(true);
                if (!historyLoaded) {
                    historyLoaded = true;
                    await loadSessionHistory();
                }
            } else {
                setConnectionStatus(false);
            }
        })
        .catch(() => {
            setConnectionStatus(false);
        });
}

async function loadSessionHistory() {
    try {
        const entries: any[] = await rpc.invoke("chatPanelGetHistory") as any;
        if (!entries || entries.length === 0) return;

        chatPanel.addHistorySeparator();

        for (const entry of entries) {
            if (entry.type === "user-request") {
                chatPanel.resetHistoryAgent();
                chatPanel.addHistoryUserMessage(entry.command);
            } else if (entry.type === "set-display") {
                chatPanel.resetHistoryAgent();
                chatPanel.addHistoryAgentMessage(
                    entry.message.message,
                    entry.message.source,
                    entry.message.sourceIcon,
                );
            } else if (entry.type === "append-display") {
                chatPanel.addHistoryAgentMessage(
                    entry.message.message,
                    entry.message.source,
                    entry.message.sourceIcon,
                    entry.mode,
                );
            }
        }
        chatPanel.resetHistoryAgent();
    } catch {
        // History loading is best-effort
    }
}

/**
 * Start a periodic reconnection timer.
 */
function startReconnectTimer() {
    if (reconnectTimer) return;
    reconnectTimer = setInterval(() => {
        connectionBanner.textContent = "Reconnecting to TypeAgent...";
        attemptConnect();
    }, 5000);
}

/**
 * Stop the reconnection timer.
 */
function stopReconnectTimer() {
    if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = undefined;
    }
}

/**
 * Update the connection status banner.
 */
function setConnectionStatus(connected: boolean) {
    if (bannerHideTimer) {
        clearTimeout(bannerHideTimer);
        bannerHideTimer = undefined;
    }

    if (connected) {
        stopReconnectTimer();
        connectionBanner.textContent = "Connected to TypeAgent";
        connectionBanner.className = "connection-banner connected";
        connectionBanner.style.display = "";
        chatPanel.setEnabled(true);
        bannerHideTimer = setTimeout(() => {
            connectionBanner.style.display = "none";
        }, 3000);
    } else {
        connectionBanner.textContent =
            "Not connected — ensure Agent Server is running";
        connectionBanner.className = "connection-banner";
        connectionBanner.style.display = "";
        chatPanel.setEnabled(false);
        startReconnectTimer();
    }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", initialize);
