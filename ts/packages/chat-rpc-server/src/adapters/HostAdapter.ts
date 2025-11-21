// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type WebSocket from "ws";

/**
 * Host Adapter Interface
 *
 * Hosts (Shell, CLI) implement this interface to integrate with ChatRpcServer.
 * The adapter handles:
 * - Command processing via dispatcher
 * - Response routing back to client
 */
export interface HostAdapter {
    /**
     * Process user command
     *
     * @param sessionId - Session ID
     * @param requestId - Request ID for correlation
     * @param command - User command text
     * @param context - Optional command context
     * @param ws - WebSocket connection for the session
     */
    processCommand(
        sessionId: string,
        requestId: string,
        command: string,
        context: any,
        ws: WebSocket,
    ): Promise<void>;

    /**
     * Send response to client
     *
     * @param sessionId - Session ID
     * @param requestId - Request ID
     * @param content - Response content
     * @param contentType - Content type (text, markdown, html)
     * @param metadata - Optional metadata
     */
    sendResponse(
        sessionId: string,
        requestId: string,
        content: string,
        contentType: string,
        metadata?: any,
    ): void;

    /**
     * Send status update to client
     *
     * @param sessionId - Session ID
     * @param status - Status value (ready, busy, error, etc.)
     * @param message - Optional status message
     */
    sendStatus(sessionId: string, status: string, message?: string): void;

    /**
     * Send progress update to client
     *
     * @param sessionId - Session ID
     * @param requestId - Request ID
     * @param progress - Progress information
     */
    sendProgress(sessionId: string, requestId: string, progress: any): void;

    /**
     * Get command completion suggestions
     *
     * @param prefix - Partial input text to get completions for
     * @returns Completion result from dispatcher
     */
    getCompletion?(prefix: string): Promise<
        | {
              startIndex: number;
              space: boolean;
              completions: Array<{
                  name: string;
                  completions: string[];
                  needQuotes?: boolean;
                  emojiChar?: string;
                  sorted?: boolean;
              }>;
          }
        | undefined
    >;
}
