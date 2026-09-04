// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "ws";
import { createWebSocket, keepWebSocketAlive } from "./webSocket";
import { handleVSCodeActions } from "./handleVSCodeActions";
import {
    cancelWorkspaceCommands,
    isWorkspaceCommandAction,
    workspaceCommandError,
} from "./handleWorkBenchActions";

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

async function handleActionMessage(data: WebSocketMessageV2): Promise<void> {
    const [schema, actionName] = data.method.split("/");
    if (schema !== "code") {
        return;
    }
    try {
        const message = await handleVSCodeActions({
            actionName,
            parameters: data.params ?? {},
        });
        webSocket?.send(
            JSON.stringify({
                id: data.id,
                result: message,
            }),
        );
    } catch (error) {
        console.error("Error handling websocket action:", error);
        const message = error instanceof Error ? error.message : String(error);
        const executionId = data.params?.executionId;
        webSocket?.send(
            JSON.stringify({
                id: data.id,
                result: isWorkspaceCommandAction(actionName)
                    ? workspaceCommandError(
                          message,
                          typeof executionId === "string" &&
                              executionId.length > 0
                              ? executionId
                              : undefined,
                      )
                    : { handled: false, message },
            }),
        );
    }
}

async function ensureWebsocketConnected() {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        return;
    }

    webSocket = await createWebSocket("code", "client");
    if (!webSocket) {
        return;
    }

    webSocket.binaryType = "nodebuffer";
    keepWebSocketAlive(webSocket);

    webSocket.onmessage = async (event: any) => {
        if (!event.data) {
            return;
        }

        let data: WebSocketMessageV2;
        try {
            // Handle both string and ArrayBuffer data
            if (typeof event.data === "string") {
                data = JSON.parse(event.data);
            } else {
                data = arrayBufferToJson(event.data);
            }
        } catch (error) {
            console.error("Error parsing websocket message:", error);
            return;
        }

        if (!data) {
            return;
        }

        if (data.error) {
            console.error(data.error);
            return;
        }

        if (data.method !== undefined && data.method === "code/ping") {
            webSocket?.send(
                JSON.stringify({
                    id: data.id,
                    result: "pong",
                }),
            );
            return;
        }

        if (data.method !== undefined && data.method.indexOf("/") > 0) {
            // Only a workspace command runs long enough to block the message
            // loop, and it must not: cancellation has to reach the extension
            // while it runs. Every other action stays awaited so action
            // ordering is preserved.
            if (data.method === "code/runWorkspaceCommand") {
                void handleActionMessage(data);
            } else {
                await handleActionMessage(data);
            }
        }
        console.log(
            `vscode extension websocket client received message: ${JSON.stringify(data, null, 2)}`,
        );
    };

    webSocket.onclose = (event: any) => {
        console.log("websocket connection closed");
        cancelWorkspaceCommands();
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

// Single in-flight reconnect interval. Pre-discovery code path spawned
// a new setInterval each time reconnect was called (from initializeWS
// and from every onclose); on rapid disconnects that leaked one
// interval per disconnect, all racing to call ensureWebsocketConnected.
// Guard with a module-scoped handle so only one timer is alive at a time.
let reconnectIntervalId: ReturnType<typeof setInterval> | undefined;

function reconnectWebSocket() {
    if (reconnectIntervalId !== undefined) {
        return;
    }
    reconnectIntervalId = setInterval(async () => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            console.log("Clearing reconnect retry interval");
            clearInterval(reconnectIntervalId);
            reconnectIntervalId = undefined;
        } else {
            console.log("Retrying connection");
            // Re-runs the discovery handshake — important because the
            // code agent's port can change across agent-server
            // restarts (now that it binds to an OS-assigned port).
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
