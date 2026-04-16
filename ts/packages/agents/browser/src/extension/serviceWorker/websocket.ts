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
import { createExternalBrowserServer } from "./externalBrowserControlServer";
import type {
    BrowserAgentInvokeFunctions,
    BrowserAgentCallFunctions,
} from "../../common/serviceTypes.mjs";
import { broadcastEvent } from "./extensionEventHelpers";

import registerDebug from "debug";
const debugWebSocket = registerDebug("typeagent:browser:ws");
const debugWebSocketError = registerDebug("typeagent:browser:ws:error");

let webSocket: WebSocket | undefined;
let settings: Record<string, any>;
let connectionInProgress: boolean = false;
let channelProvider: ChannelProviderAdapter | undefined;
let agentRpc: any | undefined;

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
 * Creates a new WebSocket connection
 */
export async function createWebSocket(): Promise<WebSocket | undefined> {
    if (!settings) {
        settings = await getSettings();
    }

    let socketEndpoint = settings.websocketHost ?? "ws://localhost:8081/";

    const sessionId = settings.sessionId ?? "default";
    socketEndpoint += `?channel=browser&role=client&clientId=${chrome.runtime.id}&sessionId=${sessionId}`;
    return new Promise<WebSocket | undefined>((resolve, reject) => {
        const webSocket = new WebSocket(socketEndpoint);
        debugWebSocket("Connected to: " + socketEndpoint);

        webSocket.onopen = (event: Event) => {
            debugWebSocket("websocket open");
            resolve(webSocket);
        };
        webSocket.onmessage = (event: MessageEvent) => {};
        webSocket.onclose = (event: CloseEvent) => {
            debugWebSocket("websocket connection closed");
            resolve(undefined);
        };
        webSocket.onerror = (event: Event) => {
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
    return new Promise<WebSocket | undefined>(async (resolve, reject) => {
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

        // Agent service RPC client (replaces sendActionToAgent)
        const agentServiceChannel =
            channelProvider.createChannel("agentService");
        agentRpc = createRpc<
            BrowserAgentInvokeFunctions,
            BrowserAgentCallFunctions
        >(
            "browser:agentService",
            agentServiceChannel,
            undefined, // no invoke handlers — we're the client
            {
                // Call handlers for fire-and-forget events from agent
                importProgress(params: { importId: string; progress: any }) {
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
        );

        webSocket.onmessage = async (event: MessageEvent) => {
            const text = await parseWebSocketData(event.data);
            if (!text) return;

            const data = JSON.parse(text);

            // All messages should be channel-multiplexed format
            if (data.name !== undefined) {
                channelProvider!.notifyMessage(data);
                return;
            }

            if (data.error) {
                debugWebSocketError(data.error);
            }
        };

        webSocket.onclose = (event: CloseEvent) => {
            debugWebSocket("websocket connection closed");
            if (channelProvider) {
                channelProvider.notifyDisconnected();
            }
            webSocket = undefined;
            channelProvider = undefined;
            agentRpc = undefined;
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
 * Attempts to reconnect the WebSocket periodically
 */
export function reconnectWebSocket(): void {
    const connectionCheckIntervalId = setInterval(async () => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            debugWebSocket("Clearing reconnect retry interval");
            clearInterval(connectionCheckIntervalId);
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

/**
 * Gets the current settings
 */
export function getCurrentSettings(): Record<string, any> {
    return settings;
}

/**
 * Sets the current settings
 */
export function setCurrentSettings(newSettings: Record<string, any>): void {
    settings = newSettings;
}
