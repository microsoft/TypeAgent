// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "isomorphic-ws";
import registerDebug from "debug";
import findConfig from "find-config";
import dotenv from "dotenv";
import fs from "node:fs";

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
) {
    return new Promise<WebSocket | undefined>((resolve, reject) => {
        let endpoint = `ws://localhost:${port}`;
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

        endpoint += `?channel=${channel}&role=${role}`;
        if (clientId) {
            endpoint += `&clientId=${clientId}`;
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
