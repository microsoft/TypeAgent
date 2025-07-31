// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WebSocketMessageV2,
    createWebSocket,
    keepWebSocketAlive,
} from "common-utils";

import WebSocket from "ws";
import registerDebug from "debug";
const debugBrowserIPC = registerDebug("typeagent:browser:ipc");

export class BrowserAgentIpc {
    private static instance: BrowserAgentIpc;
    public onMessageReceived: ((message: WebSocketMessageV2) => void) | null;
    private webSocket: any;

    private constructor() {
        this.webSocket = null;
        this.onMessageReceived = null;
    }

    public static getinstance = (): BrowserAgentIpc => {
        if (!BrowserAgentIpc.instance) {
            BrowserAgentIpc.instance = new BrowserAgentIpc();
        }

        return BrowserAgentIpc.instance;
    };

    public async ensureWebsocketConnected() {
        return new Promise<WebSocket | undefined>(async (resolve) => {
            if (this.webSocket) {
                if (this.webSocket.readyState === WebSocket.OPEN) {
                    resolve(this.webSocket);
                    return;
                }
                try {
                    this.webSocket.close();
                    this.webSocket = undefined;
                } catch {}
            }

            this.webSocket = await createWebSocket(
                "browser",
                "client",
                "inlineBrowser",
            );
            if (!this.webSocket) {
                resolve(undefined);
                return;
            }

            this.webSocket.binaryType = "blob";
            keepWebSocketAlive(this.webSocket, "browser");

            this.webSocket.onmessage = async (event: any) => {
                const text =
                    typeof event.data === "string"
                        ? event.data
                        : await (event.data as Blob).text();
                try {
                    const data = JSON.parse(text) as WebSocketMessageV2;

                    let schema = data.method?.split("/")[0];
                    schema = schema || "browser";

                    if (
                        (schema == "browser" ||
                            schema == "webAgent" ||
                            schema.startsWith("browser.")) &&
                        this.onMessageReceived
                    ) {
                        debugBrowserIPC("Browser -> Dispatcher", data);
                        this.onMessageReceived(data);
                    }
                } catch {}
            };

            this.webSocket.onclose = () => {
                console.log("websocket connection closed");
                this.webSocket = undefined;
                this.reconnectWebSocket();
            };

            resolve(this.webSocket);
        });
    }

    private reconnectWebSocket() {
        const connectionCheckIntervalId = setInterval(async () => {
            if (
                this.webSocket &&
                this.webSocket.readyState === WebSocket.OPEN
            ) {
                console.log("Clearing reconnect retry interval");
                clearInterval(connectionCheckIntervalId);
            } else {
                console.log("Retrying connection");
                await this.ensureWebsocketConnected();
            }
        }, 5 * 1000);
    }

    public async send(message: WebSocketMessageV2) {
        await this.ensureWebsocketConnected();
        debugBrowserIPC("Browser -> Dispatcher", message);
        this.webSocket.send(JSON.stringify(message));
    }
}
