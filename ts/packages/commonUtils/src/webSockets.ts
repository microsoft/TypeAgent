// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "isomorphic-ws";
import registerDebug from "debug";
import findConfig from "find-config";
import dotenv from "dotenv";
import fs from "node:fs";

const debug = registerDebug("typeagent:websockets");

export type WebSocketMessage = {
    source: string;
    target: string;
    id?: string;
    messageType: string;
    body: any;
};

export async function createWebSocket() {
    return new Promise<WebSocket | undefined>((resolve, reject) => {
        let endpoint = "ws://localhost:8080";
        if (process.env["WEBSOCKET_HOST"]) {
            endpoint = process.env["WEBSOCKET_HOST"];
        } else {
            const dotEnvPath = findConfig(".env");
            if (dotEnvPath) {
                const vals = dotenv.parse(fs.readFileSync(dotEnvPath));
                if (vals["WEBSOCKET_HOST"]) {
                    endpoint = vals["WEBSOCKET_HOST"];
                }
            }
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
