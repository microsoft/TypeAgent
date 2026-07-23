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
    DispatcherConnectOptions,
    JoinConversationResult,
} from "@typeagent/agent-server-protocol";
import {
    getDispatcherChannelName,
    getClientIOChannelName,
    AgentServerChannelName,
    AGENT_SERVER_DEFAULT_URL,
} from "@typeagent/agent-server-protocol";
import type {
    AgentServerConnection,
    ConversationDispatcher,
} from "@typeagent/agent-server-client";
import {
    manageConversation as manageConversationHelper,
    type ConversationActionResult,
    type ManageConversationContext,
    type ManageConversationPayload as HelperPayload,
} from "@typeagent/agent-server-client/conversation";

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
        requestForm() {
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

        // ---- Queue lifecycle (opt-in per client) ----
        //
        // The browser extension does not yet render queue chips, but we
        // still implement these handlers so the underlying ClientIO has
        // them defined. The dispatcher broadcasts queue lifecycle events
        // to every unfiltered client; clients that omit these methods are
        // silently skipped via optional chaining
        // (`cio.requestQueued?.(...)` in sharedDispatcher). When the
        // browser and another queue-aware client (e.g. the VS Code
        // extension) are connected to the same conversation, defining
        // these methods here keeps the wire protocol symmetric and lets
        // the chat panel side opt into chip UX later by handling these
        // forwarded messages — without requiring another round-trip
        // through the service worker.
        requestQueued(entry, version) {
            rpcSend?.("dispatcherRequestQueued", { entry, version });
        },
        requestStarted(entry, version) {
            rpcSend?.("dispatcherRequestStarted", { entry, version });
        },
        requestCancelled(requestId, reason, version) {
            rpcSend?.("dispatcherRequestCancelled", {
                requestId,
                reason,
                version,
            });
        },
        queueStateChanged(snapshot) {
            rpcSend?.("dispatcherQueueStateChanged", { snapshot });
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
 * Returns the full ConversationDispatcher shape (matches AgentServerConnection).
 */
async function joinConversationDispatcher(
    options: DispatcherConnectOptions,
    ws: WebSocket,
): Promise<ConversationDispatcher> {
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

    return {
        dispatcher: d,
        conversationId: result.conversationId,
        name: result.name,
        connectionId: result.connectionId,
        ...(result.queueSnapshot !== undefined
            ? { queueSnapshot: result.queueSnapshot }
            : {}),
    };
}

/**
 * Initial connect-time join: same as joinConversationDispatcher, but
 * also pins the result to the module-level active conversation state.
 */
async function bindToConversation(
    options: DispatcherConnectOptions,
    ws: WebSocket,
): Promise<Dispatcher> {
    const joined = await joinConversationDispatcher(options, ws);
    activeConversationId = joined.conversationId;
    activeConversationName = joined.name;
    return joined.dispatcher;
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

// Bold-escape `"name"` segments in helper plain-text messages.
// Non-greedy through the closing quote so names containing ampersands
// or other escaped entities (which become `&amp;`, `&lt;`, …) still match.
function htmlizeMessage(message: string): string {
    return escapeHtml(message).replace(
        /&quot;(.+?)&quot;/g,
        (_m, name: string) => `"<b>${name}</b>"`,
    );
}

function ok(html: string, switched?: boolean): ManageConversationResult {
    return switched
        ? { kind: "ok", html, switched: true }
        : { kind: "ok", html };
}

function err(html: string): ManageConversationResult {
    return { kind: "error", html };
}

// Adapter exposing the module-level browser-extension RPC state as an
// AgentServerConnection so the shared conversation helpers can drive it.
// Each call resolves the current module-level state at invocation time
// so the helper sees post-reconnect transports instead of stale snapshots
// captured at adapter construction.
function makeConnectionAdapter(): AgentServerConnection {
    if (!serverRpc || !serverChannel || !dispatcherWs) {
        throw new Error("Not connected to agent server.");
    }
    if (dispatcherWs.readyState !== WebSocket.OPEN) {
        throw new Error("Agent server WebSocket is not open.");
    }
    const requireFresh = (): {
        rpc: NonNullable<typeof serverRpc>;
        channel: NonNullable<typeof serverChannel>;
        ws: NonNullable<typeof dispatcherWs>;
    } => {
        if (!serverRpc || !serverChannel || !dispatcherWs) {
            throw new Error("Lost connection to agent server.");
        }
        if (dispatcherWs.readyState !== WebSocket.OPEN) {
            throw new Error("Agent server WebSocket is not open.");
        }
        return {
            rpc: serverRpc,
            channel: serverChannel,
            ws: dispatcherWs,
        };
    };
    const notSupported = async (op: string) => {
        throw new Error(`${op} not supported in browser extension adapter`);
    };
    return {
        joinConversation: (
            _clientIO: ClientIO,
            options?: DispatcherConnectOptions,
        ) => {
            const { ws } = requireFresh();
            return joinConversationDispatcher(
                { filter: false, clientType: "extension", ...(options ?? {}) },
                ws,
            );
        },
        leaveConversation: async (conversationId: string) => {
            const { rpc, channel } = requireFresh();
            try {
                await rpc.invoke("leaveConversation", conversationId);
            } finally {
                channel.deleteChannel(getDispatcherChannelName(conversationId));
                channel.deleteChannel(getClientIOChannelName(conversationId));
            }
        },
        createConversation: (name: string) => {
            const { rpc } = requireFresh();
            return rpc.invoke("createConversation", name);
        },
        listConversations: (name?: string) => {
            const { rpc } = requireFresh();
            return rpc.invoke("listConversations", name);
        },
        renameConversation: (id: string, newName: string) => {
            const { rpc } = requireFresh();
            return rpc.invoke(
                "renameConversation",
                id,
                newName,
            ) as Promise<void>;
        },
        deleteConversation: (id: string) => {
            const { rpc } = requireFresh();
            return rpc.invoke("deleteConversation", id) as Promise<void>;
        },
        shutdown: () => notSupported("shutdown"),
        restart: () => notSupported("restart"),
        getSpeechToken: () => {
            const { rpc } = requireFresh();
            return rpc.invoke("getSpeechToken");
        },
        // In-place rebind reconnect isn't driven through this adapter; the
        // service worker reconnects via its own doConnect path.
        reconnect: async () => false,
        registerClientAgent: () =>
            notSupported("registerClientAgent") as Promise<void>,
        unregisterClientAgent: () =>
            notSupported("unregisterClientAgent") as Promise<void>,
        close: () => notSupported("close"),
    };
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
    payload: HelperPayload,
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
    payload: HelperPayload,
): Promise<ManageConversationResult> {
    if (!serverRpc || !chatPanelClientIO) {
        return err("❌ Not connected to agent server.");
    }
    let adapter: AgentServerConnection;
    try {
        adapter = makeConnectionAdapter();
    } catch (e: any) {
        return err(`❌ ${escapeHtml(e?.message ?? String(e))}`);
    }

    const ctx: ManageConversationContext = {
        currentConversationId: activeConversationId,
        currentConversationName: activeConversationName,
        getCurrentConversationId: () => activeConversationId,
        onSwitched: (joined: ConversationDispatcher) => {
            dispatcher = joined.dispatcher;
            activeConversationId = joined.conversationId;
            activeConversationName = joined.name;
        },
        onCurrentConversationUpdated: (updated) => {
            activeConversationName = updated.name;
        },
        joinOptions: { filter: false, clientType: "extension" },
        // Browser cycle matches its prior UX: newest-first with an error
        // when the current conversation is missing from the list.
        cycleOnCurrentNotInList: "error",
        confirmDestructive: rpcInvoke
            ? async (_action, target) =>
                  (await rpcInvoke!("chatPanelAskYesNo", {
                      message: `Delete conversation '${target.name}'?`,
                      defaultValue: false,
                  })) as boolean
            : // No chat panel → refuse destructive ops rather than silently proceed.
              async () => false,
    };

    const result: ConversationActionResult = await manageConversationHelper(
        adapter,
        chatPanelClientIO,
        ctx,
        payload,
    );

    return renderActionResult(payload, result);
}

function renderActionResult(
    payload: HelperPayload,
    result: ConversationActionResult,
): ManageConversationResult {
    switch (result.kind) {
        case "ok": {
            const switched = result.switched === true;
            const icon =
                payload.subcommand === "new"
                    ? "✅"
                    : payload.subcommand === "rename"
                      ? "✅"
                      : payload.subcommand === "delete"
                        ? "🗑️"
                        : switched
                          ? "🔀"
                          : "";
            const prefix = icon ? `${icon} ` : "";
            return ok(`${prefix}${htmlizeMessage(result.message)}`, switched);
        }
        case "warning":
            return err(htmlizeMessage(result.message));
        case "error":
            return err(`❌ ${htmlizeMessage(result.message)}`);
        case "cancelled":
            return ok("Cancelled.");
        case "info":
            return ok(
                `<b>Current conversation:</b><br>` +
                    `Name: ${escapeHtml(result.name)}<br>` +
                    `<span style="font-family:monospace;font-size:smaller;">${escapeHtml(result.conversationId)}</span>`,
            );
        case "list": {
            const items = result.conversations
                .map((s) => {
                    const cur =
                        s.conversationId === result.currentConversationId
                            ? "▸ "
                            : "";
                    return `<li>${cur}${escapeHtml(s.name)}</li>`;
                })
                .join("");
            return ok(`<ul>${items}</ul>`);
        }
    }
}
