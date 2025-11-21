// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ClientIO, IAgentMessage, RequestId } from "agent-dispatcher";
import type { DisplayAppendMode, TypeAgentAction } from "@typeagent/agent-sdk";
import type WebSocket from "ws";
import { WebSocketClientIO } from "./WebSocketClientIO.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:chat-rpc-server:protocol-wrapper");

/**
 * Interface for request tracking
 * Implemented by ShellWindow and ProtocolRequestManager
 */
export interface IProtocolRequestTracker {
    getProtocolRequestWebSocket(
        requestId: string | undefined,
    ): { ws: WebSocket; sessionId: string } | undefined;
}

/**
 * Wrapper around a host's native ClientIO that routes responses to WebSocket protocol clients
 *
 * Checks if a requestId is from a protocol client and sends responses to WebSocket instead of
 * (or in addition to) the native host ClientIO
 *
 * Shared by both Shell and CLI adapters
 */
export function createProtocolClientIOWrapper(
    nativeClientIO: ClientIO,
    requestTracker: IProtocolRequestTracker,
    sendToNativeForProtocolRequests: boolean = false,
): ClientIO {
    return {
        clear(): void {
            nativeClientIO.clear();
        },

        exit(): void {
            nativeClientIO.exit();
        },

        setDisplayInfo(
            source: string,
            requestId: RequestId,
            actionIndex?: number,
            action?: TypeAgentAction | string[],
        ): void {
            const protocolClient =
                requestTracker.getProtocolRequestWebSocket(requestId);

            // Send to WebSocket if this is a protocol request
            if (protocolClient) {
                const wsClientIO = new WebSocketClientIO(
                    protocolClient.ws,
                    protocolClient.sessionId,
                );
                wsClientIO.setDisplayInfo(
                    source,
                    requestId,
                    actionIndex,
                    action,
                );

                // Also send to native if configured (Shell behavior)
                if (sendToNativeForProtocolRequests) {
                    nativeClientIO.setDisplayInfo(
                        source,
                        requestId,
                        actionIndex,
                        action,
                    );
                }
                return;
            }

            // Send to native for non-protocol requests
            nativeClientIO.setDisplayInfo(
                source,
                requestId,
                actionIndex,
                action,
            );
        },

        setDisplay(message: IAgentMessage): void {
            const requestId = message.requestId;
            const protocolClient =
                requestTracker.getProtocolRequestWebSocket(requestId);

            // Send to WebSocket if this is a protocol request
            if (protocolClient) {
                debug(
                    `Routing setDisplay to WebSocket for request ${requestId}`,
                );
                const wsClientIO = new WebSocketClientIO(
                    protocolClient.ws,
                    protocolClient.sessionId,
                );
                wsClientIO.setDisplay(message);

                // Don't send to native for protocol requests (both Shell and CLI behavior)
                return;
            }

            // Send to native for non-protocol requests
            nativeClientIO.setDisplay(message);
        },

        appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void {
            const requestId = message.requestId;
            const protocolClient =
                requestTracker.getProtocolRequestWebSocket(requestId);

            // Send to WebSocket if this is a protocol request
            if (protocolClient) {
                debug(
                    `Routing appendDisplay to WebSocket for request ${requestId}`,
                );
                const wsClientIO = new WebSocketClientIO(
                    protocolClient.ws,
                    protocolClient.sessionId,
                );
                wsClientIO.appendDisplay(message, mode);

                // Don't send to native for protocol requests
                return;
            }

            // Send to native for non-protocol requests
            nativeClientIO.appendDisplay(message, mode);
        },

        appendDiagnosticData(requestId: RequestId, data: any): void {
            const protocolClient =
                requestTracker.getProtocolRequestWebSocket(requestId);

            // Send to WebSocket if this is a protocol request
            if (protocolClient) {
                const wsClientIO = new WebSocketClientIO(
                    protocolClient.ws,
                    protocolClient.sessionId,
                );
                wsClientIO.appendDiagnosticData(requestId, data);

                // Also send to native if configured (Shell behavior)
                if (sendToNativeForProtocolRequests) {
                    nativeClientIO.appendDiagnosticData(requestId, data);
                }
                return;
            }

            // Send to native for non-protocol requests
            nativeClientIO.appendDiagnosticData(requestId, data);
        },

        setDynamicDisplay(
            source: string,
            requestId: RequestId,
            actionIndex: number,
            displayId: string,
            nextRefreshMs: number,
        ): void {
            const protocolClient =
                requestTracker.getProtocolRequestWebSocket(requestId);

            // Send to WebSocket if this is a protocol request
            if (protocolClient) {
                const wsClientIO = new WebSocketClientIO(
                    protocolClient.ws,
                    protocolClient.sessionId,
                );
                wsClientIO.setDynamicDisplay(
                    source,
                    requestId,
                    actionIndex,
                    displayId,
                    nextRefreshMs,
                );

                // Also send to native if configured (Shell behavior)
                if (sendToNativeForProtocolRequests) {
                    nativeClientIO.setDynamicDisplay(
                        source,
                        requestId,
                        actionIndex,
                        displayId,
                        nextRefreshMs,
                    );
                }
                return;
            }

            // Send to native for non-protocol requests
            nativeClientIO.setDynamicDisplay(
                source,
                requestId,
                actionIndex,
                displayId,
                nextRefreshMs,
            );
        },

        async askYesNo(
            message: string,
            requestId: RequestId,
            defaultValue?: boolean,
        ): Promise<boolean> {
            return nativeClientIO.askYesNo(message, requestId, defaultValue);
        },

        async proposeAction(
            actionTemplates: any,
            requestId: RequestId,
            source: string,
        ): Promise<unknown> {
            return nativeClientIO.proposeAction(
                actionTemplates,
                requestId,
                source,
            );
        },

        async popupQuestion(
            message: string,
            choices: string[],
            defaultId: number | undefined,
            source: string,
        ): Promise<number> {
            return nativeClientIO.popupQuestion(
                message,
                choices,
                defaultId,
                source,
            );
        },

        notify(
            event: string,
            requestId: RequestId,
            data: any,
            source: string,
        ): void {
            const protocolClient =
                requestTracker.getProtocolRequestWebSocket(requestId);

            // Send to WebSocket if this is a protocol request
            if (protocolClient) {
                const wsClientIO = new WebSocketClientIO(
                    protocolClient.ws,
                    protocolClient.sessionId,
                );
                wsClientIO.notify(event, requestId, data, source);

                // Also send to native if configured (Shell behavior)
                if (sendToNativeForProtocolRequests) {
                    nativeClientIO.notify(event, requestId, data, source);
                }
                return;
            }

            // Send to native for non-protocol requests
            nativeClientIO.notify(event, requestId, data, source);
        },

        openLocalView(port: number): void {
            // Always forward to native (protocol clients get notified separately)
            nativeClientIO.openLocalView(port);
        },

        closeLocalView(port: number): void {
            // Always forward to native
            nativeClientIO.closeLocalView(port);
        },

        takeAction(action: string, data: unknown): void {
            // Always forward to native
            nativeClientIO.takeAction(action, data);
        },

        getProtocolRequestWebSocket(
            requestId: string | undefined,
        ): { ws: WebSocket; sessionId: string } | undefined {
            return requestTracker.getProtocolRequestWebSocket(requestId);
        },
    } as ClientIO & {
        getProtocolRequestWebSocket: typeof requestTracker.getProtocolRequestWebSocket;
    };
}
