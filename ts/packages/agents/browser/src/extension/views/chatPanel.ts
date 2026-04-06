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
    ChatPanelInvokeTargets,
    ChatPanelCallFunctions,
} from "../../common/serviceTypes.mjs";

// Platform adapter: open links in a real Chrome tab
const platformAdapter: PlatformAdapter = {
    handleLinkClick(href: string, _target: string | null) {
        // Rewrite typeagent-browser:// URLs to the actual extension URL
        if (href.startsWith("typeagent-browser://")) {
            const path = href.replace("typeagent-browser://", "");
            href = chrome.runtime.getURL(path);
        }
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
                return (await rpc.invoke("chatPanelGetCompletions", {
                    input,
                })) as any;
            } catch {
                return null;
            }
        },
        getDynamicDisplay: async (source: string, displayId: string) => {
            return (await rpc.invoke("chatPanelGetDynamicDisplay", {
                source,
                displayId,
            })) as any;
        },
    });

    // Create RPC client with invoke handlers (awaited by service worker)
    // and call handlers (fire-and-forget from service worker)
    const client = createChromeRpcClient<
        ChatPanelInvokeFunctions,
        {},
        ChatPanelInvokeTargets,
        ChatPanelCallFunctions
    >(
        {
            async chatPanelAskYesNo(data) {
                return chatPanel.askYesNo(data.message, data.defaultValue);
            },
            async chatPanelProposeAction(data) {
                return chatPanel.proposeAction(data.actionText, data.source);
            },
        },
        {
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
                chatPanel.replaceAgentMessage(
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
            dispatcherSetDynamicDisplay(data) {
                chatPanel.setDynamicDisplay(
                    data.source,
                    data.displayId,
                    data.nextRefreshMs,
                );
            },
            dispatcherNotify(data) {
                switch (data.event) {
                    case "explained":
                        if (data.data?.error) {
                            chatPanel.addAgentMessage(
                                {
                                    type: "text",
                                    content: data.data.error,
                                    kind: "warning",
                                },
                                data.source,
                            );
                        }
                        break;
                    case "error":
                        chatPanel.addAgentMessage(
                            {
                                type: "text",
                                content:
                                    typeof data.data === "string"
                                        ? data.data
                                        : (data.data?.message ?? "Error"),
                                kind: "error",
                            },
                            data.source,
                        );
                        break;
                    case "warning":
                        chatPanel.addAgentMessage(
                            {
                                type: "text",
                                content:
                                    typeof data.data === "string"
                                        ? data.data
                                        : (data.data?.message ?? "Warning"),
                                kind: "warning",
                            },
                            data.source,
                        );
                        break;
                    case "info":
                    case "inline":
                    case "toast":
                        chatPanel.addAgentMessage(
                            typeof data.data === "string"
                                ? {
                                      type: "text",
                                      content: data.data,
                                      kind: "info",
                                  }
                                : (data.data as DisplayContent),
                            data.source,
                        );
                        break;
                }
            },
            dispatcherTakeAction(_data) {
                // Not supported in extension chat panel
            },
            dispatcherConnectionStatus(data) {
                setConnectionStatus(data.connected);
            },
            injectCommand(data) {
                chatPanel.injectCommand(data.command);
            },
        },
    );
    rpc = client.rpc;

    // Request connection to the dispatcher
    attemptConnect();

    chatPanel.focus();
}

let lastRecordedActionName = "Recorded Action";

function extractRecordedActionName(): string | undefined {
    // Look through command history for the last @browser actions record command
    for (let i = 0; i < (chatPanel as any).commandHistory?.length || 0; i++) {
        const cmd = (chatPanel as any).commandHistory[i];
        if (cmd && cmd.toLowerCase().startsWith("@browser actions record")) {
            const name = cmd.substring("@browser actions record".length).trim();
            if (name) return name;
        }
    }
    return undefined;
}

function handleInternalCommand(text: string): boolean {
    if (text === "__save_recording__") {
        rpc.invoke("chatPanelCreateWebFlowFromRecording", {
            actionName: lastRecordedActionName,
            actionDescription: `Recorded action: ${lastRecordedActionName}`,
        })
            .then((result: any) => {
                if (result?.success) {
                    chatPanel.addAgentMessage(
                        {
                            type: "text",
                            content: `Action "${result.flowName}" saved as a reusable WebFlow!`,
                            kind: "success",
                        },
                        "browser",
                    );
                } else {
                    chatPanel.addAgentMessage(
                        {
                            type: "text",
                            content: `Failed to save: ${result?.error || "Unknown error"}`,
                            kind: "error",
                        },
                        "browser",
                    );
                }
                chatPanel.setEnabled(true);
                chatPanel.focus();
            })
            .catch(() => {
                chatPanel.setEnabled(true);
            });
        return true;
    }
    if (text === "__discard_recording__") {
        chatPanel.addAgentMessage(
            { type: "text", content: "Recording discarded." },
            "browser",
        );
        return true;
    }
    if (text === "__cancel_recording__") {
        rpc.invoke("chatPanelStopRecording")
            .then(() => {
                chatPanel.addAgentMessage(
                    { type: "text", content: "Recording cancelled." },
                    "browser",
                );
            })
            .catch(() => {});
        return true;
    }
    if (text === "__save_and_stop_recording__") {
        lastRecordedActionName =
            extractRecordedActionName() || "Recorded Action";
        chatPanel.showStatus("Saving action...");

        rpc.invoke("chatPanelStopRecording")
            .then((stopResult: any) => {
                if (!stopResult?.success || stopResult.stepCount === 0) {
                    chatPanel.addAgentMessage(
                        {
                            type: "text",
                            content:
                                stopResult?.stepCount === 0
                                    ? "No steps were recorded."
                                    : `Recording failed: ${stopResult?.error || "Unknown error"}`,
                            kind: "warning",
                        },
                        "browser",
                    );
                    chatPanel.setEnabled(true);
                    chatPanel.focus();
                    return;
                }

                return rpc.invoke("chatPanelCreateWebFlowFromRecording", {
                    actionName: lastRecordedActionName,
                    actionDescription: `Recorded action: ${lastRecordedActionName}`,
                });
            })
            .then((saveResult: any) => {
                if (!saveResult) return;
                if (saveResult.success) {
                    chatPanel.addAgentMessage(
                        {
                            type: "text",
                            content: `Action "${saveResult.flowName}" saved as a reusable WebFlow!`,
                            kind: "success",
                        },
                        "browser",
                    );
                } else {
                    chatPanel.addAgentMessage(
                        {
                            type: "text",
                            content: `Failed to save: ${saveResult?.error || "Unknown error"}`,
                            kind: "error",
                        },
                        "browser",
                    );
                }
                chatPanel.setEnabled(true);
                chatPanel.focus();
            })
            .catch(() => {
                chatPanel.setEnabled(true);
            });
        return true;
    }
    return false;
}

/**
 * Handle a message typed by the user.
 */
function handleUserMessage(text: string, attachments?: string[]) {
    // Handle internal commands (save/discard recording) without going to dispatcher
    if (handleInternalCommand(text)) return;

    chatPanel.setEnabled(false);
    chatPanel.showStatus("Processing...");

    const requestId = `ext-${++requestCounter}`;

    rpc.invoke("chatPanelProcessCommand", {
        command: text,
        clientRequestId: requestId,
        attachments,
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

            // Add contextual follow-up buttons based on the command
            addContextualFollowUps(text);

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
 * Add contextual follow-up buttons based on the command that just completed.
 */
function addContextualFollowUps(command: string) {
    const normalized = command.toLowerCase().trim();

    if (normalized.includes("@browser actions discover")) {
        chatPanel.addFollowUpButtons([
            {
                label: "Record New Action",
                command: "@browser actions record myAction",
            },
        ]);
    } else if (normalized.startsWith("@browser ask")) {
        // After a Q&A answer, offer to extract full knowledge
        chatPanel.addFollowUpButtons([
            {
                label: "Extract full knowledge",
                command: "@browser extractKnowledge",
            },
        ]);
    } else if (normalized.startsWith("@browser actions record")) {
        // Start recording via service worker and show controls
        rpc.invoke("chatPanelStartRecording")
            .then((result: any) => {
                if (result?.success) {
                    chatPanel.addFollowUpButtons([
                        {
                            label: "Save recording",
                            command: "__save_and_stop_recording__",
                            displayText: "Save recording",
                        },
                        {
                            label: "Cancel recording",
                            command: "__cancel_recording__",
                            displayText: "Cancel recording",
                        },
                    ]);
                }
            })
            .catch(() => {});
    } else if (normalized.includes("@browser actions stop recording")) {
        // Stop recording and offer to save
        rpc.invoke("chatPanelStopRecording")
            .then((result: any) => {
                if (result?.success && result.stepCount > 0) {
                    chatPanel.addAgentMessage(
                        {
                            type: "text",
                            content: `Captured ${result.stepCount} step(s). Save as a reusable action?`,
                        },
                        "browser",
                    );
                    // Extract action name from the original record command
                    lastRecordedActionName =
                        extractRecordedActionName() || "Recorded Action";
                    chatPanel.addFollowUpButtons([
                        {
                            label: "Save Action",
                            command: "__save_recording__",
                            displayText: "Yes, save the recording",
                        },
                        {
                            label: "Discard",
                            command: "__discard_recording__",
                            displayText: "Discard recording",
                        },
                    ]);
                } else if (result?.success) {
                    chatPanel.addAgentMessage(
                        {
                            type: "text",
                            content: "No steps were recorded.",
                            kind: "warning",
                        },
                        "browser",
                    );
                }
            })
            .catch(() => {});
    }
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
        const entries: any[] = (await rpc.invoke("chatPanelGetHistory")) as any;
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
