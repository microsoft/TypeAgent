// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket, { IncomingMessage } from "ws";
import { ChatServer } from "./chatServer.js";
import { ChatSessionManager } from "./chatSessionManager.js";
import type {
    TypeAgentMessage,
    InitSessionMessage,
    UserRequestMessage,
    PingMessage,
    CloseSessionMessage,
} from "./types/chatProtocol.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:shell:protocolChatServer");

/**
 * Extended ChatServer with protocol message handling and session management
 * Routes requests to dispatcher via shellWindow
 */
export class ProtocolChatServer {
    private chatServer: ChatServer;
    private sessionManager: ChatSessionManager;
    private getDispatcher: (() => Promise<any>) | null = null;
    private getShellWindow: (() => any) | null = null;

    constructor(port: number) {
        this.chatServer = new ChatServer(port);
        this.sessionManager = new ChatSessionManager();

        // Set up connection handler
        this.chatServer.onConnection((ws: WebSocket, req: IncomingMessage) => {
            this.handleConnection(ws, req);
        });
    }

    /**
     * Set the getters for dispatcher and shellWindow
     */
    public setInstanceGetters(
        getDispatcher: () => Promise<any>,
        getShellWindow: () => any,
    ): void {
        this.getDispatcher = getDispatcher;
        this.getShellWindow = getShellWindow;
        debug("Instance getters attached to protocol server");
    }

    /**
     * Handle new WebSocket connection
     */
    private handleConnection(ws: WebSocket, req: IncomingMessage): void {
        debug(`New WebSocket connection from ${req.socket.remoteAddress}`);

        ws.on("message", (data: Buffer) => {
            this.handleMessage(ws, data);
        });

        ws.on("close", () => {
            debug("WebSocket connection closed");
            this.sessionManager.removeSessionByWebSocket(ws);
        });

        ws.on("error", (error) => {
            debug(`WebSocket error: ${error.message}`);
            this.sessionManager.removeSessionByWebSocket(ws);
        });
    }

    /**
     * Handle incoming message from WebSocket
     */
    private async handleMessage(ws: WebSocket, data: Buffer): Promise<void> {
        try {
            const text = data.toString();
            const message: TypeAgentMessage = JSON.parse(text);

            debug(`Received message type: ${message.type}`);

            // Route message based on type
            switch (message.type) {
                case "initSession":
                    await this.handleInitSession(ws, message as InitSessionMessage);
                    break;
                case "userRequest":
                    await this.handleUserRequest(
                        ws,
                        message as UserRequestMessage,
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
            capabilities: [
                "calendar",
                "email",
                "code",
                "chat",
                "dispatcher",
            ],
        });

        // Send ready status
        this.sendStatus(ws, message.sessionId, "ready", "TypeAgent Shell ready");
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
            if (!this.getDispatcher || !this.getShellWindow) {
                throw new Error("Instance getters not initialized");
            }

            const dispatcher = await this.getDispatcher();
            const shellWindow = this.getShellWindow();

            if (!dispatcher) {
                throw new Error("Dispatcher not available");
            }

            // Register this request with shellWindow so responses can be routed to WebSocket
            shellWindow.registerProtocolRequest(
                message.requestId,
                ws,
                message.sessionId,
            );

            // Process the command through the dispatcher
            // The dispatcher's ClientIO will check if this is a protocol request and route accordingly
            const result = await dispatcher.processCommand(
                message.message,
                message.requestId,
                [], // No attachments for now
            );

            debug(`Command result: ${JSON.stringify(result)}`);

            // Clean up request mapping
            shellWindow.unregisterProtocolRequest(message.requestId);

            // Send ready status after completion
            this.sendStatus(
                ws,
                message.sessionId,
                "ready",
                "Ready for next request",
            );
        } catch (error: any) {
            debug(`Error processing request: ${error.message}`);

            // Clean up on error
            if (this.getShellWindow) {
                const shellWindow = this.getShellWindow();
                shellWindow.unregisterProtocolRequest(message.requestId);
            }

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
    private send(ws: WebSocket, message: any): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
            debug(`Sent message type: ${message.type}`);
        } else {
            debug(`Cannot send message, WebSocket not open`);
        }
    }

    /**
     * Start the server
     */
    public async start(): Promise<void> {
        await this.chatServer.start();
    }

    /**
     * Stop the server
     */
    public stop(): void {
        debug("Stopping protocol chat server");
        this.sessionManager.shutdown();
        this.chatServer.stop();
    }

    /**
     * Get session manager (for testing/debugging)
     */
    public getSessionManager(): ChatSessionManager {
        return this.sessionManager;
    }
}
