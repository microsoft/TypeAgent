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
} from "@typeagent/browser-control-rpc/serviceTypes";

// Extract a stable threadId from a dispatcher RequestId. Prefers the
// server-assigned UUID; falls back to clientRequestId for agent-initiated
// threads (which carry an empty requestId and a "agent-..." clientRequestId).
function extractThreadId(requestId: any): string | undefined {
    if (!requestId || typeof requestId !== "object") return undefined;
    const r = requestId.requestId;
    if (typeof r === "string" && r.length > 0) return r;
    const c = requestId.clientRequestId;
    if (typeof c === "string" && c.length > 0) return c;
    return undefined;
}

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
let reconnectTimer: ReturnType<typeof setInterval> | undefined;
let bannerHideTimer: ReturnType<typeof setTimeout> | undefined;

// RPC client for communicating with the service worker
let rpc: ReturnType<typeof createChromeRpcClient>["rpc"];

// Display-replay gate: queues live display events until history replay
// completes so they render after history, not interleaved with it.
// Initialized false so events arriving before the first loadSessionHistory
// are queued; matches the Shell's pendingDisplayOps pattern.
let replayDone = false;
const pendingDisplayOps: Array<() => void> = [];

function runOrDefer(op: () => void) {
    if (replayDone) {
        op();
    } else {
        pendingDisplayOps.push(op);
    }
}

function flushPendingDisplayOps() {
    replayDone = true;
    const ops = pendingDisplayOps.splice(0);
    for (const op of ops) {
        try {
            op();
        } catch (e) {
            console.error("pendingDisplayOps op threw:", e);
        }
    }
}

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
                runOrDefer(() =>
                    chatPanel.setDisplayInfo(
                        data.source,
                        undefined,
                        data.action,
                        extractThreadId(data.requestId),
                    ),
                );
            },
            dispatcherSetDisplay(data) {
                runOrDefer(() => {
                    const msg = data.message;
                    const tid = extractThreadId(msg.requestId);
                    if (msg.kind === "toast") {
                        chatPanel.showToast(
                            msg.message as DisplayContent,
                            msg.source,
                            msg.sourceIcon,
                        );
                        return;
                    }
                    if (msg.kind === "inline") {
                        chatPanel.showInline(
                            msg.message as DisplayContent,
                            msg.source,
                        );
                        return;
                    }
                    chatPanel.replaceAgentMessage(
                        msg.message as DisplayContent,
                        msg.source,
                        msg.sourceIcon,
                        tid,
                    );
                });
            },
            dispatcherAppendDisplay(data) {
                runOrDefer(() => {
                    const msg = data.message;
                    const tid = extractThreadId(msg.requestId);
                    if (msg.kind === "toast") {
                        chatPanel.showToast(
                            msg.message as DisplayContent,
                            msg.source,
                            msg.sourceIcon,
                        );
                        return;
                    }
                    if (msg.kind === "inline") {
                        chatPanel.showInline(
                            msg.message as DisplayContent,
                            msg.source,
                        );
                        return;
                    }
                    chatPanel.addAgentMessage(
                        msg.message as DisplayContent,
                        msg.source,
                        msg.sourceIcon,
                        data.mode as DisplayAppendMode,
                        tid,
                    );
                });
            },
            dispatcherSetDynamicDisplay(data) {
                runOrDefer(() =>
                    chatPanel.setDynamicDisplay(
                        data.source,
                        data.displayId,
                        data.nextRefreshMs,
                    ),
                );
            },
            dispatcherNotify(data) {
                runOrDefer(() => {
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
                        case "inline": {
                            const content: DisplayContent =
                                typeof data.data === "string"
                                    ? {
                                          type: "text",
                                          content: data.data,
                                          kind: "info",
                                      }
                                    : (data.data as DisplayContent);
                            chatPanel.showInline(content, data.source);
                            break;
                        }
                        case "toast": {
                            const content: DisplayContent =
                                typeof data.data === "string"
                                    ? {
                                          type: "text",
                                          content: data.data,
                                          kind: "info",
                                      }
                                    : (data.data as DisplayContent);
                            chatPanel.showToast(content, data.source);
                            break;
                        }
                        case "info":
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
                });
            },
            dispatcherTakeAction(data) {
                // Forward `manage-conversation` (from @conversation slash
                // commands or NL agent) to the service worker for handling.
                if (data && data.action === "manage-conversation") {
                    (
                        rpc.invoke(
                            "chatPanelManageConversation",
                            data.data,
                        ) as Promise<{
                            kind: "ok" | "error";
                            html: string;
                            switched?: boolean;
                        }>
                    ).then(
                        (res) => {
                            const renderResult = () =>
                                chatPanel.showInline(
                                    {
                                        type: "html",
                                        content: res.html,
                                        kind:
                                            res.kind === "error"
                                                ? "warning"
                                                : "info",
                                    },
                                    "conversation",
                                );
                            if (res.switched) {
                                chatPanel.clear();
                                // Replay history then render confirmation
                                // so it lands below any prior log.
                                void loadSessionHistory().then(renderResult);
                            } else {
                                renderResult();
                            }
                        },
                        (e: any) => {
                            chatPanel.showInline(
                                {
                                    type: "text",
                                    content: `Conversation command failed: ${e?.message ?? String(e)}`,
                                    kind: "error",
                                },
                                "conversation",
                            );
                        },
                    );
                    return;
                }
            },
            dispatcherConnectionStatus(data) {
                setConnectionStatus(data.connected);
            },
            // ---- Queue lifecycle (forwarded from the service worker) ----
            // Chat panel does not render queue chips yet; these handlers
            // exist so the typed RPC contract is satisfied and so the
            // panel can opt into chip UX later without touching the
            // service worker.
            dispatcherRequestQueued(_data) {},
            dispatcherRequestStarted(_data) {},
            dispatcherRequestCancelled(_data) {},
            dispatcherQueueStateChanged(_data) {},
            injectCommand(data) {
                chatPanel.injectCommand(data.command);
            },
            startMacroAuthoring(_data) {
                chatPanel.addAgentMessage(
                    {
                        type: "text",
                        content:
                            "Let's create a new macro! What would you like this macro to do?\n\n" +
                            'Please describe the goal you want to automate (e.g., "Add the current product to my cart").',
                    },
                    "browser",
                );
                chatPanel.addFollowUpButtons([
                    {
                        label: "Let AI try it",
                        command: "__macro_authoring_ai__",
                        displayText: "Let AI demonstrate",
                    },
                    {
                        label: "I'll demonstrate",
                        command: "__macro_authoring_demo__",
                        displayText: "I'll demonstrate the steps",
                    },
                ]);
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
    if (text === "__macro_authoring_ai__") {
        chatPanel.addAgentMessage(
            {
                type: "text",
                content:
                    "Great! Please describe your automation goal and I'll try to complete it.\n\n" +
                    'Type your goal below (e.g., "Add the current product to cart and go to checkout"):',
            },
            "browser",
        );
        (window as any).__macroAuthoringMode = "ai";
        return true;
    }
    if (text === "__macro_authoring_demo__") {
        chatPanel.addAgentMessage(
            {
                type: "text",
                content:
                    "Great! Please describe what this macro should do, then I'll start recording your actions.\n\n" +
                    "Type your goal below:",
            },
            "browser",
        );
        (window as any).__macroAuthoringMode = "demo";
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
function handleUserMessage(
    text: string,
    attachments: string[] | undefined,
    requestId: string,
) {
    // Handle internal commands (save/discard recording) without going to dispatcher
    if (handleInternalCommand(text)) return;

    // Handle macro authoring goal capture
    const authoringMode = (window as any).__macroAuthoringMode;
    if (authoringMode) {
        delete (window as any).__macroAuthoringMode;
        if (authoringMode === "ai") {
            chatPanel.setEnabled(false);
            chatPanel.showStatus("Starting AI-driven automation...");
            const learnCommand = `@browser learn "${text}"`;
            rpc.invoke("chatPanelProcessCommand", {
                command: learnCommand,
                clientRequestId: requestId,
                attachments: [],
            })
                .then(() => {
                    chatPanel.setEnabled(true);
                    chatPanel.focus();
                })
                .catch((err: any) => {
                    chatPanel.addAgentMessage(
                        {
                            type: "text",
                            content: `Failed: ${err.message || err}`,
                            kind: "error",
                        },
                        "browser",
                    );
                    chatPanel.setEnabled(true);
                });
            return;
        } else if (authoringMode === "demo") {
            const actionName =
                text.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30) ||
                "myAction";
            chatPanel.addAgentMessage(
                {
                    type: "text",
                    content: `Recording started for "${text}". Perform your actions on the page, then click "Save recording" when done.`,
                },
                "browser",
            );
            rpc.invoke("chatPanelStartRecording")
                .then((result: any) => {
                    if (result?.success) {
                        (window as any).__recordingGoal = text;
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
            return;
        }
    }

    // Don't disable the input here — the chat panel's send() already
    // swapped the send button for the stop button via setProcessing(),
    // and we want the user to be able to queue another command while
    // this one is in flight. The dispatcher will queue concurrent
    // requests server-side. We just need to be sure that when the
    // request completes we only flip back to the send button if THIS
    // request is still the most recent in-flight one (otherwise a
    // newer submission's stop button would disappear prematurely).
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

            if (chatPanel.getActiveRequestId() === requestId) {
                chatPanel.setIdle();
            }
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
            if (chatPanel.getActiveRequestId() === requestId) {
                chatPanel.setIdle();
            }
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
                    await loadSessionHistory();
                    historyLoaded = true;
                } else {
                    // Already loaded earlier; flush any events queued
                    // since reconnect so they don't stay stuck.
                    flushPendingDisplayOps();
                }
            } else {
                setConnectionStatus(false);
                flushPendingDisplayOps();
            }
        })
        .catch(() => {
            setConnectionStatus(false);
            flushPendingDisplayOps();
        });
}

async function loadSessionHistory() {
    replayDone = false;
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
    } finally {
        flushPendingDisplayOps();
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
