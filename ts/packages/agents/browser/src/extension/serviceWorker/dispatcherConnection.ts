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
import { createDispatcherRpcClient } from "@typeagent/dispatcher-rpc/dispatcher/client";
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
} from "@typeagent/agent-server-protocol";

import registerDebug from "debug";

const debug = registerDebug("typeagent:extension:dispatcher");
const debugErr = registerDebug("typeagent:extension:dispatcher:error");

const DEFAULT_AGENT_SERVER_URL = "ws://localhost:8999";

// Module-level dispatcher state
let dispatcher: Dispatcher | undefined;
let dispatcherWs: WebSocket | undefined;
let connectionPromise: Promise<Dispatcher> | undefined;

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

        const rpc = createRpc<AgentServerInvokeFunctions>(
            "agent-server:extension",
            channel.createChannel(AgentServerChannelName),
        );

        const clientIO = createChatPanelClientIO();

        let resolved = false;

        ws.onopen = () => {
            debug("WebSocket connected to Agent Server");
            const options: DispatcherConnectOptions = {
                filter: true,
                clientType: "extension",
            };
            rpc.invoke("joinConversation", options)
                .then((result: JoinConversationResult) => {
                    debug(
                        "Joined conversation=%s, connectionId=%s",
                        result.conversationId,
                        result.connectionId,
                    );
                    resolved = true;

                    createClientIORpcServer(
                        clientIO,
                        channel.createChannel(
                            getClientIOChannelName(result.conversationId),
                        ),
                    );

                    const d = createDispatcherRpcClient(
                        channel.createChannel(
                            getDispatcherChannelName(result.conversationId),
                        ),
                        result.connectionId,
                    );
                    // Override close to close our WebSocket
                    d.close = async () => {
                        debug("Closing dispatcher WebSocket");
                        ws.close();
                    };
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
}

/**
 * Get the current Dispatcher instance (or undefined if not connected).
 */
export function getDispatcher(): Dispatcher | undefined {
    return dispatcher;
}
