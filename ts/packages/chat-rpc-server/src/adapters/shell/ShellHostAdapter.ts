// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HostAdapter } from "../HostAdapter.js";
import type { ChatRpcServer } from "../../server/ChatRpcServer.js";
import type WebSocket from "ws";
import registerDebug from "debug";

const debug = registerDebug("typeagent:chat-rpc-server:shell-adapter");

/**
 * Shell Host Adapter
 *
 * Integrates ChatRpcServer with TypeAgent Shell's dispatcher and ClientIO.
 * This adapter:
 * - Registers requests with ShellWindow for response routing
 * - Delegates command processing to Shell's dispatcher
 * - Routes responses back through the RPC server
 */
export class ShellHostAdapter implements HostAdapter {
    constructor(
        private server: ChatRpcServer,
        private getDispatcher: () => Promise<any>,
        private getShellWindow: () => any,
    ) {
        debug("Shell host adapter created");
    }

    /**
     * Process command through Shell's dispatcher
     */
    async processCommand(
        sessionId: string,
        requestId: string,
        command: string,
        context: any,
        ws: WebSocket,
    ): Promise<void> {
        debug(
            `Processing command for session ${sessionId}, request ${requestId}`,
        );

        const shellWindow = this.getShellWindow();
        const dispatcher = await this.getDispatcher();

        if (!dispatcher) {
            throw new Error("Dispatcher not available");
        }

        // Register protocol request with ShellWindow so responses can be routed to WebSocket
        // ShellWindow will check this mapping in its ClientIO callbacks
        shellWindow.registerProtocolRequest(requestId, ws, sessionId);

        try {
            // Process the command through the dispatcher
            // The dispatcher's ClientIO will check if this is a protocol request and route accordingly
            const result = await dispatcher.processCommand(
                command,
                requestId,
                [], // No attachments for now
            );

            debug(`Command result: ${JSON.stringify(result)}`);
        } finally {
            // Clean up request mapping
            shellWindow.unregisterProtocolRequest(requestId);
        }
    }

    /**
     * Send response to client via RPC server
     */
    sendResponse(
        sessionId: string,
        requestId: string,
        content: string,
        contentType: string,
        metadata?: any,
    ): void {
        debug(
            `Sending response for session ${sessionId}, request ${requestId}`,
        );

        this.server.sendToSession(sessionId, {
            type: "response",
            timestamp: new Date().toISOString(),
            sessionId,
            requestId,
            content,
            contentType,
            metadata,
        });
    }

    /**
     * Send status update to client
     */
    sendStatus(sessionId: string, status: string, message?: string): void {
        debug(`Sending status for session ${sessionId}: ${status}`);

        this.server.sendToSession(sessionId, {
            type: "status",
            timestamp: new Date().toISOString(),
            sessionId,
            status,
            message,
        });
    }

    /**
     * Send progress update to client
     */
    sendProgress(sessionId: string, requestId: string, progress: any): void {
        debug(
            `Sending progress for session ${sessionId}, request ${requestId}`,
        );

        this.server.sendToSession(sessionId, {
            type: "progress",
            timestamp: new Date().toISOString(),
            sessionId,
            requestId,
            progress,
        });
    }
}
