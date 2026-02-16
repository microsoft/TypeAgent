// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chat panel side view for the Chrome extension.
 *
 * Creates a ChatPanel from the shared chat-ui package and connects
 * it to the TypeAgent dispatcher via the service worker.
 */

import { ChatPanel, PlatformAdapter } from "chat-ui";
import type { DisplayAppendMode, DisplayContent } from "@typeagent/agent-sdk";

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
    });

    // Listen for messages from the service worker (dispatcher callbacks)
    chrome.runtime.onMessage.addListener(handleServiceWorkerMessage);

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

    chrome.runtime
        .sendMessage({
            type: "chatPanel:processCommand",
            command: text,
            clientRequestId: requestId,
        })
        .then((response) => {
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
        .catch((err) => {
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
 * Handle messages forwarded from the service worker.
 * These originate from the dispatcher's ClientIO callbacks.
 */
function handleServiceWorkerMessage(message: any): void {
    switch (message.type) {
        case "dispatcher:setDisplay": {
            const msg = message.message;
            console.log("[chatPanel] setDisplay content:", JSON.stringify(msg.message).substring(0, 200), "type:", typeof msg.message);
            chatPanel.addAgentMessage(
                msg.message as DisplayContent,
                msg.source,
                msg.sourceIcon,
            );
            break;
        }

        case "dispatcher:appendDisplay": {
            const msg = message.message;
            const mode = message.mode as DisplayAppendMode;
            console.log("[chatPanel] appendDisplay content:", JSON.stringify(msg.message).substring(0, 200), "mode:", mode, "type:", typeof msg.message);
            chatPanel.addAgentMessage(
                msg.message as DisplayContent,
                msg.source,
                msg.sourceIcon,
                mode,
            );
            break;
        }

        case "dispatcher:setDisplayInfo": {
            chatPanel.setDisplayInfo(
                message.source,
                message.sourceIcon,
            );
            break;
        }

        case "dispatcher:clear": {
            chatPanel.clear();
            break;
        }

        case "dispatcher:notify": {
            // Show notifications as status messages
            if (message.event === "explained" && message.data?.error) {
                chatPanel.addAgentMessage(
                    {
                        type: "text",
                        content: message.data.error,
                        kind: "warning",
                    },
                    message.source,
                );
            }
            break;
        }

        case "dispatcher:connectionStatus": {
            setConnectionStatus(message.connected);
            break;
        }
    }
}

/**
 * Attempt to connect to the dispatcher, with automatic retry on failure.
 */
function attemptConnect() {
    chrome.runtime
        .sendMessage({ type: "chatPanel:connect" })
        .then((response) => {
            if (response?.connected) {
                setConnectionStatus(true);
            } else {
                setConnectionStatus(false);
            }
        })
        .catch(() => {
            setConnectionStatus(false);
        });
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
    if (connected) {
        stopReconnectTimer();
        connectionBanner.textContent = "Connected to TypeAgent";
        connectionBanner.className = "connection-banner connected";
        chatPanel.setEnabled(true);
    } else {
        connectionBanner.textContent =
            "Not connected — ensure Agent Server is running";
        connectionBanner.className = "connection-banner";
        chatPanel.setEnabled(false);
        startReconnectTimer();
    }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", initialize);
