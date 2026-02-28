// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WebSocketMessageV2,
    createWebSocket,
    keepWebSocketAlive,
} from "websocket-utils";

import WebSocket from "ws";
import registerDebug from "debug";
const debugBrowserIPC = registerDebug("typeagent:browser:ipc");

export class BrowserAgentIpc {
    private static instance: BrowserAgentIpc;
    public onMessageReceived: ((message: WebSocketMessageV2) => void) | null;
    public onSendNotification: ((message: string, id: string) => void) | null;
    private webSocket: any;
    private reconnectionPending: boolean = false;
    private webSocketPromise: Promise<WebSocket | undefined> | null = null;
    private messageQueue: WebSocketMessageV2[] = [];
    private maxQueueSize: number = 100;
    private reconnectAttempts: number = 0;
    private hasShownRestoringNotification: boolean = false;

    private constructor() {
        this.webSocket = null;
        this.onMessageReceived = null;
        this.onSendNotification = null;
    }

    public static getinstance = (): BrowserAgentIpc => {
        if (!BrowserAgentIpc.instance) {
            BrowserAgentIpc.instance = new BrowserAgentIpc();
        }

        return BrowserAgentIpc.instance;
    };

    public async ensureWebsocketConnected(): Promise<WebSocket | undefined> {
        // if there's a pending websocket promise, return it
        if (this.webSocketPromise) {
            return this.webSocketPromise;
        }

        if (this.webSocket) {
            if (this.webSocket.readyState === WebSocket.OPEN) {
                return this.webSocket;
            }
            try {
                this.webSocket.close();
                this.webSocket = undefined;
            } catch {}
        }

        //create a new promise to establish the websocket connection
        this.webSocketPromise = new Promise<WebSocket | undefined>(
            async (resolve) => {
                this.webSocket = await createWebSocket(
                    "browser",
                    "client",
                    "inlineBrowser",
                    8081,
                );
                if (!this.webSocket) {
                    this.webSocketPromise = null;
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

                        // Forward messages for browser, webAgent schemas, and import progress updates
                        if (
                            (schema == "browser" ||
                                schema == "webAgent" ||
                                schema.startsWith("browser.") ||
                                data.method === "crosswordSchemaExtracted" ||
                                data.method === "importProgress") &&
                            this.onMessageReceived
                        ) {
                            debugBrowserIPC("BrowserAgent -> Shell", data);
                            this.onMessageReceived(data);
                        }
                    } catch {}
                };

                this.webSocket.onclose = () => {
                    debugBrowserIPC("websocket connection closed");
                    this.webSocket = undefined;
                    this.reconnectWebSocket();
                };

                this.webSocketPromise = null;

                // Reset reconnection attempts on successful connection
                this.reconnectAttempts = 0;

                // Flush any queued messages
                this.flushMessageQueue();

                resolve(this.webSocket);
            },
        );

        return this.webSocketPromise;
    }

    private flushMessageQueue(): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        debugBrowserIPC(`Flushing ${this.messageQueue.length} queued messages`);
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            if (message) {
                try {
                    debugBrowserIPC("Browser -> Dispatcher (queued)", message);
                    this.webSocket.send(JSON.stringify(message));
                } catch (error) {
                    debugBrowserIPC("Failed to send queued message", error);
                }
            }
        }

        // Reset notification flag after flushing queue
        this.hasShownRestoringNotification = false;
    }

    private reconnectWebSocket() {
        // if there is a reconnection pending just return
        if (this.reconnectionPending) {
            return;
        }

        // indicate a reconnection attempt is pending
        this.reconnectionPending = true;

        // Use exponential backoff: start at 1s, double each time, cap at 5s
        // Attempts: 1s, 2s, 4s, 5s, 5s, 5s...
        const retryDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 5000);
        this.reconnectAttempts++;

        debugBrowserIPC(`Scheduling reconnection attempt in ${retryDelay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(async () => {
            if (
                this.webSocket &&
                this.webSocket.readyState === WebSocket.OPEN
            ) {
                debugBrowserIPC("Connection already established, stopping reconnection");
                this.reconnectionPending = false;
                return;
            }

            debugBrowserIPC("Retrying connection");
            await this.ensureWebsocketConnected();

            // reconnection was either successful or attempted
            this.reconnectionPending = false;

            // If still not connected, schedule another attempt
            if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
                this.reconnectWebSocket();
            }
        }, retryDelay);
    }

    public async send(message: WebSocketMessageV2) {
        const webSocket = await this.ensureWebsocketConnected();
        if (!webSocket) {
            // Queue the message if connection isn't ready yet
            if (this.messageQueue.length < this.maxQueueSize) {
                debugBrowserIPC("WebSocket not connected, queueing message", message.method);
                this.messageQueue.push(message);

                // Show notification when queueing site agent messages
                if (!this.hasShownRestoringNotification &&
                    (message.method === "enableSiteTranslator" ||
                     message.method === "enableSiteAgent")) {
                    this.hasShownRestoringNotification = true;
                    this.sendRestoringNotification();
                }
            } else {
                debugBrowserIPC("Message queue full, dropping message", message.method);
            }
            return;
        }
        debugBrowserIPC("Browser -> Dispatcher", message);
        webSocket.send(JSON.stringify(message));
    }

    private sendRestoringNotification(): void {
        if (this.onSendNotification) {
            this.onSendNotification(
                "Restoring site-specific agents...",
                "browser-restore-agents"
            );
        }
    }

    public isConnected(): boolean {
        return this.webSocket && this.webSocket.readyState === WebSocket.OPEN;
    }
}
