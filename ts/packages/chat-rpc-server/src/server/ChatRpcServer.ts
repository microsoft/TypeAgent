// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket, { WebSocketServer } from "ws";
import { SessionManager } from "../session/SessionManager.js";
import { HostAdapter } from "../adapters/HostAdapter.js";
import type {
    TypeAgentMessage,
    InitSessionMessage,
    UserRequestMessage,
    PingMessage,
    CloseSessionMessage,
    CompletionRequestMessage,
} from "../types/protocol.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:chat-rpc-server");

export interface ServerConfig {
    port: number;
    host?: string;
}

/**
 * Chat RPC Server
 * Handles WebSocket connections and routes messages to host-specific dispatcher
 * Extracted from Shell's ProtocolChatServer for reuse across Shell and CLI
 */
export class ChatRpcServer {
    private wss: WebSocketServer | null = null;
    private sessionManager: SessionManager;
    private hostAdapter: HostAdapter | null = null;
    private config: ServerConfig;

    constructor(config: ServerConfig) {
        this.config = {
            host: "localhost",
            ...config,
        };
        this.sessionManager = new SessionManager();
    }

    /**
     * Attach host adapter for dispatcher integration
     */
    attachHost(adapter: HostAdapter): void {
        this.hostAdapter = adapter;
        debug("Host adapter attached to server");
    }

    /**
     * Start WebSocket server
     */
    async start(): Promise<void> {
        this.wss = new WebSocketServer({
            port: this.config.port,
            host: this.config.host,
        });

        this.wss.on("connection", (ws: WebSocket) => {
            this.handleConnection(ws);
        });

        debug(
            `Chat RPC Server listening on ${this.config.host}:${this.config.port}`,
        );
    }

    /**
     * Stop server
     */
    async stop(): Promise<void> {
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        this.sessionManager.shutdown();
        debug("Chat RPC Server stopped");
    }

    /**
     * Handle new WebSocket connection
     */
    private handleConnection(ws: WebSocket): void {
        debug("New WebSocket connection established");

        ws.on("message", (data: Buffer) => {
            this.handleMessage(ws, data);
        });

        ws.on("close", () => {
            debug("WebSocket connection closed");
            this.sessionManager.removeSessionByWebSocket(ws);
        });

        ws.on("error", (error: Error) => {
            debug(`WebSocket error: ${error.message}`);
            this.sessionManager.removeSessionByWebSocket(ws);
        });
    }

    /**
     * Handle incoming message
     */
    private async handleMessage(ws: WebSocket, data: Buffer): Promise<void> {
        try {
            const text = data.toString();
            const message: TypeAgentMessage = JSON.parse(text);

            debug(`Received message type: ${message.type}`);

            // Route message based on type
            switch (message.type) {
                case "initSession":
                    await this.handleInitSession(
                        ws,
                        message as InitSessionMessage,
                    );
                    break;
                case "userRequest":
                    await this.handleUserRequest(
                        ws,
                        message as UserRequestMessage,
                    );
                    break;
                case "completionRequest":
                    await this.handleCompletionRequest(
                        ws,
                        message as CompletionRequestMessage,
                    );
                    break;
                case "ping":
                    await this.handlePing(ws, message as PingMessage);
                    break;
                case "closeSession":
                    await this.handleCloseSession(
                        ws,
                        message as CloseSessionMessage,
                    );
                    break;
                default:
                    this.sendError(
                        ws,
                        "UNKNOWN_MESSAGE_TYPE",
                        `Unknown message type: ${message.type}`,
                        message.sessionId,
                    );
            }
        } catch (error) {
            debug(`Error handling message: ${error}`);
            this.sendError(
                ws,
                "PARSE_ERROR",
                "Invalid message format",
                undefined,
            );
        }
    }

    /**
     * Handle initSession message
     */
    private async handleInitSession(
        ws: WebSocket,
        message: InitSessionMessage,
    ): Promise<void> {
        debug(`Initializing session: ${message.sessionId}`);

        // Create session
        this.sessionManager.createSession(
            message.sessionId,
            ws,
            message.userInfo,
        );

        // Send session acknowledgment
        this.send(ws, {
            type: "sessionAck",
            timestamp: new Date().toISOString(),
            sessionId: message.sessionId,
            message: "Session initialized successfully",
            capabilities: ["calendar", "email", "code", "chat", "dispatcher"],
        });

        // Send ready status
        this.sendStatus(ws, message.sessionId, "ready", "Server ready");
    }

    /**
     * Handle userRequest message
     */
    private async handleUserRequest(
        ws: WebSocket,
        message: UserRequestMessage,
    ): Promise<void> {
        const session = this.sessionManager.getSession(message.sessionId);
        if (!session) {
            this.sendError(
                ws,
                "SESSION_NOT_FOUND",
                "Session not found",
                message.sessionId,
                message.requestId,
            );
            return;
        }

        debug(
            `Processing user request for session ${message.sessionId}: ${message.message}`,
        );

        // Update session activity
        this.sessionManager.updateActivity(message.sessionId);

        // Add to conversation history
        this.sessionManager.addToHistory(
            message.sessionId,
            "user",
            message.message,
        );

        // Send busy status
        this.sendStatus(ws, message.sessionId, "busy", "Processing request");

        try {
            if (!this.hostAdapter) {
                throw new Error("Host adapter not attached");
            }

            // Process the command through the host adapter
            await this.hostAdapter.processCommand(
                message.sessionId,
                message.requestId,
                message.message,
                message.context,
                ws,
            );

            // Send ready status after completion
            this.sendStatus(
                ws,
                message.sessionId,
                "ready",
                "Ready for next request",
            );
        } catch (error: any) {
            debug(`Error processing request: ${error.message}`);

            this.sendError(
                ws,
                "PROCESSING_ERROR",
                error.message || "Error processing request",
                message.sessionId,
                message.requestId,
            );
            this.sendStatus(
                ws,
                message.sessionId,
                "ready",
                "Ready after error",
            );
        }
    }

    /**
     * Handle completionRequest message
     */
    private async handleCompletionRequest(
        ws: WebSocket,
        message: CompletionRequestMessage,
    ): Promise<void> {
        const session = this.sessionManager.getSession(message.sessionId);
        if (!session) {
            this.sendError(
                ws,
                "SESSION_NOT_FOUND",
                "Session not found",
                message.sessionId,
                message.requestId,
            );
            return;
        }

        debug(
            `Getting completions for session ${message.sessionId}: "${message.prefix}"`,
        );

        // Update session activity
        this.sessionManager.updateActivity(message.sessionId);

        try {
            if (!this.hostAdapter) {
                throw new Error("Host adapter not attached");
            }

            // Check if host adapter supports getCompletion
            if (!this.hostAdapter.getCompletion) {
                throw new Error("Host adapter does not support getCompletion");
            }

            // Get completions from host adapter
            const result = await this.hostAdapter.getCompletion(message.prefix);

            // Send completion response
            this.send(ws, {
                type: "completionResponse",
                timestamp: new Date().toISOString(),
                sessionId: message.sessionId,
                requestId: message.requestId,
                result: result
                    ? {
                          startIndex: result.startIndex,
                          space: result.space,
                          completions: result.completions,
                      }
                    : undefined,
            });

            debug(
                `Sent completion response with ${result?.completions?.length || 0} groups`,
            );
        } catch (error: any) {
            debug(`Error getting completions: ${error.message}`);

            // Send error response
            this.send(ws, {
                type: "completionResponse",
                timestamp: new Date().toISOString(),
                sessionId: message.sessionId,
                requestId: message.requestId,
                error: {
                    code: "DISPATCHER_ERROR",
                    message: error.message || "Failed to get completions",
                },
            });
        }
    }

    /**
     * Handle ping message
     */
    private async handlePing(
        ws: WebSocket,
        message: PingMessage,
    ): Promise<void> {
        debug(`Ping received for session ${message.sessionId}`);

        // Update session activity
        this.sessionManager.updateActivity(message.sessionId);

        // Send pong
        this.send(ws, {
            type: "pong",
            timestamp: new Date().toISOString(),
            sessionId: message.sessionId,
            serverTime: new Date().toISOString(),
        });
    }

    /**
     * Handle closeSession message
     */
    private async handleCloseSession(
        ws: WebSocket,
        message: CloseSessionMessage,
    ): Promise<void> {
        debug(
            `Closing session ${message.sessionId}, reason: ${message.reason || "client request"}`,
        );

        // Remove session
        this.sessionManager.removeSession(message.sessionId);

        // Close WebSocket
        ws.close();
    }

    /**
     * Send error message
     */
    private sendError(
        ws: WebSocket,
        code: string,
        message: string,
        sessionId?: string,
        requestId?: string,
    ): void {
        this.send(ws, {
            type: "error",
            timestamp: new Date().toISOString(),
            sessionId,
            requestId,
            error: {
                code,
                message,
            },
        });
    }

    /**
     * Send status message
     */
    private sendStatus(
        ws: WebSocket,
        sessionId: string,
        status: "ready" | "busy" | "error" | "initializing",
        message?: string,
    ): void {
        this.send(ws, {
            type: "status",
            timestamp: new Date().toISOString(),
            sessionId,
            status,
            message,
        });
    }

    /**
     * Send a message to WebSocket
     */
    send(ws: WebSocket, message: any): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
            debug(`Sent message type: ${message.type}`);
        } else {
            debug(`Cannot send message, WebSocket not open`);
        }
    }

    /**
     * Send message to specific session
     */
    sendToSession(sessionId: string, message: any): void {
        const session = this.sessionManager.getSession(sessionId);
        if (session) {
            this.send(session.ws, message);
        }
    }

    /**
     * Get session manager (for testing/debugging)
     */
    getSessionManager(): SessionManager {
        return this.sessionManager;
    }
}
