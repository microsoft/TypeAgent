// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "ws";
import { createWebSocket, keepWebSocketAlive } from "./webSocket";
import { handleVSCodeActions } from "./handleVSCodeActions";

type WebSocketMessageV2 = {
    id?: string;
    method: string;
    params?: any;
    result?: any;
    error?: {
        code?: number | undefined;
        message: string;
    };
};

let webSocket: WebSocket | undefined = undefined;

async function ensureWebsocketConnected() {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        return;
    }

    webSocket = await createWebSocket("code", "client");
    if (!webSocket) {
        return;
    }

    webSocket.binaryType = "arraybuffer";
    keepWebSocketAlive(webSocket);

    webSocket.onmessage = async (event: any) => {
        const data: WebSocketMessageV2 = arrayBufferToJson(event.data);

        if (data.error) {
            console.error(data.error);
            return;
        }

        if (data.method && data.method.indexOf("/") > 0) {
            const [schema, actionName] = data.method?.split("/");

            if (schema == "code") {
                const message = await handleVSCodeActions({
                    actionName: actionName,
                    parameters: data?.params ?? {},
                });

                webSocket?.send(
                    JSON.stringify({
                        id: data.id,
                        result: message,
                    }),
                );
            }
        }
        console.log(
            `vscode extension websocket client received message: ${JSON.stringify(data, null, 2)}`,
        );
    };

    webSocket.onclose = (event: any) => {
        console.log("websocket connection closed");
        webSocket = undefined;
        reconnectWebSocket();
    };
}

function arrayBufferToJson(arrayBuffer: any) {
    const uint8Array = new Uint8Array(arrayBuffer);

    const textDecoder = new TextDecoder("utf-8");
    const jsonString = textDecoder.decode(uint8Array);

    try {
        const jsonObj = JSON.parse(jsonString);
        return jsonObj;
    } catch (e) {
        console.error("Failed to parse JSON:", e);
        return null;
    }
}

function reconnectWebSocket() {
    const connectionCheckIntervalId = setInterval(async () => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            console.log("Clearing reconnect retry interval");
            clearInterval(connectionCheckIntervalId);
        } else {
            console.log("Retrying connection");
            await ensureWebsocketConnected();
        }
    }, 5 * 1000);
}

export async function initializeWS() {
    await ensureWebsocketConnected();
    if (!webSocket) {
        console.log("Websocket service not found. Will retry in 5 seconds");
        reconnectWebSocket();
    }
}
