// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ClientIO,
    IAgentMessage,
    RequestId,
} from "agent-dispatcher";
import {
    DisplayAppendMode,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { ShellWindow } from "./shellWindow.js";
import { WebSocketClientIO } from "./webSocketClientIO.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:shell:protocolClientIOWrapper");

/**
 * Wrapper around the shell's ClientIO that also routes responses to WebSocket protocol clients
 * Checks if a requestId is from a protocol client and sends responses to both Shell UI and WebSocket
 */
export function createProtocolClientIOWrapper(
    shellClientIO: ClientIO,
    shellWindow: ShellWindow,
): ClientIO {
    return {
        clear(): void {
            shellClientIO.clear();
        },

        exit(): void {
            shellClientIO.exit();
        },

        setDisplayInfo(
            source: string,
            requestId: RequestId,
            actionIndex?: number,
            action?: TypeAgentAction | string[],
        ): void {
            shellClientIO.setDisplayInfo(source, requestId, actionIndex, action);

            // Also send to WebSocket if this is a protocol request
            const protocolClient = shellWindow.getProtocolRequestWebSocket(requestId);
            if (protocolClient) {
                const wsClientIO = new WebSocketClientIO(
                    protocolClient.ws,
                    protocolClient.sessionId,
                );
                wsClientIO.setDisplayInfo(source, requestId, actionIndex, action);
            }
        },

        setDisplay(message: IAgentMessage): void {
            const requestId = message.requestId;
            const protocolClient = shellWindow.getProtocolRequestWebSocket(requestId);

            // Send to WebSocket if this is a protocol request
            if (protocolClient) {
                debug(`Routing setDisplay to WebSocket for request ${requestId}`);
                const wsClientIO = new WebSocketClientIO(
                    protocolClient.ws,
                    protocolClient.sessionId,
                );
                wsClientIO.setDisplay(message);
                // Don't send to shell UI for protocol requests
                return;
            }

            // Send to shell UI for non-protocol requests
            shellClientIO.setDisplay(message);
        },

        appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void {
            const requestId = message.requestId;
            const protocolClient = shellWindow.getProtocolRequestWebSocket(requestId);

            // Send to WebSocket if this is a protocol request
            if (protocolClient) {
                debug(`Routing appendDisplay to WebSocket for request ${requestId}`);
                const wsClientIO = new WebSocketClientIO(
                    protocolClient.ws,
                    protocolClient.sessionId,
                );
                wsClientIO.appendDisplay(message, mode);
                // Don't send to shell UI for protocol requests
                return;
            }

            // Send to shell UI for non-protocol requests
            shellClientIO.appendDisplay(message, mode);
        },

        appendDiagnosticData(requestId: RequestId, data: any): void {
            shellClientIO.appendDiagnosticData(requestId, data);

            // Also send to WebSocket if this is a protocol request
            const protocolClient = shellWindow.getProtocolRequestWebSocket(requestId);
            if (protocolClient) {
                const wsClientIO = new WebSocketClientIO(
                    protocolClient.ws,
                    protocolClient.sessionId,
                );
                wsClientIO.appendDiagnosticData(requestId, data);
            }
        },

        setDynamicDisplay(
            source: string,
            requestId: RequestId,
            actionIndex: number,
            displayId: string,
            nextRefreshMs: number,
        ): void {
            shellClientIO.setDynamicDisplay(
                source,
                requestId,
                actionIndex,
                displayId,
                nextRefreshMs,
            );

            // Also send to WebSocket if this is a protocol request
            const protocolClient = shellWindow.getProtocolRequestWebSocket(requestId);
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
            }
        },

        async askYesNo(
            message: string,
            requestId: RequestId,
            defaultValue?: boolean,
        ): Promise<boolean> {
            return shellClientIO.askYesNo(message, requestId, defaultValue);
        },

        async proposeAction(
            actionTemplates: any,
            requestId: RequestId,
            source: string,
        ): Promise<unknown> {
            return shellClientIO.proposeAction(actionTemplates, requestId, source);
        },

        async popupQuestion(
            message: string,
            choices: string[],
            defaultId: number | undefined,
            source: string,
        ): Promise<number> {
            return shellClientIO.popupQuestion(message, choices, defaultId, source);
        },

        notify(
            event: string,
            requestId: RequestId,
            data: any,
            source: string,
        ): void {
            shellClientIO.notify(event, requestId, data, source);

            // Also send to WebSocket if this is a protocol request
            const protocolClient = shellWindow.getProtocolRequestWebSocket(requestId);
            if (protocolClient) {
                const wsClientIO = new WebSocketClientIO(
                    protocolClient.ws,
                    protocolClient.sessionId,
                );
                wsClientIO.notify(event, requestId, data, source);
            }
        },

        openLocalView(port: number): void {
            shellClientIO.openLocalView(port);
        },

        closeLocalView(port: number): void {
            shellClientIO.closeLocalView(port);
        },

        takeAction(action: string, data: unknown): void {
            shellClientIO.takeAction(action, data);
        },
    };
}
