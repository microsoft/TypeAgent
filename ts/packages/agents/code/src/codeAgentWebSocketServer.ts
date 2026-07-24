// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketServer, WebSocket } from "ws";
import { AddressInfo } from "net";
import registerDebug from "debug";
import { isAllowedAgentOrigin } from "./originAllowlist.js";
import { attachHeartbeat } from "@typeagent/websocket-channel-server";

const debug = registerDebug("typeagent:code:websocket");

export class CodeAgentWebSocketServer {
    private clients: Map<string, WebSocket> = new Map();
    private clientIdCounter = 0;
    private readonly stopHeartbeat: () => void;
    public onMessage?: (message: string) => void;
    /**
     * Fired after the {@link clients} map mutation completes for any
     * connect / disconnect, with the post-mutation total. Used by the
     * code agent to push counts up via `SessionContext.notifyClientCountChanged`
     * so `@system ports` can surface them. NOTE: code's WS protocol
     * has no session identity, so this count is global across every
     * session sharing the bound port — not per-session.
     */
    public onClientCountChanged?: (count: number) => void;

    /**
     * @param server the underlying ws server, already bound and listening.
     * @param port  the actually bound port (OS-assigned when the caller
     *              passed 0).
     *
     * Construction is private — use {@link CodeAgentWebSocketServer.start}
     * so callers always get a server that is guaranteed to be bound
     * before they read {@link port} or pass it to the registrar.
     */
    private constructor(
        private readonly server: WebSocketServer,
        public readonly port: number,
    ) {
        this.setupHandlers();
        this.stopHeartbeat = attachHeartbeat(server);
        debug(`CodeAgentWebSocketServer listening on port ${port}`);
    }

    /**
     * Bind a new server on `port`. Resolves only after the
     * `listening` event so callers can synchronously read
     * {@link port}; rejects on the first `error` event so bind
     * failures (EADDRINUSE under fixed-port overrides) surface
     * loudly instead of being swallowed by an attached error
     * handler.
     *
     * Pass `0` to let the OS pick a free ephemeral port; the
     * actual port is then available via {@link port}.
     */
    public static start(port: number = 0): Promise<CodeAgentWebSocketServer> {
        return new Promise((resolve, reject) => {
            const server = new WebSocketServer({
                port,
                // Gate every upgrade on Origin so a random web page on
                // the same host can't dial the ephemeral port assigned
                // by the OS. `verifyClient` is invoked synchronously
                // before the `connection` event fires; rejected requests
                // get HTTP 403.
                verifyClient: (info, cb) => {
                    const origin = info.req.headers.origin as
                        | string
                        | undefined;
                    if (isAllowedAgentOrigin(origin)) {
                        cb(true);
                    } else {
                        debug(`Rejecting WS upgrade from origin ${origin}`);
                        cb(false, 403, "Origin not allowed");
                    }
                },
            });
            let settled = false;
            const onError = (error: Error) => {
                if (settled) {
                    debug("Server error after listening:", error);
                    return;
                }
                settled = true;
                server.removeListener("listening", onListening);
                debug("Server bind error:", error);
                reject(error);
            };
            const onListening = () => {
                if (settled) return;
                settled = true;
                server.removeListener("error", onError);
                const address = server.address() as AddressInfo | null;
                if (!address || typeof address === "string") {
                    server.close();
                    reject(
                        new Error(
                            "ws server.address() did not return an AddressInfo",
                        ),
                    );
                    return;
                }
                // Re-attach a permanent error handler so post-listen errors
                // are logged rather than crashing the process.
                server.on("error", (error) => {
                    debug("Server error:", error);
                });
                resolve(new CodeAgentWebSocketServer(server, address.port));
            };
            server.once("error", onError);
            server.once("listening", onListening);
        });
    }

    private setupHandlers(): void {
        this.server.on("connection", (ws: WebSocket) => {
            const clientId = `client-${++this.clientIdCounter}-${Date.now()}`;
            debug("New client connected");
            this.clients.set(clientId, ws);
            this.onClientCountChanged?.(this.clients.size);

            // Store client ID on the WebSocket for reference
            (ws as any).clientId = clientId;

            ws.on("message", (message: Buffer) => {
                const messageStr = message.toString();
                if (this.onMessage) {
                    this.onMessage(messageStr);
                }
            });

            ws.on("close", () => {
                debug("Client disconnected");
                this.clients.delete(clientId);
                this.onClientCountChanged?.(this.clients.size);
            });

            ws.on("error", (error) => {
                debug("Client error:", error);
                if (this.clients.delete(clientId)) {
                    this.onClientCountChanged?.(this.clients.size);
                }
            });
        });
    }

    public broadcast(message: string): number {
        let successCount = 0;
        const clientsToRemove: string[] = [];

        for (const [clientId, client] of this.clients.entries()) {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                    successCount++;
                } catch (error) {
                    debug("Failed to send to client:", error);
                    clientsToRemove.push(clientId);
                }
            } else {
                clientsToRemove.push(clientId);
            }
        }

        // Remove failed clients
        clientsToRemove.forEach((clientId) => this.clients.delete(clientId));

        return successCount;
    }

    public isConnected(): boolean {
        for (const [, client] of this.clients.entries()) {
            if (client.readyState === WebSocket.OPEN) {
                return true;
            }
        }
        return false;
    }

    public getConnectedCount(): number {
        let count = 0;
        for (const [, client] of this.clients.entries()) {
            if (client.readyState === WebSocket.OPEN) {
                count++;
            }
        }
        return count;
    }

    public getClients(): Map<string, WebSocket> {
        return new Map(this.clients);
    }

    public getClientStates(): string[] {
        const states: string[] = [];
        for (const [clientId, client] of this.clients.entries()) {
            const state =
                client.readyState === WebSocket.OPEN
                    ? "OPEN"
                    : client.readyState === WebSocket.CONNECTING
                      ? "CONNECTING"
                      : client.readyState === WebSocket.CLOSING
                        ? "CLOSING"
                        : "CLOSED";
            states.push(`${clientId}: ${state}`);
        }
        return states;
    }

    /**
     * Close all client connections and the underlying server.
     * Resolves when the server has fully released its port — important
     * for a rapid disable→enable cycle under a fixed-port override
     * (`CODE_WEBSOCKET_PORT`), where a synchronous return would race
     * the new bind into EADDRINUSE.
     */
    public close(): Promise<void> {
        debug("Closing CodeAgentWebSocketServer");
        this.stopHeartbeat();
        for (const [, client] of this.clients.entries()) {
            if (client.readyState === WebSocket.OPEN) {
                client.close();
            }
        }
        this.clients.clear();
        return new Promise((resolve) => {
            this.server.close(() => resolve());
        });
    }
}
