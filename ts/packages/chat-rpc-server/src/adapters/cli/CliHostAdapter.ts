// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HostAdapter } from "../HostAdapter.js";
import type WebSocket from "ws";
import { ProtocolRequestManager } from "./ProtocolRequestManager.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:chat-rpc-server:cli-adapter");

/**
 * CLI Host Adapter
 *
 * Integrates ChatRpcServer with TypeAgent CLI's dispatcher.
 * Unlike Shell, CLI doesn't have a window, so we use ProtocolRequestManager directly.
 *
 * This adapter:
 * - Uses ProtocolRequestManager to track request-session-websocket mappings
 * - Works with ProtocolClientIOWrapper which checks isProtocolRequest()
 * - Routes responses through the ClientIO wrapper (same pattern as Shell)
 */
export class CliHostAdapter implements HostAdapter {
    constructor(
        private dispatcher: any,
        private requestManager: ProtocolRequestManager,
    ) {
        debug("CLI host adapter created");
    }

    /**
     * Process command through CLI dispatcher
     *
     * Registers the request with ProtocolRequestManager so the ClientIO wrapper
     * can route responses to the correct WebSocket
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

        // Register protocol request so ClientIO wrapper can route responses
        this.requestManager.registerProtocolRequest(requestId, ws, sessionId);

        try {
            // Process through dispatcher
            // The ClientIO wrapper will check isProtocolRequest() and route to WebSocket
            const result = await this.dispatcher.processCommand(
                command,
                requestId,
                [], // No attachments
            );

            debug(`Command result: ${JSON.stringify(result)}`);
        } finally {
            // Clean up mapping
            this.requestManager.unregisterProtocolRequest(requestId);
        }
    }

    /**
     * Send response to client
     * (Not used in this implementation - responses go through ClientIO wrapper)
     */
    sendResponse(
        sessionId: string,
        requestId: string,
        content: string,
        contentType: string,
        metadata?: any,
    ): void {
        debug(`sendResponse called (should use ClientIO wrapper instead)`);
    }

    /**
     * Send status update to client
     * (Not used in this implementation - status goes through ClientIO wrapper)
     */
    sendStatus(sessionId: string, status: string, message?: string): void {
        debug(`sendStatus called (should use ClientIO wrapper instead)`);
    }

    /**
     * Send progress update to client
     * (Not used in this implementation - progress goes through ClientIO wrapper)
     */
    sendProgress(sessionId: string, requestId: string, progress: any): void {
        debug(`sendProgress called (should use ClientIO wrapper instead)`);
    }
}
