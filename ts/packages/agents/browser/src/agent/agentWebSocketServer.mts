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
    sessionId: string;
    type: "extension" | "electron";
    socket: WebSocket;
    connectedAt: Date;
    lastActivity: Date;
    channelProvider?: ChannelProviderAdapter;
    agentRpc?: any;
    browserControlRpc?: any;
}

interface SessionHandlers {
    agentInvokeHandlers?: BrowserAgentInvokeFunctions;
    getPreferredClientType?: () => "extension" | "electron" | undefined;
    onClientConnected?: (client: BrowserClient) => void;
    onClientDisconnected?: (client: BrowserClient) => void;
    onWebAgentMessage?: (client: BrowserClient, data: any) => void;
    activeClientId: string | null;
}

export class AgentWebSocketServer {
    private server: WebSocketServer;
    private clients = new Map<string, Map<string, BrowserClient>>();
    private sessionHandlers = new Map<string, SessionHandlers>();

    constructor(port: number = 8081) {
        this.server = new WebSocketServer({ port });
        this.setupHandlers();
        debug(`Agent WebSocket server started on port ${port}`);
    }

    /**
     * Register per-session handlers. Call during updateAgentContext(enable=true).
     * Preserves the session's existing activeClientId if already registered.
     * For clients that connected before registration:
     *   - Late-wires agentRpc if agentInvokeHandlers are now available.
     *   - Selects an active client (was skipped at connect time since no session existed).
     *   - Fires onClientConnected for each pre-connected client.
     */
    public registerSession(
        sessionId: string,
        handlers: Omit<SessionHandlers, "activeClientId">,
    ): void {
        const existing = this.sessionHandlers.get(sessionId);
        this.sessionHandlers.set(sessionId, {
            ...handlers,
            activeClientId: existing?.activeClientId ?? null,
        });

        const preConnected = this.getSessionClients(sessionId);

        // Wire up agentRpc for clients that connected before session registration
        if (handlers.agentInvokeHandlers) {
            for (const client of preConnected.values()) {
                if (!client.agentRpc && client.channelProvider) {
                    const agentServiceChannel =
                        client.channelProvider.createChannel("agentService");
                    client.agentRpc = createRpc<
                        {},
                        BrowserAgentCallFunctions,
                        BrowserAgentInvokeFunctions
                    >(
                        `agent:service:${sessionId}:${client.id}`,
                        agentServiceChannel,
                        handlers.agentInvokeHandlers,
                    );
                    debug(
                        `Late-wired agentRpc for pre-registered client: ${client.id}`,
                    );
                }
            }
        }

        if (preConnected.size > 0) {
            // activeClientId was never set for these clients (handleNewConnection
            // bails on selectActiveClientForSession when no session is registered).
            this.selectActiveClientForSession(
                sessionId,
                handlers.getPreferredClientType?.(),
            );

            // onClientConnected was also skipped at connect time.
            if (handlers.onClientConnected) {
                for (const client of preConnected.values()) {
                    handlers.onClientConnected(client);
                }
            }
        }

        debug(`Session registered: ${sessionId}`);
    }

    /**
     * Unregister a session. Call during closeAgentContext.
     * Closes and removes all clients belonging to this session.
     * Does NOT stop the server — it is process-level and shared across sessions.
     */
    public unregisterSession(sessionId: string): void {
        // Delete handlers first so the async 'close' events that fire after
        // socket.close() find no session and skip their cleanup logic.
        this.sessionHandlers.delete(sessionId);
        const sessionMap = this.clients.get(sessionId);
        if (sessionMap) {
            for (const client of sessionMap.values()) {
                if (client.channelProvider) {
                    client.channelProvider.notifyDisconnected();
                }
                client.socket.close();
            }
            this.clients.delete(sessionId);
        }
        debug(`Session unregistered: ${sessionId}`);
    }

    public hasRegisteredSessions(): boolean {
        return this.sessionHandlers.size > 0;
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
        const sessionId = params.get("sessionId");

        if (!clientId || !sessionId) {
            ws.send(JSON.stringify({ error: "Missing clientId or sessionId" }));
            ws.close();
            return;
        }

        const sessionMap =
            this.clients.get(sessionId) ?? new Map<string, BrowserClient>();
        const existing = sessionMap.get(clientId);
        if (existing) {
            debug(
                `Closing duplicate connection for ${clientId} in session ${sessionId}`,
            );
            if (existing.channelProvider) {
                existing.channelProvider.notifyDisconnected();
            }
            existing.socket.close(1013, "duplicate");
            sessionMap.delete(clientId);
        }

        const session = this.sessionHandlers.get(sessionId);

        // Create channel provider for this client connection
        const clientChannelProvider = createChannelProviderAdapter(
            `agent:${sessionId}:${clientId}`,
            (message: any) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(message));
                }
            },
        );

        // Set up agentService RPC channel for this client
        let clientAgentRpc: any | undefined;
        if (session?.agentInvokeHandlers) {
            const agentServiceChannel =
                clientChannelProvider.createChannel("agentService");
            clientAgentRpc = createRpc<
                {},
                BrowserAgentCallFunctions,
                BrowserAgentInvokeFunctions
            >(
                `agent:service:${sessionId}:${clientId}`,
                agentServiceChannel,
                session.agentInvokeHandlers,
            );
        }

        // Set up browserControl RPC channel for this client
        const browserControlChannel =
            clientChannelProvider.createChannel("browserControl");
        const clientBrowserControlRpc = createRpc<
            BrowserControlInvokeFunctions,
            BrowserControlCallFunctions
        >(`browser:control:${sessionId}:${clientId}`, browserControlChannel);

        const client: BrowserClient = {
            id: clientId,
            sessionId,
            type: clientId === "inlineBrowser" ? "electron" : "extension",
            socket: ws,
            connectedAt: new Date(),
            lastActivity: new Date(),
            channelProvider: clientChannelProvider,
            agentRpc: clientAgentRpc,
            browserControlRpc: clientBrowserControlRpc,
        };

        sessionMap.set(clientId, client);
        this.clients.set(sessionId, sessionMap);
        debug(
            `Client connected: ${clientId} (${client.type}, session: ${sessionId})`,
        );

        // Re-evaluate active client for this session when a new client connects
        this.selectActiveClientForSession(
            sessionId,
            session?.getPreferredClientType?.(),
        );

        ws.send(
            JSON.stringify({
                type: "welcome",
                clientId: clientId,
                isActive: session?.activeClientId === clientId,
            }),
        );

        if (session?.onClientConnected) {
            session.onClientConnected(client);
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
            const s = this.sessionHandlers.get(client.sessionId);
            if (data.source === "webAgent" && s?.onWebAgentMessage) {
                s.onWebAgentMessage(client, data);
            }
        });

        ws.on("close", () => {
            debug(`Client disconnected: ${clientId}`);

            const s = this.sessionHandlers.get(client.sessionId);
            if (s?.onClientDisconnected) {
                s.onClientDisconnected(client);
            }

            if (client.channelProvider) {
                client.channelProvider.notifyDisconnected();
            }

            const sm = this.clients.get(client.sessionId);
            if (sm) {
                sm.delete(clientId);
                if (sm.size === 0) this.clients.delete(client.sessionId);
            }

            if (s && s.activeClientId === clientId) {
                this.selectNewActiveClientForSession(client.sessionId);
            }
        });

        ws.on("error", (error) => {
            debug(`WebSocket error for client ${clientId}:`, error);
        });
    }

    public selectActiveClientForSession(
        sessionId: string,
        preferredClientType?: "extension" | "electron",
    ): void {
        const session = this.sessionHandlers.get(sessionId);
        if (!session) return;

        const sessionClients = this.getSessionClients(sessionId);

        if (preferredClientType) {
            for (const [id, client] of sessionClients) {
                if (client.type === preferredClientType) {
                    this.setActiveClient(sessionId, id);
                    return;
                }
            }
            debug(
                `Preferred client type '${preferredClientType}' not available yet for session '${sessionId}', waiting...`,
            );
            return;
        }

        // No preferred type — use default priority: electron > extension > any
        for (const [id, client] of sessionClients) {
            if (client.type === "electron") {
                this.setActiveClient(sessionId, id);
                return;
            }
        }

        const firstClient = sessionClients.keys().next();
        if (!firstClient.done) {
            this.setActiveClient(sessionId, firstClient.value);
        } else {
            session.activeClientId = null;
        }
    }

    private selectNewActiveClientForSession(sessionId: string): void {
        const session = this.sessionHandlers.get(sessionId);
        if (!session) return;
        this.selectActiveClientForSession(
            sessionId,
            session.getPreferredClientType?.(),
        );
    }

    private getSessionClients(sessionId: string): Map<string, BrowserClient> {
        return this.clients.get(sessionId) ?? new Map();
    }

    public getActiveClient(
        sessionId: string,
        fallbackType?: "extension" | "electron",
    ): BrowserClient | null {
        const session = this.sessionHandlers.get(sessionId);
        if (!session) return null;

        const activeClient = session.activeClientId
            ? this.clients.get(sessionId)?.get(session.activeClientId) || null
            : null;

        if (!activeClient) {
            debugClientRouting(
                `getActiveClient: No active client found for session '${sessionId}'`,
            );
        }

        if (
            activeClient &&
            (!fallbackType || activeClient.type === fallbackType)
        ) {
            return activeClient;
        }

        if (fallbackType) {
            debugClientRouting(
                `getActiveClient: Active client doesn't match fallbackType='${fallbackType}' for session '${sessionId}', searching...`,
            );
            for (const [_, client] of this.getSessionClients(sessionId)) {
                if (client.type === fallbackType) {
                    debugClientRouting(
                        `getActiveClient: Found matching client type='${client.type}', id='${client.id}'`,
                    );
                    return client;
                }
            }
            debugClientRouting(
                `getActiveClient: No client found with fallbackType='${fallbackType}' for session '${sessionId}'`,
            );
        }
        return activeClient;
    }

    public getClient(
        sessionId: string,
        clientId: string,
    ): BrowserClient | null {
        return this.clients.get(sessionId)?.get(clientId) || null;
    }

    public listClients(): BrowserClient[] {
        const result: BrowserClient[] = [];
        for (const sessionMap of this.clients.values()) {
            result.push(...sessionMap.values());
        }
        return result;
    }

    public setActiveClient(sessionId: string, clientId: string): boolean {
        const session = this.sessionHandlers.get(sessionId);
        if (!session || !this.clients.get(sessionId)?.has(clientId))
            return false;

        session.activeClientId = clientId;

        // Notify only clients belonging to this session
        for (const [id, client] of this.getSessionClients(sessionId)) {
            client.socket.send(
                JSON.stringify({
                    type: "active-status-changed",
                    isActive: id === clientId,
                }),
            );
        }

        debug(`Active client for session '${sessionId}' set to: ${clientId}`);
        return true;
    }

    /**
     * Send a fire-and-forget event to a specific client via agentRpc.
     */
    public sendEventToClient<K extends keyof BrowserAgentCallFunctions>(
        sessionId: string,
        clientId: string,
        event: K,
        ...args: Parameters<BrowserAgentCallFunctions[K]>
    ): boolean {
        const client = this.clients.get(sessionId)?.get(clientId);
        if (client?.agentRpc) {
            (client.agentRpc.send as any)(event, ...args);
            return true;
        }
        return false;
    }

    /**
     * Send a fire-and-forget event to the active client for a session via agentRpc.
     */
    public sendEventToActiveClient<K extends keyof BrowserAgentCallFunctions>(
        sessionId: string,
        event: K,
        ...args: Parameters<BrowserAgentCallFunctions[K]>
    ): boolean {
        const client = this.getActiveClient(sessionId);
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
