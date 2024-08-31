// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "ws";
import { createWebSocket, keepWebSocketAlive } from "./webSocket";
import { handleVSCodeActions } from "./handleCodeEditorActions";

type WebSocketMessage = {
    source: string;
    target: string;
    id?: string;
    messageType: string;
    body: any;
};

let webSocket: WebSocket | undefined = undefined;

async function ensureWebsocketConnected() {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        return;
    }

    webSocket = await createWebSocket();
    if (!webSocket) {
        return;
    }

    webSocket.binaryType = "arraybuffer";
    keepWebSocketAlive(webSocket, "code");

    webSocket.onmessage = async (event: any) => {
        const data: WebSocketMessage = arrayBufferToJson(event.data);
        if (data.target == "code" && data.messageType == "translatedAction") {
            const message = await handleVSCodeActions(data.body.action);
            webSocket?.send(
                JSON.stringify({
                    source: data.target,
                    target: data.source,
                    messageType: "confirmAction",
                    id: data.id,
                    body: {
                        callId: data.body.callId,
                        message,
                    },
                }),
            );
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
