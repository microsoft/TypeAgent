// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:agent-ws");

export interface BrowserClient {
    id: string;
    type: 'extension' | 'electron';
    socket: WebSocket;
    connectedAt: Date;
    lastActivity: Date;
}

export class AgentWebSocketServer {
    private server: WebSocketServer;
    private clients = new Map<string, BrowserClient>();
    private activeClientId: string | null = null;
    public onClientMessage?: (client: BrowserClient, message: string) => void;
    public getPreferredClientType?: () => 'extension' | 'electron' | undefined;
    public onClientConnected?: (client: BrowserClient) => void;
    public onClientDisconnected?: (client: BrowserClient) => void;

    constructor(port: number = 8081) {
        this.server = new WebSocketServer({ port });
        this.setupHandlers();
        debug(`Agent WebSocket server started on port ${port}`);
    }

    private setupHandlers(): void {
        this.server.on("connection", (ws: WebSocket, req: IncomingMessage) => {
            this.handleNewConnection(ws, req);
        });

        this.server.on("error", (error) => {
            console.error(`Agent WebSocket server error:`, error);
        });
    }

    private handleNewConnection(ws: WebSocket, req: IncomingMessage): void {
        const params = new URLSearchParams(req.url?.split("?")[1]);
        const clientId = params.get("clientId");

        if (!clientId) {
            ws.send(JSON.stringify({ error: "Missing clientId" }));
            ws.close();
            return;
        }

        const existing = this.clients.get(clientId);
        if (existing) {
            debug(`Closing duplicate connection for ${clientId}`);
            existing.socket.close(1013, "duplicate");
            this.clients.delete(clientId);
        }

        const client: BrowserClient = {
            id: clientId,
            type: clientId === 'inlineBrowser' ? 'electron' : 'extension',
            socket: ws,
            connectedAt: new Date(),
            lastActivity: new Date()
        };

        this.clients.set(clientId, client);
        debug(`Client connected: ${clientId} (${client.type})`);

        if (!this.activeClientId) {
            this.selectActiveClient(this.getPreferredClientType?.());
        }

        ws.send(JSON.stringify({
            type: 'welcome',
            clientId: clientId,
            isActive: this.activeClientId === clientId
        }));

        // Notify about new client connection
        if (this.onClientConnected) {
            this.onClientConnected(client);
        }

        ws.on("message", (message: string) => {
            client.lastActivity = new Date();

            try {
                const data = JSON.parse(message);
                if (data.method === "keepAlive" || data.messageType === "keepAlive") {
                    return;
                }
            } catch {}

            if (this.onClientMessage) {
                this.onClientMessage(client, message);
            }
        });

        ws.on("close", () => {
            debug(`Client disconnected: ${clientId}`);

            // Notify about client disconnection before removing from clients map
            if (this.onClientDisconnected) {
                this.onClientDisconnected(client);
            }

            this.clients.delete(clientId);

            if (this.activeClientId === clientId) {
                this.selectNewActiveClient();
            }
        });

        ws.on("error", (error) => {
            debug(`WebSocket error for client ${clientId}:`, error);
        });
    }

    public selectActiveClient(preferredClientType?: 'extension' | 'electron'): void {
        // If we have a preferred client type, use it
        if (preferredClientType) {
            for (const [id, client] of this.clients) {
                if (client.type === preferredClientType) {
                    this.setActiveClient(id);
                    return;
                }
            }
        }

        // Default behavior: prefer electron over extension
        for (const [id, client] of this.clients) {
            if (client.type === 'electron') {
                this.setActiveClient(id);
                return;
            }
        }

        // Fallback to first available client
        const firstClient = this.clients.keys().next();
        this.activeClientId = firstClient.done ? null : firstClient.value;

        if (this.activeClientId) {
            debug(`Auto-selected new active client: ${this.activeClientId}`);
        }
    }

    private selectNewActiveClient(): void {
        this.selectActiveClient(this.getPreferredClientType?.());
    }

    public getActiveClient(fallbackType?: 'extension' | 'electron'): BrowserClient | null {
        // First try to get the currently active client
        const activeClient = this.activeClientId ? this.clients.get(this.activeClientId) || null : null;

        // If we have an active client and either no fallback type specified
        // or the active client matches the fallback type, return it
        if (activeClient && (!fallbackType || activeClient.type === fallbackType)) {
            return activeClient;
        }

        // If we need a specific type and active client doesn't match, find one
        if (fallbackType) {
            for (const [_, client] of this.clients) {
                if (client.type === fallbackType) {
                    return client;
                }
            }
        }

        // Return the active client even if it doesn't match the fallback type,
        // or null if there's no active client
        return activeClient;
    }

    public getClient(clientId: string): BrowserClient | null {
        return this.clients.get(clientId) || null;
    }

    public listClients(): BrowserClient[] {
        return Array.from(this.clients.values());
    }

    public setActiveClient(clientId: string): boolean {
        if (this.clients.has(clientId)) {
            this.activeClientId = clientId;

            for (const [id, client] of this.clients) {
                client.socket.send(JSON.stringify({
                    type: 'active-status-changed',
                    isActive: id === clientId
                }));
            }

            debug(`Active client set to: ${clientId}`);
            return true;
        }
        return false;
    }

    public sendToClient(clientId: string, message: string): boolean {
        const client = this.clients.get(clientId);
        if (client && client.socket.readyState === WebSocket.OPEN) {
            client.socket.send(message);
            return true;
        }
        return false;
    }

    public sendToActiveClient(message: string): boolean {
        const client = this.getActiveClient();
        if (client && client.socket.readyState === WebSocket.OPEN) {
            client.socket.send(message);
            return true;
        }
        return false;
    }

    public stop(): void {
        this.server.close();
        debug("Agent WebSocket server stopped");
    }
}