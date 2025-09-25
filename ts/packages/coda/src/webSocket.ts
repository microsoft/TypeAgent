// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "ws";

export type WebSocketMessage = {
    source: string;
    target: string;
    id?: string;
    messageType: string;
    body: any;
};

export async function createWebSocket(
    channel: string,
    role: string,
    clientId?: string,
) {
    return new Promise<WebSocket | undefined>((resolve, reject) => {
        let endpoint =
            process.env["CODE_WEBSOCKET_HOST"] ?? "ws://localhost:8082";
        endpoint += `?channel=${channel}&role=${role}`;
        if (clientId) {
            endpoint += `clientId=${clientId}`;
        }

        const webSocket = new WebSocket(endpoint);

        webSocket.onopen = (event: object) => {
            console.log("websocket open");
            resolve(webSocket);
        };
        webSocket.onmessage = (event: object) => {};
        webSocket.onclose = (event: object) => {
            console.log("websocket connection closed");
            resolve(undefined);
        };
        webSocket.onerror = (event: object) => {
            console.error("websocket error");
            resolve(undefined);
        };
    });
}

export function keepWebSocketAlive(webSocket: WebSocket) {
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
