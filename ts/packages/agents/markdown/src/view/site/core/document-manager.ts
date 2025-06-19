// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Editor } from "@milkdown/core";
import { editorViewCtx, parserCtx } from "@milkdown/core";
import type { SaveStatus } from "../types";
import { AI_CONFIG, DEFAULT_MARKDOWN_CONTENT, EDITOR_CONFIG } from "../config";

export class DocumentManager {
    private notificationManager: any = null;
    private editorManager: any = null;
    private eventSource: EventSource | null = null;
    private autoSaveTimer: NodeJS.Timeout | null = null;
    private isPrimaryClient = false;
    private lastAutoSaveContent = "";
    private currentDocumentId = "default";

    public setNotificationManager(notificationManager: any): void {
        this.notificationManager = notificationManager;
    }

    public setEditorManager(editorManager: any): void {
        this.editorManager = editorManager;
    }

    public getEditorManager(): any {
        return this.editorManager;
    }

    public getCollaborationManager(): any {
        return this.editorManager?.getCollaborationManager();
    }

    public async initialize(): Promise<void> {
        // Set up SSE connection for document change notifications
        this.setupSSEConnection();

        // Initialize auto-save if enabled
        if (EDITOR_CONFIG.FEATURES.AUTO_SAVE) {
            this.startAutoSave();
        }
    }

    /**
     * Start auto-save timer for primary client
     */
    private startAutoSave(): void {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }

        console.log("[AUTO-SAVE] Starting auto-save timer...");

        this.autoSaveTimer = setInterval(async () => {
            if (this.isPrimaryClient && EDITOR_CONFIG.FEATURES.AUTO_SAVE) {
                await this.performAutoSave();
            }
        }, EDITOR_CONFIG.TIMING.AUTO_SAVE_INTERVAL);
    }

    /**
     * Perform auto-save if content has changed
     */
    private async performAutoSave(): Promise<void> {
        try {
            if (!this.editorManager) {
                console.log("[AUTO-SAVE] Skipping - no editor manager");
                return;
            }

            const editor = this.editorManager.getEditor();
            if (!editor) {
                console.log("[AUTO-SAVE] Skipping - no editor");
                return;
            }

            // Get current content using editor API
            const currentContent = await this.getMarkdownContent(editor);

            // Only save if content has changed
            if (currentContent === this.lastAutoSaveContent) {
                console.log("[AUTO-SAVE] Skipping - content unchanged");
                return;
            }

            console.log(`[AUTO-SAVE] Content changed, auto-saving...`);

            // Get current document path from server
            const docInfo = await this.getCurrentDocumentInfo();

            // Send auto-save request
            const response = await fetch(AI_CONFIG.ENDPOINTS.AUTOSAVE, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: currentContent,
                    filePath: docInfo.fullPath,
                    documentId: this.currentDocumentId,
                }),
            });

            if (response.ok) {
                this.lastAutoSaveContent = currentContent;
                console.log("[AUTO-SAVE] Successfully saved document");
            } else {
                console.error(
                    "[AUTO-SAVE] Failed to save:",
                    response.statusText,
                );
            }
        } catch (error) {
            console.error("[AUTO-SAVE] Error during auto-save:", error);
        }
    }

    /**
     * Get current document info from server
     */
    private async getCurrentDocumentInfo(): Promise<{
        currentDocument: string;
        fullPath: string | null;
    }> {
        try {
            const response = await fetch("/api/current-document");
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.warn("Failed to get current document info:", error);
        }

        // Fallback
        return {
            currentDocument: this.currentDocumentId,
            fullPath: null,
        };
    }

    private setupSSEConnection(): void {
        try {
            this.eventSource = new EventSource("/events");

            this.eventSource.onopen = () => {
                console.log("[SSE] Connected to server events");
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleSSEEvent(data);
                } catch (error) {
                    console.error("[SSE] Failed to parse event data:", error);
                    console.error(
                        "[SSE] Raw event data:",
                        event.data?.substring(0, 100) + "...",
                    );
                    // Don't crash on parse errors - just log and continue
                }
            };

            this.eventSource.onerror = (error) => {
                console.error("[SSE] Connection error:", error);
                // Reconnect after a delay
                setTimeout(() => {
                    if (this.eventSource?.readyState === EventSource.CLOSED) {
                        console.log("[SSE] Reconnecting...");
                        this.setupSSEConnection();
                    }
                }, 5000);
            };
        } catch (error) {
            console.error("[SSE] Failed to setup connection:", error);
        }
    }

    private async handleSSEEvent(data: any): Promise<void> {
        console.log("[SSE] Received event:", data.type, data);

        switch (data.type) {
            case "documentChanged":
                console.log(`[SSE] Document changed to: ${data.newDocumentId}`);
                this.currentDocumentId = data.newDocumentId;

                // Reset sync notification state for new document
                if (this.notificationManager) {
                    this.notificationManager.resetDocumentSyncState(
                        data.newDocumentId,
                    );
                }

                await this.handleDocumentChangeFromBackend(
                    data.newDocumentId,
                    data.newDocumentName,
                );
                break;

            case "documentUpdated":
                console.log(`[SSE] Document updated: ${data.documentName}`);
                console.log(
                    `[SSE] Document updated timestamp: ${data.timestamp}`,
                );

                // Document content was updated - WebSocket should handle the sync
                // But let's add a fallback check in case WebSocket fails
                if (this.editorManager) {
                    console.log(
                        `[SSE-FALLBACK] Checking WebSocket connection status...`,
                    );
                    const collaborationManager = this.getCollaborationManager();

                    if (
                        collaborationManager &&
                        !collaborationManager.isConnected()
                    ) {
                        console.log(
                            `[SSE-FALLBACK] WebSocket disconnected, triggering content refresh from SSE event`,
                        );

                        // Fallback: manually refresh content from server
                        try {
                            await this.getDocumentContent();
                            // Note: We don't set content directly to avoid conflicts, just log for debugging
                            console.log(
                                `[SSE-FALLBACK] Server content available for sync`,
                            );

                            if (this.notificationManager) {
                                this.notificationManager.showNotification(
                                    "Document updated (WebSocket reconnecting...)",
                                    "info",
                                );

                                // Mark as disconnected for sync notification tracking
                                this.notificationManager.markDocumentDisconnected(
                                    data.documentName || this.currentDocumentId,
                                );
                            }
                        } catch (error) {
                            console.error(
                                `[SSE-FALLBACK] Failed to refresh content:`,
                                error,
                            );
                        }
                    } else {
                        console.log(
                            ` [SSE] WebSocket connected - no fallback needed`,
                        );
                    }
                } else {
                    console.log(
                        `[SSE] No editor manager available for WebSocket status check`,
                    );
                }
                break;

            case "documentSynced":
                console.log(`[SSE] Document synchronized: ${data.documentId}`);
                if (this.notificationManager) {
                    this.notificationManager.showDocumentSyncNotification(
                        data.documentId || this.currentDocumentId,
                    );
                }
                break;

            case "autoSave":
                console.log(`[SSE] Auto-save completed for: ${data.filePath}`);
                // Show brief save notification
                if (this.notificationManager) {
                    this.notificationManager.showNotification(
                        `Auto-saved: ${data.filePath}`,
                        "info",
                    );
                }
                break;

            case "autoSaveError":
                console.error(`[SSE] Auto-save error: ${data.error}`);
                if (this.notificationManager) {
                    this.notificationManager.showNotification(
                        `Auto-save failed: ${data.error}`,
                        "error",
                    );
                }
                break;

            case "llmOperations":
                // PRODUCTION: Handle LLM operations sent to PRIMARY client only via SSE
                // Apply operations through editor API for proper markdown parsing
                if (
                    data.clientRole === "primary" &&
                    data.operations &&
                    Array.isArray(data.operations) &&
                    this.editorManager
                ) {
                    try {
                        // Mark this client as primary for auto-save
                        this.isPrimaryClient = true;
                        console.log(
                            "[SSE] Marked as PRIMARY CLIENT for auto-save",
                        );

                        // Apply operations through editor API for proper markdown parsing
                        const editor = this.editorManager.getEditor();
                        if (editor) {
                            await this.applyOperationsThroughEditor(
                                editor,
                                data.operations,
                            );
                            console.log(
                                ` [SSE] Applied ${data.operations.length} operations via editor API`,
                            );

                            if (this.notificationManager) {
                                this.notificationManager.showNotification(
                                    `✨  AI updated document with ${data.operations.length} changes`,
                                    "success",
                                );
                            }
                        } else {
                            console.warn(
                                ` [SSE] No editor available to apply operations`,
                            );
                        }
                    } catch (error) {
                        console.error(
                            `[ERROR] [SSE] Failed to apply LLM operations:`,
                            error,
                        );
                        if (this.notificationManager) {
                            this.notificationManager.showNotification(
                                `❌ Failed to apply AI changes`,
                                "error",
                            );
                        }
                    }
                } else if (data.clientRole !== "primary") {
                    // Mark as secondary client
                    this.isPrimaryClient = false;
                    console.log(`[SSE] Marked as SECONDARY CLIENT`);
                } else {
                    console.warn(
                        `[SSE] Invalid LLM operations received:`,
                        data,
                    );
                }
                break;

            case "operationsBeingApplied":
                // Handle notification that operations are being applied by primary client
                console.log(
                    `[SSE] Operations being applied by primary client - ${data.operationCount} changes incoming`,
                );

                if (this.notificationManager) {
                    this.notificationManager.showNotification(
                        `AI is updating document (${data.operationCount} changes)...`,
                        "info",
                    );
                }
                break;

            default:
                // Log unknown event types for debugging
                console.log(`[SSE] Unknown event type: ${data.type}`, data);
                break;
        }
    }

    private async handleDocumentChangeFromBackend(
        documentId: string,
        documentName: string,
    ): Promise<void> {
        try {
            console.log(
                `[DOCUMENT] Backend switched to: ${documentName}, reconnecting frontend...`,
            );

            // Get content from server with URL logging
            const documentUrl = AI_CONFIG.ENDPOINTS.DOCUMENT;

            const response = await fetch(documentUrl);

            const content = response.ok ? await response.text() : "";
            console.log(
                ` [DOCUMENT] Frontend switched to document: "${documentId}"`,
            );

            // Switch editor collaboration to new document room
            if (this.editorManager) {
                await this.editorManager.switchToDocument(documentId, content);
            }

            // Update page title and URL
            document.title = `${documentName} - AI-Enhanced Markdown Editor`;
            const newUrl = `/document/${encodeURIComponent(documentName)}`;
            window.history.pushState({ documentName }, document.title, newUrl);

            if (this.notificationManager) {
                this.notificationManager.showNotification(
                    `📄 Switched to: ${documentName}`,
                    "success",
                );
            }
        } catch (error) {
            console.error(
                "[DOCUMENT] Failed to handle backend document change:",
                error,
            );
        }
    }

    public destroy(): void {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }

        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }

    public async saveDocument(editor?: Editor): Promise<void> {
        try {
            this.showSaveStatus("saving");

            // Get markdown content from editor or server
            const content = editor
                ? await this.getMarkdownContent(editor)
                : await this.loadContentFromServer();

            const saveUrl = AI_CONFIG.ENDPOINTS.DOCUMENT;

            const response = await fetch(saveUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
            });

            if (!response.ok) {
                throw new Error(`Save failed: ${response.status}`);
            }

            console.log(` [DOCUMENT] Document saved successfully`);
            this.showSaveStatus("saved");
        } catch (error) {
            console.error("[DOCUMENT] Failed to save document:", error);
            this.showSaveStatus("error");
            throw error;
        }
    }

    public async getMarkdownContent(editor: Editor): Promise<string> {
        if (!editor) return "";

        try {
            // Get content directly from editor first (most current state)
            const editorContent = await new Promise<string>((resolve) => {
                editor.action((ctx) => {
                    const view = ctx.get(editorViewCtx);
                    resolve(view.state.doc.textContent || "");
                });
            });

            if (editorContent) {
                return editorContent;
            }
        } catch (error) {
            console.warn("Failed to get content from editor:", error);
        }

        try {
            // Fallback to server content if editor content is empty
            const response = await fetch(AI_CONFIG.ENDPOINTS.DOCUMENT);
            if (response.ok) {
                const serverContent = await response.text();
                return serverContent;
            }
        } catch (error) {
            console.warn("Failed to fetch document from server:", error);
        }

        return "";
    }

    public async loadInitialContent(): Promise<string> {
        try {
            const documentUrl = AI_CONFIG.ENDPOINTS.DOCUMENT;

            const response = await fetch(documentUrl);

            if (response.ok) {
                const content = await response.text();
                return content;
            } else {
                return this.getDefaultContent();
            }
        } catch (error) {
            console.error("[DOCUMENT] Failed to load initial content:", error);
            return this.getDefaultContent();
        }
    }

    private async loadContentFromServer(): Promise<string> {
        const documentUrl = AI_CONFIG.ENDPOINTS.DOCUMENT;

        const response = await fetch(documentUrl);

        if (response.ok) {
            const content = await response.text();
            return content;
        }
        throw new Error(
            `Failed to load content from server: ${response.status} ${response.statusText}`,
        );
    }

    private getDefaultContent(): string {
        // Import from config - use the exported constant
        return DEFAULT_MARKDOWN_CONTENT;
    }

    private showSaveStatus(status: SaveStatus): void {
        if (this.notificationManager) {
            this.notificationManager.showSaveStatus(status);
        }
    }

    public async getDocumentContent(): Promise<string> {
        try {
            const documentUrl = AI_CONFIG.ENDPOINTS.DOCUMENT;

            const response = await fetch(documentUrl);

            if (response.ok) {
                const content = await response.text();
                return content;
            }
            throw new Error(
                `Failed to fetch document content: ${response.status} ${response.statusText}`,
            );
        } catch (error) {
            console.error("[DOCUMENT] Failed to get document content:", error);
            throw error;
        }
    }

    public async setDocumentContent(content: string): Promise<void> {
        try {
            const saveUrl = AI_CONFIG.ENDPOINTS.DOCUMENT;

            const response = await fetch(saveUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
            });

            if (!response.ok) {
                throw new Error(
                    `Failed to set document content: ${response.status} ${response.statusText}`,
                );
            }

            console.log(` [DOCUMENT] Document content updated successfully`);
            // Don't reload the whole page, just notify the editor will update via collaboration
            console.log(
                "[FILE] [DOCUMENT] Content set - WebSocket collaboration will sync changes",
            );
        } catch (error) {
            console.error("[DOCUMENT] Failed to set document content:", error);
            throw error;
        }
    }

    public async loadFileFromDisk(file: File): Promise<void> {
        try {
            // Check if there's unsaved content
            const hasUnsavedChanges = await this.hasUnsavedChanges();

            if (hasUnsavedChanges) {
                const shouldSave = confirm(
                    "You have unsaved changes. Do you want to save the current document before opening a new file?",
                );

                if (shouldSave) {
                    // Save current document first
                    await this.saveDocument(this.editorManager?.getEditor());
                }
            }

            // Read the file content
            const content = await file.text();

            // Extract document name from filename (without extension)
            const documentName = file.name.replace(/\.(md|markdown)$/i, "");

            // Switch to the new document (this handles collaboration reconnection)
            await this.switchToDocument(documentName);

            // Set the file content (after switching rooms)
            if (this.editorManager) {
                await this.editorManager.setContent(content);
            }

            // Also update the server-side content
            await this.setDocumentContent(content);

            if (this.notificationManager) {
                this.notificationManager.showNotification(
                    `📁 Loaded: ${file.name}`,
                    "success",
                );
            }
        } catch (error) {
            console.error("Failed to load file:", error);
            if (this.notificationManager) {
                this.notificationManager.showNotification(
                    "❌  Failed to load file",
                    "error",
                );
            }
            throw error;
        }
    }

    public async switchToDocument(documentName: string): Promise<void> {
        try {
            const switchUrl = "/api/switch-document";

            // Call server to switch document
            const response = await fetch(switchUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentName }),
            });

            if (!response.ok) {
                throw new Error(
                    `Failed to switch document: ${response.status} ${response.statusText}`,
                );
            }

            const result = await response.json();
            console.log(`[DOCUMENT] Server switched to: ${documentName}`);

            // Switch editor collaboration to new document room
            if (this.editorManager) {
                const documentId = documentName; // Document ID is same as document name (without .md)
                await this.editorManager.switchToDocument(
                    documentId,
                    result.content,
                );
                console.log(
                    ` [DOCUMENT] Editor switched to document: "${documentId}"`,
                );
            }

            // Update page title and URL
            document.title = `${documentName} - AI-Enhanced Markdown Editor`;
            const newUrl = `/document/${encodeURIComponent(documentName)}`;
            window.history.pushState({ documentName }, document.title, newUrl);
        } catch (error) {
            console.error("[DOCUMENT] Failed to switch document:", error);
            throw error;
        }
    }

    private async hasUnsavedChanges(): Promise<boolean> {
        try {
            if (!this.editorManager) return false;

            // Get current editor content
            const currentContent = await this.getMarkdownContent(
                this.editorManager.getEditor(),
            );

            // Get server content
            const serverContent = await this.getDocumentContent();

            // Compare content (normalize line endings)
            const normalizeContent = (str: string) =>
                str.replace(/\r\n/g, "\n").trim();

            return (
                normalizeContent(currentContent) !==
                normalizeContent(serverContent)
            );
        } catch (error) {
            console.warn("Could not check for unsaved changes:", error);
            return false; // Assume no changes if we can't check
        }
    }

    /**
     * Apply operations through the editor API for proper markdown parsing and DOM updates
     */
    private async applyOperationsThroughEditor(
        editor: any,
        operations: any[],
    ): Promise<void> {
        console.log(
            `[WRITE] [EDITOR-API] Applying ${operations.length} operations through editor`,
        );

        await editor.action((ctx: any) => {
            const view = ctx.get(editorViewCtx);
            const parser = ctx.get(parserCtx);
            let tr = view.state.tr;

            for (const operation of operations) {
                console.log(
                    `[EDITOR-API] Applying operation: ${operation.type} at position ${operation.position || 0}`,
                );

                try {
                    switch (operation.type) {
                        case "insert": {
                            // Convert operation content to markdown text
                            const markdownText =
                                this.operationContentToMarkdown(
                                    operation.content,
                                );

                            const position = Math.min(
                                operation.position || 0,
                                view.state.doc.content.size,
                            );

                            // Parse markdown to ProseMirror nodes
                            const doc = parser(markdownText);
                            if (doc && doc.content) {
                                tr = tr.insert(position, doc.content);
                                console.log(
                                    ` [EDITOR-API] Inserted "${markdownText}" at position ${position}`,
                                );
                            } else {
                                console.warn(
                                    ` [EDITOR-API] Failed to parse markdown: "${markdownText}"`,
                                );
                            }
                            break;
                        }
                        case "replace": {
                            const markdownText =
                                this.operationContentToMarkdown(
                                    operation.content,
                                );

                            const fromPos = Math.min(
                                operation.from || 0,
                                view.state.doc.content.size,
                            );
                            const toPos = Math.min(
                                operation.to || fromPos + 1,
                                view.state.doc.content.size,
                            );

                            // Parse markdown to ProseMirror nodes
                            const doc = parser(markdownText);
                            if (doc && doc.content) {
                                tr = tr.replaceWith(
                                    fromPos,
                                    toPos,
                                    doc.content,
                                );
                                console.log(
                                    ` [EDITOR-API] Replaced content from ${fromPos} to ${toPos} with "${markdownText}"`,
                                );
                            }
                            break;
                        }
                        case "delete": {
                            const fromPos = Math.min(
                                operation.from || 0,
                                view.state.doc.content.size,
                            );
                            const toPos = Math.min(
                                operation.to || fromPos + 1,
                                view.state.doc.content.size,
                            );

                            tr = tr.delete(fromPos, toPos);
                            console.log(
                                ` [EDITOR-API] Deleted content from ${fromPos} to ${toPos}`,
                            );
                            break;
                        }
                        default:
                            console.warn(
                                `[ERROR] [EDITOR-API] Unknown operation type: ${operation.type}`,
                            );
                            break;
                    }
                } catch (operationError) {
                    console.error(
                        `[ERROR] [EDITOR-API] Failed to apply operation ${operation.type}:`,
                        operationError,
                    );
                }
            }

            // Dispatch all changes in a single transaction
            if (tr.docChanged) {
                view.dispatch(tr);
                console.log(
                    ` [EDITOR-API] Applied ${operations.length} operations successfully`,
                );
            } else {
                console.log(` [EDITOR-API] No document changes to apply`);
            }
        });
    }

    /**
     * Convert operation content array to markdown text
     */
    private operationContentToMarkdown(content: any[]): string {
        if (!Array.isArray(content)) {
            const result = String(content || "");
            return result;
        }

        const result = content
            .map((item: any) => {
                if (typeof item === "string") {
                    return item;
                }

                if (item && typeof item === "object") {
                    // Handle different content types
                    switch (item.type) {
                        case "heading":
                            const level = item.level || 1;
                            const headingText = this.extractTextFromContent(
                                item.content,
                            );
                            const result =
                                "#".repeat(level) + " " + headingText;
                            return result;

                        case "paragraph":
                            const paragraphText = this.extractTextFromContent(
                                item.content || item.text,
                            );
                            return paragraphText;

                        case "text":
                            const textResult = item.text || "";
                            return textResult;

                        default:
                            // Fallback: extract any text content
                            const fallbackResult =
                                this.extractTextFromContent(item.content) ||
                                item.text ||
                                "";
                            return fallbackResult;
                    }
                }

                const stringResult = String(item || "");
                return stringResult;
            })
            .join("\n");

        return result;
    }

    /**
     * Extract plain text from nested content structures
     */
    private extractTextFromContent(content: any): string {
        if (!content) return "";

        if (typeof content === "string") {
            return content;
        }

        if (Array.isArray(content)) {
            return content
                .map((item) => this.extractTextFromContent(item))
                .join("");
        }

        if (content.text) {
            return content.text;
        }

        if (content.content) {
            return this.extractTextFromContent(content.content);
        }

        return "";
    }
}
