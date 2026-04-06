// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import type {
    BrowserAgentInvokeFunctions,
    BrowserAgentCallFunctions,
} from "../common/serviceTypes.mjs";
import type {
    BrowserControlInvokeFunctions,
    BrowserControlCallFunctions,
} from "../common/browserControl.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:agent-ws");
const debugClientRouting = registerDebug("typeagent:browser:client-routing");

export interface BrowserClient {
    id: string;
    type: "extension" | "electron";
    socket: WebSocket;
    connectedAt: Date;
    lastActivity: Date;
    channelProvider?: ChannelProviderAdapter;
    agentRpc?: any;
    browserControlRpc?: any;
}

export class AgentWebSocketServer {
    private server: WebSocketServer;
    private clients = new Map<string, BrowserClient>();
    private activeClientId: string | null = null;
    public onWebAgentMessage?: (client: BrowserClient, data: any) => void;
    public getPreferredClientType?: () => "extension" | "electron" | undefined;
    public onClientConnected?: (client: BrowserClient) => void;
    public onClientDisconnected?: (client: BrowserClient) => void;
    private agentInvokeHandlers?: BrowserAgentInvokeFunctions;

    constructor(port: number = 8081) {
        this.server = new WebSocketServer({ port });
        this.setupHandlers();
        debug(`Agent WebSocket server started on port ${port}`);
    }

    /**
     * Set the invoke handlers for the agent service RPC.
     * These handlers will be registered for each new client connection.
     */
    public setAgentInvokeHandlers(handlers: BrowserAgentInvokeFunctions): void {
        this.agentInvokeHandlers = handlers;
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
            if (existing.channelProvider) {
                existing.channelProvider.notifyDisconnected();
            }
            existing.socket.close(1013, "duplicate");
            this.clients.delete(clientId);
        }

        // Create channel provider for this client connection
        const clientChannelProvider = createChannelProviderAdapter(
            `agent:${clientId}`,
            (message: any) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(message));
                }
            },
        );

        // Set up agentService RPC channel for this client
        let clientAgentRpc: any | undefined;
        if (this.agentInvokeHandlers) {
            const agentServiceChannel =
                clientChannelProvider.createChannel("agentService");
            clientAgentRpc = createRpc<
                {},
                BrowserAgentCallFunctions,
                BrowserAgentInvokeFunctions
            >(
                `agent:service:${clientId}`,
                agentServiceChannel,
                this.agentInvokeHandlers,
            );
        }

        // Set up browserControl RPC channel for this client
        const browserControlChannel =
            clientChannelProvider.createChannel("browserControl");
        const clientBrowserControlRpc = createRpc<
            BrowserControlInvokeFunctions,
            BrowserControlCallFunctions
        >(`browser:control:${clientId}`, browserControlChannel);

        const client: BrowserClient = {
            id: clientId,
            type: clientId === "inlineBrowser" ? "electron" : "extension",
            socket: ws,
            connectedAt: new Date(),
            lastActivity: new Date(),
            channelProvider: clientChannelProvider,
            agentRpc: clientAgentRpc,
            browserControlRpc: clientBrowserControlRpc,
        };

        this.clients.set(clientId, client);
        debug(`Client connected: ${clientId} (${client.type})`);

        // Always re-evaluate active client when a new client connects
        // This ensures preferred client type takes precedence when it connects
        this.selectActiveClient(this.getPreferredClientType?.());

        ws.send(
            JSON.stringify({
                type: "welcome",
                clientId: clientId,
                isActive: this.activeClientId === clientId,
            }),
        );

        if (this.onClientConnected) {
            this.onClientConnected(client);
        }

        ws.on("message", (message: string) => {
            client.lastActivity = new Date();

            let data: any;
            try {
                data = JSON.parse(message);
            } catch {
                return;
            }

            // Filter keepalive messages
            if (
                data.method === "keepAlive" ||
                data.messageType === "keepAlive"
            ) {
                return;
            }

            // Channel-multiplexed format (from createChannelProviderAdapter)
            if (data.name !== undefined) {
                clientChannelProvider.notifyMessage(data);
                return;
            }

            // Web agent messages (forwarded from content scripts)
            if (data.source === "webAgent" && this.onWebAgentMessage) {
                this.onWebAgentMessage(client, data);
            }
        });

        ws.on("close", () => {
            debug(`Client disconnected: ${clientId}`);

            if (this.onClientDisconnected) {
                this.onClientDisconnected(client);
            }

            if (client.channelProvider) {
                client.channelProvider.notifyDisconnected();
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

    public selectActiveClient(
        preferredClientType?: "extension" | "electron",
    ): void {
        if (preferredClientType) {
            // If preferred type is set, ONLY allow that type to become active
            for (const [id, client] of this.clients) {
                if (client.type === preferredClientType) {
                    this.setActiveClient(id);
                    return;
                }
            }
            // Preferred type not found - don't set any active client, wait for it
            debug(
                `Preferred client type '${preferredClientType}' not available yet, waiting...`,
            );
            return;
        }

        // No preferred type - use default priority: electron > extension > any
        for (const [id, client] of this.clients) {
            if (client.type === "electron") {
                this.setActiveClient(id);
                return;
            }
        }

        const firstClient = this.clients.keys().next();
        this.activeClientId = firstClient.done ? null : firstClient.value;

        if (this.activeClientId) {
            debug(`Auto-selected new active client: ${this.activeClientId}`);
        }
    }

    private selectNewActiveClient(): void {
        this.selectActiveClient(this.getPreferredClientType?.());
    }

    public getActiveClient(
        fallbackType?: "extension" | "electron",
    ): BrowserClient | null {
        const activeClient = this.activeClientId
            ? this.clients.get(this.activeClientId) || null
            : null;

        if (!activeClient) {
            debugClientRouting(`getActiveClient: No active client found`);
        }

        if (
            activeClient &&
            (!fallbackType || activeClient.type === fallbackType)
        ) {
            return activeClient;
        }

        if (fallbackType) {
            debugClientRouting(
                `getActiveClient: Active client doesn't match fallbackType='${fallbackType}', searching for matching client`,
            );
            for (const [_, client] of this.clients) {
                if (client.type === fallbackType) {
                    debugClientRouting(
                        `getActiveClient: Found matching client type='${client.type}', id='${client.id}'`,
                    );
                    return client;
                }
            }
            debugClientRouting(
                `getActiveClient: No client found with fallbackType='${fallbackType}'`,
            );
        }
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
                client.socket.send(
                    JSON.stringify({
                        type: "active-status-changed",
                        isActive: id === clientId,
                    }),
                );
            }

            debug(`Active client set to: ${clientId}`);
            return true;
        }
        return false;
    }

    /**
     * Send a fire-and-forget event to a client via agentRpc.
     * This replaces the legacy pattern of sending raw JSON messages for progress events.
     */
    public sendEventToClient<K extends keyof BrowserAgentCallFunctions>(
        clientId: string,
        event: K,
        ...args: Parameters<BrowserAgentCallFunctions[K]>
    ): boolean {
        const client = this.clients.get(clientId);
        if (client?.agentRpc) {
            (client.agentRpc.send as any)(event, ...args);
            return true;
        }
        return false;
    }

    /**
     * Send a fire-and-forget event to the active client via agentRpc.
     */
    public sendEventToActiveClient<K extends keyof BrowserAgentCallFunctions>(
        event: K,
        ...args: Parameters<BrowserAgentCallFunctions[K]>
    ): boolean {
        const client = this.getActiveClient();
        if (client?.agentRpc) {
            (client.agentRpc.send as any)(event, ...args);
            return true;
        }
        return false;
    }

    public stop(): void {
        this.server.close();
        debug("Agent WebSocket server stopped");
    }
}
