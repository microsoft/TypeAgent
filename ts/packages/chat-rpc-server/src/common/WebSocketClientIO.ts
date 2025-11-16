// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "ws";
import type { ClientIO, IAgentMessage, RequestId } from "agent-dispatcher";
import type {
    DisplayAppendMode,
    TypeAgentAction,
    DisplayContent,
} from "@typeagent/agent-sdk";
import registerDebug from "debug";

const debug = registerDebug("typeagent:chat-rpc-server:webSocketClientIO");

/**
 * ClientIO implementation that sends all output through a WebSocket connection
 * This allows external clients to receive TypeAgent responses via the protocol
 *
 * Shared by both Shell and CLI adapters
 */
export class WebSocketClientIO implements ClientIO {
    constructor(
        private ws: WebSocket,
        private sessionId: string,
    ) {}

    /**
     * Check if WebSocket is still open
     */
    private isConnected(): boolean {
        return this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Send a protocol message through WebSocket
     */
    private send(message: any): void {
        if (this.isConnected()) {
            this.ws.send(JSON.stringify(message));
            debug(`Sent message type: ${message.type}`);
        } else {
            debug("Cannot send message, WebSocket not open");
        }
    }

    /**
     * Convert DisplayContent to plain text for WebSocket transmission
     */
    private displayContentToText(content: DisplayContent): string {
        if (typeof content === "string") {
            return content;
        }

        if (Array.isArray(content)) {
            if (content.length === 0) {
                return "";
            }
            // Check if it's a table (array of arrays)
            if (Array.isArray(content[0])) {
                const table = content as string[][];
                return table.map((row) => row.join(" | ")).join("\n");
            }
            // Multiple lines
            return content.join("\n");
        }

        // Object with type and content
        if ("content" in content) {
            const innerContent = content.content;
            if (typeof innerContent === "string") {
                return innerContent;
            }
            if (Array.isArray(innerContent)) {
                return innerContent.join("\n");
            }
        }

        return String(content);
    }

    /**
     * Determine content type from DisplayContent
     */
    private getContentType(
        content: DisplayContent,
    ): "text" | "markdown" | "html" {
        if (typeof content === "object" && !Array.isArray(content)) {
            if ("type" in content) {
                const type = (content as any).type;
                if (type === "html") return "html";
                if (type === "markdown") return "markdown";
            }
        }
        return "text";
    }

    // ========== ClientIO Interface Implementation ==========

    clear(): void {
        // Not applicable for WebSocket - client handles their own display
        debug("clear() called - ignored for WebSocket client");
    }

    exit(): void {
        // Close the WebSocket connection
        debug("exit() called - closing WebSocket");
        this.send({
            type: "closeSession",
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            reason: "Dispatcher requested exit",
        });
        this.ws.close();
    }

    setDisplayInfo(
        source: string,
        requestId: RequestId,
        _actionIndex?: number,
        _action?: TypeAgentAction | string[],
    ): void {
        // Send action info as metadata
        debug(`setDisplayInfo: source=${source}, requestId=${requestId}`);
        // This is typically internal info - we could send it as a separate message if needed
    }

    setDisplay(message: IAgentMessage): void {
        debug(`setDisplay: ${message.source}`);

        const content = this.displayContentToText(message.message);
        const contentType = this.getContentType(message.message);

        this.send({
            type: "response",
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            requestId: message.requestId || "unknown",
            content,
            contentType,
            metadata: {
                source: message.source,
                actionIndex: message.actionIndex,
                metrics: message.metrics,
            },
        });
    }

    appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void {
        debug(`appendDisplay: ${message.source}, mode=${mode}`);

        const content = this.displayContentToText(message.message);
        const contentType = this.getContentType(message.message);

        debug("[WebSocketClientIO] appendDisplay content:", content.substring(0, 200));

        // Check if this is a delegation marker
        try {
            const parsed = JSON.parse(content);
            debug("[WebSocketClientIO] Parsed JSON, checking _delegationType:", parsed._delegationType);
            if (parsed._delegationType === "external_chat") {
                debug("[WebSocketClientIO] ✓ Detected delegation marker - sending invoke_external_chat");
                debug("Detected delegation marker - sending invoke_external_chat");
                this.send({
                    type: "invoke_external_chat",
                    timestamp: new Date().toISOString(),
                    sessionId: this.sessionId,
                    requestId: parsed.requestId || message.requestId || "unknown",
                    query: parsed.query,
                    context: {
                        conversationHistory: [],
                        metadata: {},
                    },
                });
                return;
            } else {
                debug("[WebSocketClientIO] Not a delegation marker, sending as partialResponse");
            }
        } catch (e) {
            debug("[WebSocketClientIO] Not valid JSON or parse error:", e instanceof Error ? e.message : String(e));
            // Not JSON or not a delegation marker, continue with normal flow
        }

        // Send as a partial response
        this.send({
            type: "partialResponse",
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            requestId: message.requestId || "unknown",
            content,
            contentType,
            appendMode: mode,
            metadata: {
                source: message.source,
                actionIndex: message.actionIndex,
            },
        });
    }

    appendDiagnosticData(requestId: RequestId, data: any): void {
        debug(`appendDiagnosticData: requestId=${requestId}`);

        this.send({
            type: "diagnostics",
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            requestId: requestId || "unknown",
            data,
        });
    }

    setDynamicDisplay(
        source: string,
        requestId: RequestId,
        actionIndex: number,
        displayId: string,
        nextRefreshMs: number,
    ): void {
        debug(`setDynamicDisplay: source=${source}, displayId=${displayId}`);

        this.send({
            type: "dynamicDisplay",
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            requestId: requestId || "unknown",
            displayId,
            nextRefreshMs,
            metadata: {
                source,
                actionIndex,
            },
        });
    }

    async askYesNo(
        message: string,
        requestId: RequestId,
        defaultValue?: boolean,
    ): Promise<boolean> {
        debug(`askYesNo: ${message}`);

        // Send question to client
        this.send({
            type: "question",
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            requestId: requestId || "unknown",
            questionType: "yesNo",
            message,
            defaultValue,
        });

        // For now, return default value
        // TODO: In future, implement async response handling
        return defaultValue ?? false;
    }

    async proposeAction(
        actionTemplates: any,
        requestId: RequestId,
        source: string,
    ): Promise<unknown> {
        debug(`proposeAction: source=${source}`);

        // Send action proposal to client
        this.send({
            type: "actionProposal",
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            requestId: requestId || "unknown",
            actionTemplates,
            source,
        });

        // For now, return undefined (auto-accept)
        // TODO: Implement async response handling
        return undefined;
    }

    async popupQuestion(
        message: string,
        choices: string[],
        defaultId: number | undefined,
        source: string,
    ): Promise<number> {
        debug(`popupQuestion: ${message}`);

        // Send question to client
        this.send({
            type: "question",
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            requestId: "popup",
            questionType: "choice",
            message,
            choices,
            defaultId,
            source,
        });

        // For now, return default choice
        // TODO: Implement async response handling
        return defaultId ?? 0;
    }

    notify(
        event: string,
        requestId: RequestId,
        data: any,
        source: string,
    ): void {
        debug(`notify: event=${event}, source=${source}`);

        this.send({
            type: "notification",
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            requestId: requestId || "unknown",
            event,
            data,
            source,
        });
    }

    openLocalView(port: number): void {
        debug(`openLocalView: port=${port}`);

        this.send({
            type: "localView",
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            action: "open",
            port,
        });
    }

    closeLocalView(port: number): void {
        debug(`closeLocalView: port=${port}`);

        this.send({
            type: "localView",
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            action: "close",
            port,
        });
    }

    takeAction(action: string, data: unknown): void {
        debug(`takeAction: action=${action}`);

        this.send({
            type: "action",
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            action,
            data,
        });
    }
}
