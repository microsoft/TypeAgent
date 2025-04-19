// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { WebSocketMessageV2 } from "common-utils";
import { AppAction, isWebAgentMessageFromDispatcher } from "./types";
import { getSettings } from "./storage";
import { showBadgeError, showBadgeHealthy, showBadgeBusy } from "./ui";
import { runBrowserAction } from "./browserActions";

let webSocket: WebSocket | undefined;
let settings: Record<string, any>;

/**
 * Creates a new WebSocket connection
 * @returns Promise resolving to the WebSocket or undefined
 */
export async function createWebSocket(): Promise<WebSocket | undefined> {
    if (!settings) {
        settings = await getSettings();
    }

    let socketEndpoint = settings.websocketHost ?? "ws://localhost:8080/";

    socketEndpoint += `?channel=browser&role=client&clientId=${chrome.runtime.id}`;
    return new Promise<WebSocket | undefined>((resolve, reject) => {
        const webSocket = new WebSocket(socketEndpoint);
        console.log("Connected to: " + socketEndpoint);

        webSocket.onopen = (event: Event) => {
            console.log("websocket open");
            resolve(webSocket);
        };
        webSocket.onmessage = (event: MessageEvent) => {};
        webSocket.onclose = (event: CloseEvent) => {
            console.log("websocket connection closed");
            resolve(undefined);
        };
        webSocket.onerror = (event: Event) => {
            console.error("websocket error");
            resolve(undefined);
        };
    });
}

/**
 * Ensures a WebSocket connection is established
 * @returns Promise resolving to the WebSocket or undefined
 */
export async function ensureWebsocketConnected(): Promise<
    WebSocket | undefined
> {
    return new Promise<WebSocket | undefined>(async (resolve, reject) => {
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

        webSocket = await createWebSocket();
        if (!webSocket) {
            showBadgeError();
            resolve(undefined);
            return;
        }

        webSocket.binaryType = "blob";
        keepWebSocketAlive(webSocket);

        webSocket.onmessage = async (event: MessageEvent) => {
            const text = await (event.data as Blob).text();
            const data = JSON.parse(text) as WebSocketMessageV2;

            if (data.error) {
                console.error(data.error);
                return;
            }

            if (data.method && data.method.indexOf("/") > 0) {
                const [schema, actionName] = data.method?.split("/");

                if (schema == "browser") {
                    if (actionName == "siteTranslatorStatus") {
                        if (data.params.status == "initializing") {
                            showBadgeBusy();
                            console.log(
                                `Initializing ${data.params.translator}`,
                            );
                        } else if (data.params.status == "initialized") {
                            showBadgeHealthy();
                            console.log(
                                `Finished initializing ${data.params.translator}`,
                            );
                        }
                    } else {
                        const response = await runBrowserAction({
                            actionName: actionName,
                            parameters: data.params,
                        });

                        webSocket?.send(
                            JSON.stringify({
                                id: data.id,
                                result: response,
                            }),
                        );
                    }
                }
            }
            console.log(`Browser websocket client received message: ${text}`);
        };

        webSocket.onclose = (event: CloseEvent) => {
            console.log("websocket connection closed");
            webSocket = undefined;
            showBadgeError();
            if (event.reason !== "duplicate") {
                reconnectWebSocket();
            }
        };

        resolve(webSocket);
    });
}

/**
 * Keeps the WebSocket connection alive with periodic pings
 * @param webSocket The WebSocket to keep alive
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
            console.log("Clearing keepalive retry interval");
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
            console.log("Clearing reconnect retry interval");
            clearInterval(connectionCheckIntervalId);
            showBadgeHealthy();
        } else {
            console.log("Retrying connection");
            await ensureWebsocketConnected();
        }
    }, 5 * 1000);
}

/**
 * Sends an action to the agent
 * @param action The action to send
 * @returns Promise resolving to the result or undefined
 */
export async function sendActionToAgent(
    action: AppAction,
): Promise<any | undefined> {
    return new Promise<any | undefined>((resolve, reject) => {
        if (webSocket) {
            try {
                const callId = new Date().getTime().toString();

                webSocket.send(
                    JSON.stringify({
                        id: callId,
                        method: action.actionName,
                        params: action.parameters,
                    }),
                );

                const handler = async (event: MessageEvent) => {
                    const text = await (event.data as Blob).text();
                    const data = JSON.parse(text);
                    if (data.id == callId && data.result) {
                        webSocket!.removeEventListener("message", handler);
                        resolve(data.result);
                    }
                };

                webSocket.addEventListener("message", handler);
            } catch {
                console.log("Unable to contact agent backend.");
                reject("Unable to contact agent backend.");
            }
        } else {
            throw new Error("No websocket connection.");
        }
    });
}

/**
 * Gets the current WebSocket instance
 * @returns The WebSocket instance or null
 */
export function getWebSocket(): WebSocket | undefined {
    return webSocket;
}

/**
 * Sets the WebSocket instance
 * @param socket The WebSocket instance
 */
export function setWebSocket(socket: WebSocket | undefined): void {
    webSocket = socket;
}

/**
 * Gets the current settings
 * @returns The settings
 */
export function getCurrentSettings(): Record<string, any> {
    return settings;
}

/**
 * Sets the current settings
 * @param newSettings The new settings
 */
export function setCurrentSettings(newSettings: Record<string, any>): void {
    settings = newSettings;
}
