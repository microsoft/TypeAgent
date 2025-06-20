// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Editor } from "@milkdown/core";
import { editorViewCtx } from "@milkdown/core";
import type {
    AgentRequest,
    AgentCommandParams,
    StreamEvent,
    DocumentOperation,
    AgentCommand,
} from "../types";
import { AI_CONFIG, EDITOR_CONFIG } from "../config";
import {
    insertContentChunk,
    insertMarkdownContentAtEnd,
    contentItemToNode,
} from "../utils";

export class AIAgentManager {
    private editor: Editor | null = null;
    private notificationManager: any = null;
    private aiPresenceIndicator: HTMLElement | null = null;
    // private aiCursorPosition: number = -1; // Currently unused
    private isTestMode: boolean = false; // Track test mode to prevent duplicate content

    public setEditor(editor: Editor): void {
        this.editor = editor;
    }

    public setNotificationManager(notificationManager: any): void {
        this.notificationManager = notificationManager;
    }

    public async executeAgentCommand(
        command: AgentCommand,
        params: AgentCommandParams,
    ): Promise<void> {
        try {
            console.log(`🤖 Executing agent command: ${command}`, params);

            // Show AI cursor at target position immediately
            this.showAICursor(params.position || 0);

            // Always use streaming for better UX
            await this.executeStreamingAgentCommand(command, params);
        } catch (error) {
            console.error(`Agent command failed:`, error);
            this.hideAICursor();
            this.showNotification(
                `Failed to execute ${command} command. Please try again.`,
                "error",
            );
        }
    }

    private async executeStreamingAgentCommand(
        command: AgentCommand,
        params: AgentCommandParams,
    ): Promise<void> {
        const request = this.buildAgentRequest(command, params);

        // Track test mode to prevent duplicate content insertion
        this.isTestMode = params.testMode || false;

        // Track if we actually received any successful operations
        let operationsReceived = false;
        let errorOccurred = false;

        // Show AI presence cursor
        this.showAIPresence(true);

        try {
            // Call streaming endpoint
            const response = await fetch(AI_CONFIG.ENDPOINTS.STREAM, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(request),
            });

            if (!response.ok) {
                throw new Error(`Streaming failed: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error("No response stream available");
            }

            const result = await this.processStreamResponse(
                reader,
                params.position || 0,
            );
            operationsReceived = result.operationsReceived;
            errorOccurred = result.errorOccurred;

            // Only show success message if we actually received operations and no errors occurred
            if (operationsReceived && !errorOccurred) {
                console.log("Streaming command completed successfully");
                this.showNotification(
                    `${command} completed successfully!`,
                    "success",
                );
            } else if (errorOccurred) {
                // Error message already shown in stream handler, just log
                console.error("Streaming command failed");
            } else {
                // No operations but no explicit error - agent might be unavailable
                console.log(
                    "Streaming command completed but no content generated",
                );
            }
        } finally {
            // Hide AI presence cursor
            this.showAIPresence(false);
        }
    }

    private async processStreamResponse(
        reader: ReadableStreamDefaultReader<Uint8Array>,
        position: number,
    ): Promise<{ operationsReceived: boolean; errorOccurred: boolean }> {
        const decoder = new TextDecoder();
        let buffer = "";
        let operationsReceived = false;
        let errorOccurred = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete lines
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        const result = await this.handleStreamEvent(
                            data,
                            position,
                        );
                        if (result.operationsReceived)
                            operationsReceived = true;
                        if (result.errorOccurred) errorOccurred = true;
                    } catch (e) {
                        console.warn("Failed to parse stream data:", line);
                    }
                }
            }
        }

        return { operationsReceived, errorOccurred };
    }

    private async handleStreamEvent(
        data: StreamEvent,
        position: number,
    ): Promise<{ operationsReceived: boolean; errorOccurred: boolean }> {
        let operationsReceived = false;
        let errorOccurred = false;

        switch (data.type) {
            case "start":
                console.log("Stream started:", data.message);
                break;

            case "typing":
                this.updateAIPresenceMessage(
                    data.message || "AI is thinking...",
                );
                break;

            case "notification":
                // Handle success/error notifications from agent
                const notificationType = (data as any).notificationType;
                const message = (data as any).message;

                console.log(`[${notificationType?.toUpperCase()}] ${message}`);
                this.showNotification(message, notificationType);

                // Track errors
                if (notificationType === "error") {
                    errorOccurred = true;
                }
                break;

            case "operationsApplied":
                // Operations already applied by agent, just track completion
                const operationCount = (data as any).operationCount || 0;
                console.log(`Agent applied ${operationCount} operations`);

                // Only count as operations received if we actually got some operations
                if (operationCount > 0) {
                    operationsReceived = true;
                }
                break;

            case "llmOperations":
                // PRODUCTION: Handle operations sent to PRIMARY client only via SSE
                console.log(
                    `[LLM-OPS] Received ${(data as any).operations?.length || 0} operations via SSE (role: ${(data as any).clientRole || "unknown"})`,
                );

                // LOG DETAILED OPERATION OBJECTS
                if (
                    (data as any).operations &&
                    Array.isArray((data as any).operations)
                ) {
                    console.log(`[LLM-OPS-DEBUG] Detailed operation objects:`);
                    (data as any).operations.forEach(
                        (operation: any, index: number) => {
                            console.log(
                                `[LLM-OPS-DEBUG] Operation ${index + 1}:`,
                                {
                                    type: operation.type,
                                    position: operation.position,
                                    from: operation.from,
                                    to: operation.to,
                                    content: operation.content,
                                    description: operation.description,
                                    fullOperation: operation,
                                },
                            );

                            // Log content structure in detail
                            if (operation.content) {
                                console.log(
                                    `[LLM-OPS-DEBUG] Operation ${index + 1} content structure:`,
                                    JSON.stringify(operation.content, null, 2),
                                );
                            }
                        },
                    );
                }

                if (
                    (data as any).clientRole === "primary" &&
                    (data as any).operations &&
                    Array.isArray((data as any).operations)
                ) {
                    // Apply operations through editor API (ensures proper markdown parsing)
                    console.log(
                        `[LLM-OPS-DEBUG] About to apply ${(data as any).operations.length} operations through applyAgentOperations`,
                    );
                    this.applyAgentOperations((data as any).operations);
                    operationsReceived = true;

                    console.log(
                        `[LLM-OPS] PRIMARY CLIENT applied ${(data as any).operations.length} operations via editor API`,
                    );
                } else if ((data as any).clientRole !== "primary") {
                    console.log(
                        `[LLM-OPS] Ignoring operations - not the primary client (role: ${(data as any).clientRole || "unknown"})`,
                    );
                } else {
                    console.warn(
                        `[LLM-OPS] No valid operations in SSE event:`,
                        data,
                    );
                }
                break;

            case "operationsBeingApplied":
                // Handle notification that operations are being applied by primary client
                console.log(
                    `[LLM-OPS] Operations being applied by primary client - ${(data as any).operationCount} changes incoming`,
                );
                this.updateAIPresenceMessage(
                    `AI is applying ${(data as any).operationCount} changes...`,
                );
                break;

            case "complete":
                this.showAIPresence(false);
                this.hideAICursor(); // Ensure AI cursor is hidden when complete
                this.isTestMode = false; // Reset test mode flag
                console.log("Streaming command completed");
                break;

            case "error":
                console.log(`[ERROR] ${(data as any).error}`);
                this.showNotification((data as any).error, "error");
                this.showAIPresence(false);
                this.hideAICursor(); // Hide cursor on error
                this.isTestMode = false; // Reset test mode flag on error
                errorOccurred = true;
                break;

            // Legacy content handlers for backward compatibility
            case "content":
                // Skip content events for test mode commands to prevent duplicate content
                // Test mode sends both content chunks AND operations, but we only want operations
                if (this.isTestMode) {
                    console.log(
                        "Skipping content chunk in test mode to prevent duplicate:",
                        data.chunk?.substring(0, 50) + "...",
                    );
                    break;
                }

                // Insert content chunk at position for non-test content
                if (this.editor && data.chunk) {
                    await insertContentChunk(
                        this.editor,
                        data.chunk,
                        data.position || position,
                    );
                    operationsReceived = true; // Content insertion counts as operation
                }
                break;

            case "operation":
                // Apply operation to document
                if (data.operation) {
                    this.applyAgentOperations([data.operation]);
                    operationsReceived = true;
                }
                break;
        }

        return { operationsReceived, errorOccurred };
    }

    private buildAgentRequest(
        command: AgentCommand,
        params: AgentCommandParams,
    ): AgentRequest {
        let originalRequest = "";

        // Add test prefix if in test mode
        const prefix = params.testMode
            ? AI_CONFIG.COMMAND_PREFIXES.TEST
            : AI_CONFIG.COMMAND_PREFIXES.STANDARD;

        switch (command) {
            case "continue":
                originalRequest = `${prefix}continue`;
                break;
            case "diagram":
                originalRequest = `${prefix}diagram ${params.description || ""}`;
                break;
            case "augment":
                originalRequest = `${prefix}augment ${params.instruction || ""}`;
                break;
        }

        return {
            action: "updateDocument",
            parameters: {
                originalRequest,
                context: {
                    position: params.position || 0,
                    command: command,
                    params: params,
                },
            },
        };
    }

    private applyAgentOperations(operations: DocumentOperation[]): void {
        if (!this.editor) {
            console.error("Editor not initialized");
            return;
        }

        console.log("Applying operations from agent:", operations);

        this.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            let tr = view.state.tr;

            for (const operation of operations) {
                switch (operation.type) {
                    case "insert":
                        tr = this.applyInsertOperation(tr, operation, view);
                        break;
                    case "insertMarkdown":
                        tr = this.applyInsertMarkdownOperation(
                            tr,
                            operation,
                            view,
                        );
                        break;
                    // Add more operation types as needed
                }
            }

            if (tr.docChanged) {
                view.dispatch(tr);
            }
        });
    }

    private applyInsertOperation(
        tr: any,
        operation: DocumentOperation,
        view: any,
    ): any {
        try {
            const schema = view.state.schema;
            const position = operation.position || tr.selection.head;

            if (operation.content && Array.isArray(operation.content)) {
                for (const contentItem of operation.content) {
                    const node = contentItemToNode(contentItem, schema);
                    if (node) {
                        tr = tr.insert(position, node);
                    }
                }
            }
        } catch (error) {
            console.error("Failed to apply insert operation:", error);
        }

        return tr;
    }

    private applyInsertMarkdownOperation(
        tr: any,
        operation: any,
        view: any,
    ): any {
        try {
            const markdown = operation.markdown || "";

            // Parse markdown content and create proper nodes
            setTimeout(() => {
                insertMarkdownContentAtEnd(markdown, view);
            }, EDITOR_CONFIG.TIMING.MARKDOWN_UPDATE_DELAY);

            return tr;
        } catch (error) {
            console.error("Failed to apply insert markdown operation:", error);
            const position = operation.position || tr.selection.head;
            const markdown = operation.markdown || "";
            return tr.insertText(markdown, position);
        }
    }

    private showAIPresence(show: boolean): void {
        if (show) {
            if (!this.aiPresenceIndicator) {
                this.aiPresenceIndicator = this.createAIPresenceIndicator();
                document.body.appendChild(this.aiPresenceIndicator);
            }
            this.aiPresenceIndicator.style.display = "block";
        } else {
            if (this.aiPresenceIndicator) {
                this.aiPresenceIndicator.style.display = "none";
            }
        }
    }

    private createAIPresenceIndicator(): HTMLElement {
        const indicator = document.createElement("div");
        indicator.id = "ai-presence-indicator";
        indicator.className = "ai-presence-indicator";
        indicator.innerHTML = `
      <div class="ai-avatar">🤖</div>
      <div class="ai-message">AI is thinking...</div>
      <div class="ai-typing-dots">
        <span></span><span></span><span></span>
      </div>
    `;
        return indicator;
    }

    private updateAIPresenceMessage(message: string): void {
        if (this.aiPresenceIndicator) {
            const messageEl =
                this.aiPresenceIndicator.querySelector(".ai-message");
            if (messageEl) {
                messageEl.textContent = message;
            }
        }
    }

    private showNotification(
        message: string,
        type: "success" | "error" | "info" = "info",
    ): void {
        if (this.notificationManager) {
            this.notificationManager.showNotification(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    /**
     * Show AI cursor at specific position in the document
     */
    private showAICursor(position: number): void {
        if (!this.editor) return;

        // this.aiCursorPosition = position;
        console.log(`🤖 [AI-CURSOR] Showing AI cursor at position ${position}`);

        try {
            this.editor.action((ctx: any) => {
                const view = ctx.get(editorViewCtx);

                // Create AI cursor decoration at the specified position
                const validPosition = Math.min(
                    position,
                    view.state.doc.content.size,
                );

                // Add AI cursor styling (you can customize this CSS)
                const cursorElement = document.createElement("span");
                cursorElement.className = "ai-cursor-indicator";
                cursorElement.innerHTML = "🤖";
                cursorElement.style.cssText = `
                    position: absolute;
                    color: #3b82f6;
                    font-size: 16px;
                    animation: ai-cursor-blink 1s infinite;
                    z-index: 1000;
                    pointer-events: none;
                `;

                // Add blinking animation if not already added
                if (!document.querySelector("#ai-cursor-styles")) {
                    const styles = document.createElement("style");
                    styles.id = "ai-cursor-styles";
                    styles.textContent = `
                        @keyframes ai-cursor-blink {
                            0%, 50% { opacity: 1; }
                            51%, 100% { opacity: 0.3; }
                        }
                        .ai-cursor-indicator {
                            transition: all 0.2s ease;
                        }
                    `;
                    document.head.appendChild(styles);
                }

                // Position the cursor element
                this.positionAICursorElement(
                    cursorElement,
                    view,
                    validPosition,
                );

                // Store reference for cleanup
                this.aiPresenceIndicator = cursorElement;
            });
        } catch (error) {
            console.error(" [AI-CURSOR] Failed to show AI cursor:", error);
        }
    }

    /**
     * Position the AI cursor element in the editor
     */
    private positionAICursorElement(
        element: HTMLElement,
        view: any,
        position: number,
    ): void {
        try {
            const coords = view.coordsAtPos(position);
            const editorRect = view.dom.getBoundingClientRect();

            element.style.left = `${coords.left - editorRect.left}px`;
            element.style.top = `${coords.top - editorRect.top}px`;

            // Append to editor if not already there
            if (!element.parentNode) {
                view.dom.appendChild(element);
            }
        } catch (error) {
            console.warn(
                " [AI-CURSOR] Could not position cursor element:",
                error,
            );
        }
    }

    /**
     * Hide AI cursor
     */
    private hideAICursor(): void {
        if (this.aiPresenceIndicator) {
            console.log(`🤖 [AI-CURSOR] Hiding AI cursor`);
            this.aiPresenceIndicator.remove();
            this.aiPresenceIndicator = null;
            // this.aiCursorPosition = -1;
        }
    }
}

// Export singleton instance for global access
export const aiAgentManager = new AIAgentManager();

// Export function for external access (maintains compatibility)
export async function executeAgentCommand(
    command: AgentCommand,
    params: AgentCommandParams,
): Promise<void> {
    return aiAgentManager.executeAgentCommand(command, params);
}
