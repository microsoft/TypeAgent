// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "isomorphic-ws";
import registerDebug from "debug";
import { loadConfigSync } from "@typeagent/config";

const debug = registerDebug("typeagent:websockets");

export type WebSocketMessageV2 = {
    id?: string;
    method: string;
    params?: any;
    result?: any;
    error?: {
        code?: number | undefined;
        message: string;
    };
    source?: string;
};

export async function createWebSocket(
    channel: string,
    role: "dispatcher" | "client",
    clientId?: string,
    port: number = 8081,
    sessionId?: string,
) {
    return new Promise<WebSocket | undefined>((resolve, reject) => {
        let endpoint = `ws://localhost:${port}`;
        loadConfigSync();
        if (process.env["WEBSOCKET_HOST"]) {
            endpoint = process.env["WEBSOCKET_HOST"];
        }

        endpoint += `?channel=${channel}&role=${role}`;
        if (clientId) {
            endpoint += `&clientId=${clientId}`;
        }
        if (sessionId) {
            endpoint += `&sessionId=${sessionId}`;
        }

        const webSocket = new WebSocket(endpoint);

        webSocket.onopen = (event: object) => {
            debug("websocket open");
            resolve(webSocket);
        };
        webSocket.onmessage = (event: object) => {};
        webSocket.onclose = (event: object) => {
            debug("websocket connection closed");
            resolve(undefined);
        };
        webSocket.onerror = (event: object) => {
            debug("websocket error");
            resolve(undefined);
        };
    });
}

export function keepWebSocketAlive(webSocket: WebSocket, source: string) {
    const keepAliveIntervalId = setInterval(() => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            webSocket.send(
                JSON.stringify({
                    source: `${source}`,
                    target: "none",
                    messageType: "keepAlive",
                    body: {},
                }),
            );
        } else {
            debug("Clearing keepalive retry interval");
            clearInterval(keepAliveIntervalId);
        }
    }, 20 * 1000);
}
