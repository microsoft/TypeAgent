// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { AppAction } from "./types";
import { getSettings } from "./storage";
import { showBadgeError, showBadgeHealthy } from "./ui";
import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { discoverPort } from "@typeagent/agent-server-client/discovery";
import { AGENT_SERVER_DEFAULT_URL } from "@typeagent/agent-server-protocol";
import { createExternalBrowserServer } from "./externalBrowserControlServer";
import type {
    BrowserAgentInvokeFunctions,
    BrowserAgentCallFunctions,
} from "@typeagent/browser-control-rpc/serviceTypes";
import { broadcastEvent } from "./extensionEventHelpers";

import registerDebug from "debug";
const debugWebSocket = registerDebug("typeagent:browser:ws");
const debugWebSocketError = registerDebug("typeagent:browser:ws:error");

let webSocket: WebSocket | undefined;
let connectionInProgress: boolean = false;
let channelProvider: ChannelProviderAdapter | undefined;
let agentRpc: any | undefined;
// Module-level guard so concurrent reconnect requests share a single
// retry interval. Without this each `webSocket.onclose` triggers a
// fresh `setInterval`, leaking timers and causing exponential retry
// pressure under sustained connectivity loss.
let reconnectTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Gets the agentRpc client for invoking agent-side operations.
 * Replaces the legacy sendActionToAgent() function.
 */
export function getAgentRpc(): any | undefined {
    return agentRpc;
}

/**
 * Broadcasts WebSocket connection status changes to all extension pages
 */
function broadcastConnectionStatus(connected: boolean): void {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
            if (tab.url?.startsWith("chrome-extension://")) {
                chrome.tabs
                    .sendMessage(tab.id!, {
                        type: "connectionStatusChanged",
                        connected: connected,
                        timestamp: Date.now(),
                    })
                    .catch(() => {});
            }
        });
    });

    broadcastEvent("connectionStatusChanged", {
        connected,
        timestamp: Date.now(),
    });
}

async function parseWebSocketData(data: any): Promise<string> {
    if (typeof data === "string") {
        return data;
    } else if (data instanceof Blob) {
        return data.text();
    } else if (data instanceof ArrayBuffer) {
        return new TextDecoder().decode(data);
    }
    console.warn("Unknown message type:", typeof data);
    return "";
}

/**
 * Resolves the URL of the browser agent's WebSocket server by asking
 * the agent-server's discovery channel for the live port.
 *
 * The agent-server URL itself is configurable via the `agentServerHost`
 * extension setting (default `ws://localhost:8999/`). Returns
 * `undefined` if the agent-server is unreachable or the browser agent
 * isn't currently registered — caller treats both as "retry on the
 * reconnect loop".
 */
async function resolveBrowserEndpoint(
    sessionId: string,
): Promise<string | undefined> {
    // Always re-read settings here (no module-level cache). The previous
    // implementation cached settings on first connect and never
    // invalidated, so a user changing `agentServerHost` would still see
    // the old endpoint until the service worker restarted.
    const settings = await getSettings();
    const agentServerUrl =
        (settings.agentServerHost && settings.agentServerHost.trim()) ||
        AGENT_SERVER_DEFAULT_URL;

    const result = await discoverPort("browser", "default", {
        url: agentServerUrl,
    });
    if (result.kind === "found") {
        const query = `channel=browser&role=client&clientId=${chrome.runtime.id}&sessionId=${sessionId}`;
        // A discovered remote (tunnel) URL takes precedence; append our query.
        if (result.url) {
            const sep = result.url.includes("?") ? "&" : "?";
            return `${result.url}${sep}${query}`;
        }
        // Otherwise the browser agent's WS server binds to the same host as the
        // agent-server (single-process), so we reuse the host portion of
        // agentServerUrl and swap in the discovered port.
        try {
            const u = new URL(agentServerUrl);
            return `${u.protocol}//${u.hostname}:${result.port}/?${query}`;
        } catch (e) {
            debugWebSocketError("Invalid agentServerHost URL: %s", e);
            return undefined;
        }
    }
    if (result.kind === "not-registered") {
        debugWebSocket(
            "Browser agent not registered with agent-server at %s",
            agentServerUrl,
        );
    } else {
        debugWebSocketError(
            "Agent-server discovery unreachable at %s: %s",
            agentServerUrl,
            result.error.message,
        );
    }
    return undefined;
}

/**
 * Creates a new WebSocket connection
 */
export async function createWebSocket(): Promise<WebSocket | undefined> {
    const settings = await getSettings();
    const sessionId = (settings.sessionId as string) ?? "default";
    const socketEndpoint = await resolveBrowserEndpoint(sessionId);
    if (!socketEndpoint) {
        return undefined;
    }
    return new Promise<WebSocket | undefined>((resolve) => {
        const webSocket = new WebSocket(socketEndpoint);
        debugWebSocket("Connecting to: " + socketEndpoint);

        webSocket.onopen = (_event: Event) => {
            debugWebSocket("websocket open");
            resolve(webSocket);
        };
        webSocket.onmessage = (_event: MessageEvent) => {};
        webSocket.onclose = (_event: CloseEvent) => {
            debugWebSocket("websocket connection closed");
            resolve(undefined);
        };
        webSocket.onerror = (_event: Event) => {
            debugWebSocketError("websocket error");
            resolve(undefined);
        };
    });
}

/**
 * Ensures a WebSocket connection is established
 */
export async function ensureWebsocketConnected(): Promise<
    WebSocket | undefined
> {
    return new Promise<WebSocket | undefined>(async (resolve, _reject) => {
        if (connectionInProgress) {
            debugWebSocket("Connection attempt already in progress, skipping");
            resolve(webSocket);
            return;
        }

        if (webSocket) {
            if (webSocket.readyState === WebSocket.OPEN) {
                resolve(webSocket);
                return;
            }
            try {
                webSocket.close();
                webSocket = undefined;
            } catch {}
        }

        connectionInProgress = true;
        webSocket = await createWebSocket();
        connectionInProgress = false;
        if (!webSocket) {
            showBadgeError();
            broadcastConnectionStatus(false);
            resolve(undefined);
            return;
        }

        webSocket.binaryType = "blob";
        keepWebSocketAlive(webSocket);
        broadcastConnectionStatus(true);

        // Create channel provider for multiplexing over this WebSocket
        channelProvider = createChannelProviderAdapter(
            "browser:agent",
            (message: any) => {
                if (webSocket && webSocket.readyState === WebSocket.OPEN) {
                    webSocket.send(JSON.stringify(message));
                }
            },
        );

        // Browser control channel
        const browserControlChannel =
            channelProvider.createChannel("browserControl");
        createExternalBrowserServer(browserControlChannel);

        // Agent service RPC client (replaces sendActionToAgent). Created once
        // as a rebindable rpc and re-pointed at the fresh channel on each
        // reconnect, so the cached reference survives socket drops.
        const agentServiceChannel =
            channelProvider.createChannel("agentService");
        if (agentRpc) {
            agentRpc.rebind(agentServiceChannel);
        } else {
            agentRpc = createRpc<
                BrowserAgentInvokeFunctions,
                BrowserAgentCallFunctions
            >(
                "browser:agentService",
                agentServiceChannel,
                undefined, // no invoke handlers — we're the client
                {
                    // Call handlers for fire-and-forget events from agent
                    importProgress(params: {
                        importId: string;
                        progress: any;
                    }) {
                        broadcastEvent("importProgress", {
                            importId: params.importId,
                            progress: params.progress,
                        });
                    },
                    knowledgeExtractionProgress(params: {
                        extractionId: string;
                        progress: any;
                    }) {
                        import("./messageHandlers")
                            .then(({ handleKnowledgeExtractionProgress }) => {
                                handleKnowledgeExtractionProgress(
                                    params.extractionId,
                                    params.progress,
                                );
                            })
                            .catch((error) => {
                                console.error(
                                    "Failed to handle knowledge extraction progress:",
                                    error,
                                );
                            });
                    },
                },
                { rebindable: true },
            );
        }

        // Capture this connection's socket + provider so a stale onclose from a
        // superseded socket can't tear down a newer connection, and a late
        // message routes to its own provider.
        const activeSocket = webSocket;
        const activeChannelProvider = channelProvider;

        activeSocket.onmessage = async (event: MessageEvent) => {
            const text = await parseWebSocketData(event.data);
            if (!text) return;

            const data = JSON.parse(text);

            // All messages should be channel-multiplexed format
            if (data.name !== undefined) {
                activeChannelProvider.notifyMessage(data);
                return;
            }

            if (data.error) {
                debugWebSocketError(data.error);
            }
        };

        activeSocket.onclose = (event: CloseEvent) => {
            debugWebSocket("websocket connection closed");
            activeChannelProvider.notifyDisconnected();
            // Ignore a stale onclose once a newer connect has superseded us.
            if (webSocket !== activeSocket) {
                return;
            }
            webSocket = undefined;
            channelProvider = undefined;
            // agentRpc is rebindable and kept across reconnects: the
            // notifyDisconnected() above rejects its in-flight calls without
            // poisoning it, and the next connect rebinds it to a fresh channel.
            showBadgeError();
            broadcastConnectionStatus(false);
            if (event.reason !== "duplicate") {
                reconnectWebSocket();
            }
        };

        resolve(webSocket);
    });
}

/**
 * Keeps the WebSocket connection alive with periodic pings
 */
export function keepWebSocketAlive(webSocket: WebSocket): void {
    const keepAliveIntervalId = setInterval(() => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            webSocket.send(
                JSON.stringify({
                    method: "keepAlive",
                    params: {},
                }),
            );
        } else {
            debugWebSocket("Clearing keepalive retry interval");
            clearInterval(keepAliveIntervalId);
        }
    }, 20 * 1000);
}

/**
 * Attempts to reconnect the WebSocket periodically. Singleton — repeated
 * calls (e.g., from successive `onclose` handlers under flapping
 * connectivity) reuse the same retry interval rather than each
 * scheduling a fresh one.
 */
export function reconnectWebSocket(): void {
    if (reconnectTimer !== undefined) {
        debugWebSocket("Reconnect interval already running");
        return;
    }
    reconnectTimer = setInterval(async () => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            debugWebSocket("Clearing reconnect retry interval");
            if (reconnectTimer !== undefined) {
                clearInterval(reconnectTimer);
                reconnectTimer = undefined;
            }
            showBadgeHealthy();
            broadcastConnectionStatus(true);
        } else {
            debugWebSocket("Retrying connection");
            await ensureWebsocketConnected();
        }
    }, 5 * 1000);
}

/**
 * Sends an action to the agent via agentRpc.
 */
export async function sendActionToAgent(
    action: AppAction,
): Promise<any | undefined> {
    if (!agentRpc) {
        throw new Error(
            "No agent RPC connection. Ensure WebSocket is connected.",
        );
    }
    const methodName = action.actionName as keyof BrowserAgentInvokeFunctions;
    return agentRpc.invoke(methodName, action.parameters);
}

/**
 * Gets the current WebSocket instance
 */
export function getWebSocket(): WebSocket | undefined {
    return webSocket;
}

/**
 * Sets the WebSocket instance
 */
export function setWebSocket(socket: WebSocket | undefined): void {
    webSocket = socket;
}
