// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Dispatcher connection for the Chrome extension chat panel.
 *
 * Connects to the TypeAgent Agent Server (default ws://localhost:8999)
 * using the same channel multiplexing protocol as agentServerClient.ts,
 * but with native WebSocket (no isomorphic-ws).
 *
 * The ClientIO implementation forwards display callbacks to the
 * chat panel side view via chrome.runtime.sendMessage.
 */

import { createChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { createClientIORpcServer } from "@typeagent/dispatcher-rpc/clientio/server";
import {
    createDispatcherRpcClient,
    wrapClientIOForCompletion,
} from "@typeagent/dispatcher-rpc/dispatcher/client";
import type { ClientIO, Dispatcher } from "@typeagent/dispatcher-rpc/types";
import type {
    AgentServerInvokeFunctions,
    ConversationInfo,
    DispatcherConnectOptions,
    JoinConversationResult,
} from "@typeagent/agent-server-protocol";
import {
    getDispatcherChannelName,
    getClientIOChannelName,
    AgentServerChannelName,
    AGENT_SERVER_DEFAULT_URL,
} from "@typeagent/agent-server-protocol";

import registerDebug from "debug";

const debug = registerDebug("typeagent:extension:dispatcher");
const debugErr = registerDebug("typeagent:extension:dispatcher:error");

const DEFAULT_AGENT_SERVER_URL = AGENT_SERVER_DEFAULT_URL;

// Module-level dispatcher state
let dispatcher: Dispatcher | undefined;
let dispatcherWs: WebSocket | undefined;
let connectionPromise: Promise<Dispatcher> | undefined;

// Hoisted from doConnect() so conversation management can issue
// AgentServer RPC calls and re-bind channels outside the initial connect.
type ServerRpc = ReturnType<typeof createRpc<AgentServerInvokeFunctions>>;
type ChannelProvider = ReturnType<typeof createChannelProviderAdapter>;
let serverRpc: ServerRpc | undefined;
let serverChannel: ChannelProvider | undefined;
let chatPanelClientIO: ClientIO | undefined;
let activeConversationId: string | undefined;
let activeConversationName: string | undefined;

// RPC functions for communicating with the chat panel.
// rpcSend: fire-and-forget (display updates)
// rpcInvoke: awaited (question, proposeAction)
// Set by setChatPanelRpc() from the service worker index after the RPC server is created.
let rpcSend: ((name: string, ...args: any[]) => void) | undefined;
let rpcInvoke: ((name: string, ...args: any[]) => Promise<any>) | undefined;

export function setChatPanelRpc(rpc: {
    send: (name: string, ...args: any[]) => void;
    invoke: (name: string, ...args: any[]) => Promise<any>;
}) {
    rpcSend = rpc.send.bind(rpc);
    rpcInvoke = rpc.invoke.bind(rpc);
}

/**
 * Create a ClientIO that forwards display callbacks to the chat panel.
 * Messages are relayed via chrome.runtime.sendMessage so the side panel
 * view can receive them even though it's in a different execution context.
 */
function createChatPanelClientIO(): ClientIO {
    return {
        clear(requestId) {
            rpcSend?.("dispatcherClear", { requestId });
        },
        exit(requestId) {
            rpcSend?.("dispatcherExit", { requestId });
        },
        shutdown(requestId) {
            rpcSend?.("dispatcherExit", { requestId });
        },
        setUserRequest() {},
        setDisplayInfo(requestId, source, actionIndex, action) {
            rpcSend?.("dispatcherSetDisplayInfo", {
                requestId,
                source,
                actionIndex,
                action,
            });
        },
        setDisplay(message) {
            rpcSend?.("dispatcherSetDisplay", { message });
        },
        appendDisplay(message, mode) {
            rpcSend?.("dispatcherAppendDisplay", { message, mode });
        },
        appendDiagnosticData(_requestId, _data) {
            // Diagnostic data not shown in extension chat panel
        },
        setDynamicDisplay(
            requestId,
            source,
            actionIndex,
            displayId,
            nextRefreshMs,
        ) {
            rpcSend?.("dispatcherSetDynamicDisplay", {
                requestId,
                source,
                actionIndex,
                displayId,
                nextRefreshMs,
            });
        },

        async question(_requestId, message, choices, defaultId) {
            // For Yes/No, delegate to the chat panel RPC.
            if (
                choices.length === 2 &&
                choices[0] === "Yes" &&
                choices[1] === "No" &&
                rpcInvoke
            ) {
                try {
                    const yes = await rpcInvoke("chatPanelAskYesNo", {
                        message,
                        defaultValue: defaultId === 0,
                    });
                    return yes ? 0 : 1;
                } catch {
                    return defaultId ?? 0;
                }
            }
            return defaultId ?? 0;
        },
        async proposeAction(_requestId, actionTemplates, source) {
            if (rpcInvoke) {
                try {
                    const actionText = JSON.stringify(actionTemplates, null, 2);
                    const accepted = await rpcInvoke("chatPanelProposeAction", {
                        actionText,
                        source,
                    });
                    return accepted ? undefined : false;
                } catch {
                    return undefined;
                }
            }
            return undefined;
        },
        notify(notificationId, event, data, source) {
            rpcSend?.("dispatcherNotify", {
                notificationId,
                event,
                data,
                source,
            });
        },

        async openLocalView(_requestId, _port) {
            // Not supported in extension
        },
        async closeLocalView(_requestId, _port) {
            // Not supported in extension
        },

        requestChoice() {
            // Not supported in extension
        },
        requestInteraction() {
            // Not supported in extension
        },
        interactionResolved() {
            // Not supported in extension
        },
        interactionCancelled() {
            // Not supported in extension
        },
        takeAction(requestId, action, data) {
            rpcSend?.("dispatcherTakeAction", { requestId, action, data });
        },
    };
}

/**
 * Connect to the Agent Server and return a Dispatcher.
 * Reuses existing connection if already connected.
 */
export async function connectToDispatcher(): Promise<Dispatcher> {
    if (dispatcher) {
        return dispatcher;
    }

    // Avoid duplicate concurrent connections
    if (connectionPromise) {
        return connectionPromise;
    }

    connectionPromise = doConnect();
    try {
        dispatcher = await connectionPromise;
        return dispatcher;
    } finally {
        connectionPromise = undefined;
    }
}

async function doConnect(): Promise<Dispatcher> {
    // Read agent server URL from extension settings
    const settings = await chrome.storage.sync.get(["agentServerHost"]);
    const url = settings.agentServerHost || DEFAULT_AGENT_SERVER_URL;

    debug("Connecting to Agent Server at %s", url);

    return new Promise<Dispatcher>((resolve, reject) => {
        const ws = new WebSocket(url);
        dispatcherWs = ws;

        const channel = createChannelProviderAdapter(
            "agent-server:extension",
            (message: any) => {
                debug("Sending to Agent Server:", message);
                ws.send(JSON.stringify(message));
            },
        );
        serverChannel = channel;

        const rpc = createRpc<AgentServerInvokeFunctions>(
            "agent-server:extension",
            channel.createChannel(AgentServerChannelName),
        );
        serverRpc = rpc;

        const clientIO = createChatPanelClientIO();
        chatPanelClientIO = clientIO;

        let resolved = false;

        ws.onopen = () => {
            debug("WebSocket connected to Agent Server");
            const options: DispatcherConnectOptions = {
                // filter:false so we see display events from all clients
                // (Shell/CLI peers) joined to the same conversation.
                filter: false,
                clientType: "extension",
            };
            bindToConversation(options, ws)
                .then((d) => {
                    resolved = true;
                    resolve(d);
                })
                .catch((err: any) => {
                    debugErr("Failed to join dispatcher:", err);
                    reject(err);
                });
        };

        ws.onmessage = (event: MessageEvent) => {
            debug("Received from Agent Server:", event.data);
            const data =
                typeof event.data === "string"
                    ? event.data
                    : event.data.toString();
            channel.notifyMessage(JSON.parse(data));
        };

        ws.onclose = (event: CloseEvent) => {
            debug(
                "Agent Server WebSocket closed: %d %s",
                event.code,
                event.reason,
            );
            channel.notifyDisconnected();
            dispatcher = undefined;
            dispatcherWs = undefined;
            serverRpc = undefined;
            serverChannel = undefined;
            chatPanelClientIO = undefined;
            activeConversationId = undefined;
            activeConversationName = undefined;
            if (!resolved) {
                reject(
                    new Error(`Failed to connect to Agent Server at ${url}`),
                );
            }
            rpcSend?.("dispatcherConnectionStatus", { connected: false });
        };

        ws.onerror = (event: Event) => {
            debugErr("Agent Server WebSocket error");
        };
    });
}

/**
 * Join (or rejoin) a conversation and wire up its per-conversation
 * dispatcher RPC client + clientIO server on top of the current WebSocket.
 */
async function bindToConversation(
    options: DispatcherConnectOptions,
    ws: WebSocket,
): Promise<Dispatcher> {
    if (!serverRpc || !serverChannel || !chatPanelClientIO) {
        throw new Error("Agent server RPC is not initialized");
    }
    const result: JoinConversationResult = await serverRpc.invoke(
        "joinConversation",
        options,
    );
    debug(
        "Joined conversation=%s (%s), connectionId=%s",
        result.name,
        result.conversationId,
        result.connectionId,
    );

    const {
        dispatcher: d,
        notifyCommandComplete,
        notifyRequestCancelled,
    } = createDispatcherRpcClient(
        serverChannel.createChannel(
            getDispatcherChannelName(result.conversationId),
        ),
        result.connectionId,
    );

    createClientIORpcServer(
        wrapClientIOForCompletion(chatPanelClientIO, {
            notifyCommandComplete,
            notifyRequestCancelled,
        }),
        serverChannel.createChannel(
            getClientIOChannelName(result.conversationId),
        ),
    );

    d.close = async () => {
        debug("Closing dispatcher WebSocket");
        ws.close();
    };

    activeConversationId = result.conversationId;
    activeConversationName = result.name;
    return d;
}

/**
 * Get whether the dispatcher is currently connected.
 */
export function isDispatcherConnected(): boolean {
    return (
        dispatcher !== undefined &&
        dispatcherWs !== undefined &&
        dispatcherWs.readyState === WebSocket.OPEN
    );
}

/**
 * Disconnect from the Agent Server.
 */
export async function disconnectDispatcher(): Promise<void> {
    if (dispatcher) {
        await dispatcher.close();
        dispatcher = undefined;
    }
    connectionPromise = undefined;
    serverRpc = undefined;
    serverChannel = undefined;
    chatPanelClientIO = undefined;
    activeConversationId = undefined;
    activeConversationName = undefined;
}

/**
 * Get the current Dispatcher instance (or undefined if not connected).
 */
export function getDispatcher(): Dispatcher | undefined {
    return dispatcher;
}

// ── Conversation management ────────────────────────────────────────────
// Handles the dispatcher's `manage-conversation` takeAction payload, which
// both @conversation slash commands and the NL conversation agent emit.

type ManageConversationPayload = {
    subcommand:
        | "new"
        | "list"
        | "info"
        | "switch"
        | "prev"
        | "next"
        | "rename"
        | "delete";
    name?: string;
    newName?: string;
};

type ManageConversationResult = {
    kind: "ok" | "error";
    html: string;
    // True when the active conversation changed; chat panel clears +
    // replays history on this signal.
    switched?: boolean;
};

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => {
        switch (c) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            default:
                return "&#39;";
        }
    });
}

function ok(html: string, switched?: boolean): ManageConversationResult {
    return switched
        ? { kind: "ok", html, switched: true }
        : { kind: "ok", html };
}

function err(html: string): ManageConversationResult {
    return { kind: "error", html };
}

function defaultNewName(): string {
    const dt = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `Conversation ${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function findByName(
    sessions: ConversationInfo[],
    name: string,
): ConversationInfo | undefined {
    const lower = name.toLowerCase();
    return sessions.find((s) => s.name.toLowerCase() === lower);
}

async function switchToConversationId(
    newId: string,
): Promise<ConversationInfo | undefined> {
    if (!serverRpc || !serverChannel) {
        throw new Error("Not connected to agent server.");
    }
    if (!dispatcherWs || dispatcherWs.readyState !== WebSocket.OPEN) {
        throw new Error("Agent server WebSocket is not open.");
    }
    if (newId === activeConversationId) {
        return undefined;
    }

    const oldId = activeConversationId;

    // Join new before tearing down old (matches agentServerClient + CLI).
    // If the join throws, the existing dispatcher + channels stay live so
    // the user can retry. No duplicate-channel risk: newId !== oldId here.
    const newDispatcher = await bindToConversation(
        {
            filter: false,
            clientType: "extension",
            conversationId: newId,
        },
        dispatcherWs,
    );
    dispatcher = newDispatcher;

    // Leave old server-side first; in-flight completions for the prior
    // dispatcher were resolved before this point because callers await
    // their dispatcher.submitCommand. Then drop our local channel adapters
    // so a future re-bind to the same id doesn't hit createChannel's
    // duplicate-name guard.
    if (oldId && oldId !== activeConversationId) {
        try {
            await serverRpc.invoke("leaveConversation", oldId);
        } catch (e) {
            debugErr("leaveConversation failed for %s: %o", oldId, e);
        }
        serverChannel.deleteChannel(getDispatcherChannelName(oldId));
        serverChannel.deleteChannel(getClientIOChannelName(oldId));
    }

    try {
        const all = await serverRpc.invoke("listConversations", undefined);
        return all.find((s) => s.conversationId === newId);
    } catch {
        return undefined;
    }
}

// Serialize all manageConversation calls so overlapping switches (e.g. a
// `next` issued while a previous `switch` is still binding) can't
// interleave on shared module state.
let conversationOpQueue: Promise<unknown> = Promise.resolve();

/**
 * Resolves once any in-flight conversation management op has settled.
 * Callers that need the active dispatcher (e.g. chatPanelProcessCommand)
 * await this first so user prompts don't race with a switch and end up
 * submitted to the wrong (or about-to-be-deleted) channel.
 */
export function awaitConversationOps(): Promise<void> {
    return conversationOpQueue.then(
        () => undefined,
        () => undefined,
    );
}

/**
 * Handle a `manage-conversation` payload. Returns an HTML message the chat
 * panel renders inline. Calls are serialized; one failure doesn't poison
 * subsequent calls.
 */
export function manageConversation(
    payload: ManageConversationPayload,
): Promise<ManageConversationResult> {
    const result = conversationOpQueue.then(
        () => doManageConversation(payload),
        () => doManageConversation(payload),
    );
    // Keep the chain alive across rejections so a single failure doesn't
    // poison every subsequent call.
    conversationOpQueue = result.catch(() => undefined);
    return result;
}

async function doManageConversation(
    payload: ManageConversationPayload,
): Promise<ManageConversationResult> {
    if (!serverRpc) {
        return err("❌ Not connected to agent server.");
    }
    try {
        switch (payload.subcommand) {
            case "new": {
                const name = payload.name?.trim() || defaultNewName();
                const created = await serverRpc.invoke(
                    "createConversation",
                    name,
                );
                // Auto-switch into the newly created conversation (matches Shell).
                let switched = false;
                try {
                    await switchToConversationId(created.conversationId);
                    switched = true;
                } catch (e) {
                    debugErr("auto-switch after new failed: %o", e);
                }
                return ok(
                    switched
                        ? `✅ Created and switched to conversation "<b>${escapeHtml(created.name)}</b>"`
                        : `✅ Created conversation "<b>${escapeHtml(created.name)}</b>" but could not switch.`,
                    switched,
                );
            }
            case "list": {
                const sessions = await serverRpc.invoke(
                    "listConversations",
                    payload.name,
                );
                if (sessions.length === 0) {
                    return ok("<i>No conversations found.</i>");
                }
                sessions.sort(
                    (a, b) =>
                        new Date(b.createdAt).getTime() -
                        new Date(a.createdAt).getTime(),
                );
                const items = sessions
                    .map((s) => {
                        const cur =
                            s.conversationId === activeConversationId
                                ? "▸ "
                                : "";
                        return `<li>${cur}${escapeHtml(s.name)}</li>`;
                    })
                    .join("");
                return ok(`<ul>${items}</ul>`);
            }
            case "info": {
                if (!activeConversationId || !activeConversationName) {
                    return err("Not currently in a conversation.");
                }
                return ok(
                    `<b>Current conversation:</b><br>` +
                        `Name: ${escapeHtml(activeConversationName)}<br>` +
                        `<span style="font-family:monospace;font-size:smaller;">${escapeHtml(activeConversationId)}</span>`,
                );
            }
            case "switch": {
                const name = payload.name?.trim();
                if (!name) {
                    return err(
                        "A conversation name is required to switch. Usage: <code>@conversation switch &lt;name&gt;</code>",
                    );
                }
                const sessions = await serverRpc.invoke(
                    "listConversations",
                    undefined,
                );
                const target = findByName(sessions, name);
                if (!target) {
                    return err(
                        `❌ Conversation "<b>${escapeHtml(name)}</b>" not found.`,
                    );
                }
                if (target.conversationId === activeConversationId) {
                    return ok(
                        `Already in conversation "<b>${escapeHtml(target.name)}</b>".`,
                    );
                }
                await switchToConversationId(target.conversationId);
                return ok(
                    `🔀 Switched to conversation "<b>${escapeHtml(target.name)}</b>".`,
                    true,
                );
            }
            case "prev":
            case "next": {
                const sessions = await serverRpc.invoke(
                    "listConversations",
                    undefined,
                );
                if (sessions.length < 2) {
                    return err("No other conversations to switch to.");
                }
                sessions.sort(
                    (a, b) =>
                        new Date(b.createdAt).getTime() -
                        new Date(a.createdAt).getTime(),
                );
                const idx = sessions.findIndex(
                    (s) => s.conversationId === activeConversationId,
                );
                if (idx === -1) {
                    return err("Current conversation not found in list.");
                }
                const delta = payload.subcommand === "next" ? 1 : -1;
                const target =
                    sessions[(idx + delta + sessions.length) % sessions.length];
                await switchToConversationId(target.conversationId);
                return ok(
                    `🔀 Switched to ${payload.subcommand === "next" ? "next" : "previous"} conversation "<b>${escapeHtml(target.name)}</b>".`,
                    true,
                );
            }
            case "rename": {
                if (!payload.newName) {
                    return err(
                        "A new name is required. Usage: <code>@conversation rename [&lt;oldName&gt;] &lt;newName&gt;</code>",
                    );
                }
                let conversationId: string | undefined;
                let oldName: string | undefined;
                if (payload.name) {
                    const sessions = await serverRpc.invoke(
                        "listConversations",
                        undefined,
                    );
                    const match = findByName(sessions, payload.name);
                    if (!match) {
                        return err(
                            `❌ Conversation "<b>${escapeHtml(payload.name)}</b>" not found.`,
                        );
                    }
                    conversationId = match.conversationId;
                    oldName = match.name;
                } else {
                    conversationId = activeConversationId;
                    oldName = activeConversationName;
                }
                if (!conversationId) {
                    return err("No conversation to rename.");
                }
                await serverRpc.invoke(
                    "renameConversation",
                    conversationId,
                    payload.newName,
                );
                if (conversationId === activeConversationId) {
                    activeConversationName = payload.newName;
                }
                return ok(
                    `✅ Renamed "<b>${escapeHtml(oldName ?? "")}</b>" to "<b>${escapeHtml(payload.newName)}</b>".`,
                );
            }
            case "delete": {
                const name = payload.name?.trim();
                if (!name) {
                    return err(
                        "A conversation name is required. Usage: <code>@conversation delete &lt;name&gt;</code>",
                    );
                }
                const sessions = await serverRpc.invoke(
                    "listConversations",
                    undefined,
                );
                const target = findByName(sessions, name);
                if (!target) {
                    return err(
                        `❌ Conversation "<b>${escapeHtml(name)}</b>" not found.`,
                    );
                }
                if (target.conversationId === activeConversationId) {
                    return err(
                        "Cannot delete the active conversation. Switch to another conversation first.",
                    );
                }
                // Confirm via the chat panel. Treat absence of `rpcInvoke`
                // or a rejected prompt as "not confirmed" — refuse the
                // destructive op rather than silently proceeding.
                if (!rpcInvoke) {
                    return err(
                        "Cannot confirm deletion (chat panel not connected). Aborted.",
                    );
                }
                let confirmed: boolean;
                try {
                    confirmed = (await rpcInvoke("chatPanelAskYesNo", {
                        message: `Delete conversation '${target.name}'?`,
                        defaultValue: false,
                    })) as boolean;
                } catch (e) {
                    debugErr("yes/no confirm failed: %o", e);
                    return err("Could not confirm deletion. Aborted.");
                }
                if (!confirmed) {
                    return ok("Cancelled.");
                }
                await serverRpc.invoke(
                    "deleteConversation",
                    target.conversationId,
                );
                return ok(
                    `🗑️ Deleted conversation "<b>${escapeHtml(target.name)}</b>".`,
                );
            }
            default:
                return err(
                    `Unknown manage-conversation subcommand: "<b>${escapeHtml(
                        (payload as { subcommand: string }).subcommand,
                    )}</b>"`,
                );
        }
    } catch (e: any) {
        debugErr("manageConversation failed: %o", e);
        return err(`❌ ${escapeHtml(e?.message ?? String(e))}`);
    }
}
