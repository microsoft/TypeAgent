// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketServer, WebSocket } from "ws";
import registerDebug from "debug";

const debug = registerDebug("typeagent:code:websocket");

export class CodeAgentWebSocketServer {
    private server: WebSocketServer;
    private clients: Map<string, WebSocket> = new Map();
    private clientIdCounter = 0;
    public onMessage?: (message: string) => void;

    constructor(port: number = 8082) {
        this.server = new WebSocketServer({ port });
        this.setupHandlers();
        debug(`CodeAgentWebSocketServer listening on port ${port}`);

        this.server.on('error', (error) => {
            debug('Server error:', error);
        });
    }

    private setupHandlers(): void {
        this.server.on('connection', (ws: WebSocket) => {
            const clientId = `client-${++this.clientIdCounter}-${Date.now()}`;
            debug('New client connected');
            this.clients.set(clientId, ws);

            // Store client ID on the WebSocket for reference
            (ws as any).clientId = clientId;

            ws.on('message', (message: Buffer) => {
                const messageStr = message.toString();
                if (this.onMessage) {
                    this.onMessage(messageStr);
                }
            });

            ws.on('close', () => {
                debug('Client disconnected');
                this.clients.delete(clientId);
            });

            ws.on('error', (error) => {
                debug('Client error:', error);
                this.clients.delete(clientId);
            });
        });

        this.server.on('error', (error) => {
            debug('Server error:', error);
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
                    debug('Failed to send to client:', error);
                    clientsToRemove.push(clientId);
                }
            } else {
                clientsToRemove.push(clientId);
            }
        }

        // Remove failed clients
        clientsToRemove.forEach(clientId => this.clients.delete(clientId));

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
            const state = client.readyState === WebSocket.OPEN ? 'OPEN' :
                         client.readyState === WebSocket.CONNECTING ? 'CONNECTING' :
                         client.readyState === WebSocket.CLOSING ? 'CLOSING' : 'CLOSED';
            states.push(`${clientId}: ${state}`);
        }
        return states;
    }

    public close(): void {
        debug('Closing CodeAgentWebSocketServer');
        for (const [, client] of this.clients.entries()) {
            if (client.readyState === WebSocket.OPEN) {
                client.close();
            }
        }
        this.clients.clear();
        this.server.close();
    }
}