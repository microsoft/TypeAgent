// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WebSocketMessageV2,
    keepWebSocketAlive,
} from "websocket-utils";

import WebSocket from "ws";
import { discoverPort } from "@typeagent/agent-server-client/discovery";
import registerDebug from "debug";
const debugBrowserIPC = registerDebug("typeagent:browser:ipc");
const debugBrowserIPCError = registerDebug("typeagent:browser:ipc:error");

const AGENT_SERVER_DEFAULT_URL = "ws://localhost:8999/";

export class BrowserAgentIpc {
    private static instance: BrowserAgentIpc;
    public onMessageReceived: ((message: WebSocketMessageV2) => void) | null;
    public onRpcReply: ((message: any) => void) | null;
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
        this.onRpcReply = null;
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
                this.webSocket = await createInlineBrowserWebSocket();
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
                        const data = JSON.parse(text) as any;

                        // Channel-multiplexed messages: forward agentService replies to renderer
                        if (data.name === "agentService") {
                            if (this.onRpcReply) {
                                this.onRpcReply(data.message);
                            }
                            return;
                        }

                        let schema = (data as WebSocketMessageV2).method?.split(
                            "/",
                        )[0];
                        schema = schema || "browser";

                        // Forward messages for browser, webAgent schemas, and import progress updates
                        if (
                            (schema == "browser" ||
                                schema == "webAgent" ||
                                schema.startsWith("browser.") ||
                                (data as WebSocketMessageV2).method ===
                                    "importProgress") &&
                            this.onMessageReceived
                        ) {
                            debugBrowserIPC("BrowserAgent -> Shell", data);
                            this.onMessageReceived(data as WebSocketMessageV2);
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
        const retryDelay = Math.min(
            1000 * Math.pow(2, this.reconnectAttempts),
            5000,
        );
        this.reconnectAttempts++;

        debugBrowserIPC(
            `Scheduling reconnection attempt in ${retryDelay}ms (attempt ${this.reconnectAttempts})`,
        );

        setTimeout(async () => {
            if (
                this.webSocket &&
                this.webSocket.readyState === WebSocket.OPEN
            ) {
                debugBrowserIPC(
                    "Connection already established, stopping reconnection",
                );
                this.reconnectionPending = false;
                return;
            }

            debugBrowserIPC("Retrying connection");
            await this.ensureWebsocketConnected();

            // reconnection was either successful or attempted
            this.reconnectionPending = false;

            // If still not connected, schedule another attempt
            if (
                !this.webSocket ||
                this.webSocket.readyState !== WebSocket.OPEN
            ) {
                this.reconnectWebSocket();
            }
        }, retryDelay);
    }

    public async send(message: WebSocketMessageV2) {
        const webSocket = await this.ensureWebsocketConnected();
        if (!webSocket) {
            // Queue the message if connection isn't ready yet
            if (this.messageQueue.length < this.maxQueueSize) {
                debugBrowserIPC(
                    "WebSocket not connected, queueing message",
                    message.method,
                );
                this.messageQueue.push(message);

                // Show notification when queueing site agent messages
                if (
                    !this.hasShownRestoringNotification &&
                    (message.method === "enableSiteTranslator" ||
                        message.method === "enableSiteAgent")
                ) {
                    this.hasShownRestoringNotification = true;
                    this.sendRestoringNotification();
                }
            } else {
                debugBrowserIPC(
                    "Message queue full, dropping message",
                    message.method,
                );
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
                "browser-restore-agents",
            );
        }
    }

    public isConnected(): boolean {
        return this.webSocket && this.webSocket.readyState === WebSocket.OPEN;
    }
}

/**
 * Build the inline-browser → agent-server WebSocket URL by discovering the
 * browser agent's port via the agent-server discovery channel, then opening
 * the connection. Mirrors the chrome extension's resolveBrowserEndpoint /
 * createWebSocket flow (see ts/packages/agents/browser/src/extension/
 * serviceWorker/websocket.ts) so both clients of the browser agent reach
 * the same dynamic port.
 *
 * The agent-server discovery URL defaults to ws://localhost:8999/ but can
 * be overridden with WEBSOCKET_HOST for non-default deployments.
 */
async function createInlineBrowserWebSocket(): Promise<WebSocket | undefined> {
    const agentServerUrl =
        process.env["WEBSOCKET_HOST"] || AGENT_SERVER_DEFAULT_URL;
    const sessionId = "default";

    const result = await discoverPort("browser", sessionId, {
        url: agentServerUrl,
    });
    if (result.kind !== "found") {
        if (result.kind === "not-registered") {
            debugBrowserIPC(
                "Browser agent not registered with agent-server at %s",
                agentServerUrl,
            );
        } else {
            debugBrowserIPCError(
                "Agent-server discovery unreachable at %s: %s",
                agentServerUrl,
                result.error.message,
            );
        }
        return undefined;
    }

    let endpoint: string;
    try {
        const u = new URL(agentServerUrl);
        endpoint = `${u.protocol}//${u.hostname}:${result.port}/?channel=browser&role=client&clientId=inlineBrowser&sessionId=${sessionId}`;
    } catch (e) {
        debugBrowserIPCError("Invalid agent-server URL: %s", e);
        return undefined;
    }

    debugBrowserIPC("Connecting inlineBrowser to: %s", endpoint);
    return new Promise<WebSocket | undefined>((resolve) => {
        const ws = new WebSocket(endpoint);
        ws.onopen = () => {
            debugBrowserIPC("inlineBrowser websocket open");
            resolve(ws);
        };
        ws.onerror = (event: any) => {
            debugBrowserIPCError(
                "inlineBrowser websocket error: %s",
                event?.message ?? "unknown",
            );
            resolve(undefined);
        };
        ws.onclose = () => {
            debugBrowserIPC("inlineBrowser websocket closed");
            resolve(undefined);
        };
    });
}