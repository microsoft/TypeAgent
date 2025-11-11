// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type WebSocket from "ws";
import type { IProtocolRequestTracker } from "../../common/index.js";
import registerDebug from "debug";

const debug = registerDebug(
    "typeagent:chat-rpc-server:protocol-request-manager",
);

/**
 * Protocol Request Manager
 *
 * Manages the mapping between requestIds and WebSocket connections
 * Similar to ShellWindow's protocolRequests Map, but as a standalone class
 *
 * Implements IProtocolRequestTracker so it can be used with the shared ClientIO wrapper
 */
export class ProtocolRequestManager implements IProtocolRequestTracker {
    private protocolRequests = new Map<
        string,
        { ws: WebSocket; sessionId: string }
    >();

    /**
     * Register a protocol client request so we can route responses to WebSocket
     */
    registerProtocolRequest(
        requestId: string,
        ws: WebSocket,
        sessionId: string,
    ): void {
        this.protocolRequests.set(requestId, { ws, sessionId });
        debug(`Registered protocol request: ${requestId}`);
    }

    /**
     * Unregister a protocol client request after completion
     */
    unregisterProtocolRequest(requestId: string): void {
        this.protocolRequests.delete(requestId);
        debug(`Unregistered protocol request: ${requestId}`);
    }

    /**
     * Check if a requestId is from a protocol client
     */
    isProtocolRequest(requestId: string | undefined): boolean {
        if (!requestId) return false;
        return this.protocolRequests.has(requestId);
    }

    /**
     * Get the WebSocket for a protocol request
     */
    getProtocolRequestWebSocket(
        requestId: string | undefined,
    ): { ws: WebSocket; sessionId: string } | undefined {
        if (!requestId) return undefined;
        return this.protocolRequests.get(requestId);
    }

    /**
     * Get count of active protocol requests
     */
    getActiveCount(): number {
        return this.protocolRequests.size;
    }

    /**
     * Clear all protocol requests (for shutdown)
     */
    clear(): void {
        debug(`Clearing ${this.protocolRequests.size} protocol requests`);
        this.protocolRequests.clear();
    }
}
