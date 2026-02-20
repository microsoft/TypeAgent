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
} from "@typeagent/agent-server-protocol";

import registerDebug from "debug";

const debug = registerDebug("typeagent:extension:dispatcher");
const debugErr = registerDebug("typeagent:extension:dispatcher:error");

const DEFAULT_AGENT_SERVER_URL = "ws://localhost:8999";

// Module-level dispatcher state
let dispatcher: Dispatcher | undefined;
let dispatcherWs: WebSocket | undefined;
let connectionPromise: Promise<Dispatcher> | undefined;

/**
 * Create a ClientIO that forwards display callbacks to the chat panel.
 * Messages are relayed via chrome.runtime.sendMessage so the side panel
 * view can receive them even though it's in a different execution context.
 */
function createChatPanelClientIO(): ClientIO {
    function send(type: string, data: any) {
        chrome.runtime.sendMessage({ type, ...data }).catch(() => {
            // Chat panel may not be open — that's fine, ignore
        });
    }

    return {
        clear(requestId) {
            send("dispatcher:clear", { requestId });
        },
        exit(requestId) {
            send("dispatcher:exit", { requestId });
        },
        setDisplayInfo(requestId, source, actionIndex, action) {
            send("dispatcher:setDisplayInfo", {
                requestId,
                source,
                actionIndex,
                action,
            });
        },
        setDisplay(message) {
            send("dispatcher:setDisplay", { message });
        },
        appendDisplay(message, mode) {
            send("dispatcher:appendDisplay", { message, mode });
        },
        appendDiagnosticData(requestId, data) {
            // Diagnostic data not shown in extension chat panel
        },
        setDynamicDisplay(
            requestId,
            source,
            actionIndex,
            displayId,
            nextRefreshMs,
        ) {
            send("dispatcher:setDynamicDisplay", {
                requestId,
                source,
                actionIndex,
                displayId,
                nextRefreshMs,
            });
        },

        // Input callbacks — return defaults for now
        async askYesNo(_requestId, _message, defaultValue) {
            return defaultValue ?? true;
        },
        async proposeAction(_requestId, actionTemplates, _source) {
            // Accept the default template
            return undefined;
        },
        async popupQuestion(_message, _choices, defaultId, _source) {
            return defaultId ?? 0;
        },

        notify(notificationId, event, data, source) {
            send("dispatcher:notify", {
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
        takeAction(requestId, action, data) {
            send("dispatcher:takeAction", { requestId, action, data });
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
            channel.createChannel("agent-server" as any),
        );

        const clientIO = createChatPanelClientIO();
        createClientIORpcServer(
            clientIO,
            channel.createChannel("clientio" as any),
        );

        let resolved = false;

        ws.onopen = () => {
            debug("WebSocket connected to Agent Server");
            const options: DispatcherConnectOptions = {
                filter: true,
                clientType: "extension",
            };
            rpc.invoke("join", options)
                .then((connectionId) => {
                    debug("Joined dispatcher, connectionId=%s", connectionId);
                    resolved = true;
                    const d = createDispatcherRpcClient(
                        channel.createChannel("dispatcher" as any),
                        connectionId,
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
            // Broadcast disconnection status
            chrome.runtime
                .sendMessage({
                    type: "dispatcher:connectionStatus",
                    connected: false,
                })
                .catch(() => {});
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
