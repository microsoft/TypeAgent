// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Editor } from "@milkdown/core";
import { editorViewCtx, parserCtx } from "@milkdown/core";
import { AI_CONFIG, DEFAULT_MARKDOWN_CONTENT, EDITOR_CONFIG } from "../config";
import { getMarkdownFromEditor, getEditorPositionInfo } from "../utils";
import { encodeDocumentPathForUrl } from "../../route/urlPath";

interface SSEEventData {
    type: string;
    bindingToken: string | null;
    documentId: string | null;
    revision: string;
    documentName: string;
    boundRelativePath: string;
    newDocumentId: string;
    newDocumentName: string;
    markdown: string;
    baseMarkdown: string;
    clientRole: string;
    operations: Array<Record<string, unknown>>;
    filePath: string;
    error: unknown;
    operationCount: number;
    requestId: string;
}

interface BindingStateData {
    documentId?: unknown;
    bindingToken?: unknown;
    revision?: unknown;
}

export class DocumentManager {
    private notificationManager: any = null;
    private editorManager: any = null;
    private eventSource: EventSource | null = null;
    private sseEventQueue: Promise<void> = Promise.resolve();
    private bindingTransitionQueue: Promise<void> = Promise.resolve();
    private autoSaveTimer: NodeJS.Timeout | null = null;
    private isPrimaryClient = false;
    private isBindingTransitionInProgress = false;
    private lastAutoSaveContent = "";
    private currentDocumentId = "default";
    private bindingToken: string | null = null;
    private revision: string | null = null;
    private bindingVersion = 0;

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
            if (
                this.isBindingTransitionInProgress ||
                this.bindingToken === null
            ) {
                console.log("[AUTO-SAVE] Skipping - binding is not ready");
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

            // Send auto-save request
            const bindingToken = this.bindingToken;
            const bindingVersion = this.bindingVersion;
            const response = await fetch(AI_CONFIG.ENDPOINTS.AUTOSAVE, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: currentContent,
                    documentId: this.currentDocumentId,
                    bindingToken,
                    expectedRevision: this.revision,
                }),
            });

            if (response.ok) {
                const result = await response.json();
                if (
                    bindingVersion === this.bindingVersion &&
                    bindingToken === this.bindingToken &&
                    result.bindingToken === bindingToken
                ) {
                    this.adoptRevision(result);
                    this.lastAutoSaveContent = currentContent;
                }
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

    private setupSSEConnection(): void {
        try {
            this.eventSource = new EventSource("/events");

            this.eventSource.onopen = () => {
                console.log("[SSE] Connected to server events");
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log(`[SSE] Received event: ${data.type}`, data);
                    this.sseEventQueue = this.sseEventQueue
                        .then(() => this.handleSSEEvent(data))
                        .catch((error: unknown) => {
                            console.error(
                                "[SSE] Failed to process event:",
                                error,
                            );
                        });
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

    private async handleSSEEvent(data: SSEEventData): Promise<void> {
        console.log("[SSE] Received event:", data.type, data);

        switch (data.type) {
            case "bindingBootstrap":
                await this.handleBindingBootstrap(data);
                break;

            case "documentChanged":
                await this.handleDocumentChanged(data);
                break;

            case "documentSynced":
                console.log(`[SSE] Document synchronized: ${data.documentId}`);
                // Document sync notification removed per user request
                break;

            case "autoSave":
                this.adoptRevision(data);
                console.log(`[SSE] Auto-save completed for: ${data.filePath}`);
                // Auto-save notification removed per user request
                break;

            case "documentSnapshot":
                await this.handleDocumentSnapshot(data);
                break;

            case "autoSaveError":
                console.error(`[SSE] Auto-save error: ${data.error}`);
                // Auto-save error notification removed per user request
                break;

            case "llmOperations":
                await this.handleLLMOperations(data);
                break;

            case "operationsBeingApplied":
                // Handle notification that operations are being applied by primary client
                console.log(
                    `[SSE] Operations being applied by primary client - ${data.operationCount} changes incoming`,
                );

                break;

            case "requestMarkdown":
                // Handle request for markdown content from view process
                console.log(`[SSE] Received requestMarkdown event:`, data);
                await this.handleMarkdownRequest(data.requestId);
                break;

            case "aiAwareness":
                // Handle AI awareness cursor display
                console.log(`[SSE] Received AI awareness event:`, data);
                await this.handleAIAwarenessEvent(data);
                break;

            default:
                // Log unknown event types for debugging
                console.log(`[SSE] Unknown event type: ${data.type}`, data);
                break;
        }
    }

    private async handleBindingBootstrap(data: SSEEventData): Promise<void> {
        if (
            typeof data.bindingToken === "string" &&
            typeof data.documentId === "string" &&
            typeof data.revision === "string"
        ) {
            await this.transitionToBinding(
                {
                    documentId: data.documentId,
                    bindingToken: data.bindingToken,
                    revision: data.revision,
                },
                data.documentName,
                data.boundRelativePath,
            );
        } else if (data.bindingToken === null && data.documentId === null) {
            this.adoptBinding(data);
        }
    }

    private async handleDocumentChanged(data: SSEEventData): Promise<void> {
        console.log(`[SSE] Document changed to: ${data.newDocumentId}`);
        if (typeof data.bindingToken !== "string") {
            return;
        }
        if (this.notificationManager) {
            this.notificationManager.resetDocumentSyncState(data.newDocumentId);
        }
        await this.transitionToBinding(
            {
                documentId: data.newDocumentId,
                bindingToken: data.bindingToken,
                revision: data.revision,
            },
            data.newDocumentName,
            data.boundRelativePath,
        );
    }

    private async handleDocumentSnapshot(data: SSEEventData): Promise<void> {
        if (
            data.bindingToken !== this.bindingToken ||
            typeof data.markdown !== "string" ||
            typeof data.baseMarkdown !== "string" ||
            !this.editorManager
        ) {
            return;
        }
        await this.bindingTransitionQueue;
        if (
            data.bindingToken !== this.bindingToken ||
            this.isBindingTransitionInProgress
        ) {
            return;
        }
        const editor = this.editorManager.getEditor();
        if (!editor) {
            return;
        }
        const currentMarkdown = await this.getMarkdownContent(editor);
        if (currentMarkdown === data.markdown) {
            this.lastAutoSaveContent = data.markdown;
            this.adoptRevision(data);
            return;
        }
        if (currentMarkdown !== data.baseMarkdown) {
            console.warn(
                "[SSE] Ignoring document snapshot because the editor changed after the agent read it",
            );
            return;
        }
        await this.editorManager.setContent(data.markdown);
        this.adoptRevision(data);
        this.lastAutoSaveContent = data.markdown;
    }

    private async handleLLMOperations(data: SSEEventData): Promise<void> {
        if (data.clientRole !== "primary") {
            this.isPrimaryClient = false;
            console.log(`[SSE] Marked as SECONDARY CLIENT`);
            return;
        }
        if (
            !data.operations ||
            !Array.isArray(data.operations) ||
            !this.editorManager
        ) {
            console.warn(`[SSE] Invalid LLM operations received:`, data);
            return;
        }
        try {
            this.isPrimaryClient = true;
            console.log("[SSE] Marked as PRIMARY CLIENT for auto-save");
            const editor = this.editorManager.getEditor();
            if (!editor) {
                console.warn(`[SSE] No editor available to apply operations`);
                return;
            }
            await this.applyOperationsThroughEditor(editor, data.operations);
            console.log(
                ` [SSE] Applied ${data.operations.length} operations via editor API`,
            );
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
    }

    private async handleDocumentChangeFromBackend(
        documentId: string,
        documentName: string,
        relativePath?: string,
        expectedBindingToken?: string,
    ): Promise<void> {
        console.log(
            `[DOCUMENT] Backend switched to: ${documentName}, reconnecting frontend...`,
        );

        const response = await fetch(
            AI_CONFIG.ENDPOINTS.DOCUMENT,
            expectedBindingToken
                ? { headers: { "X-Binding-Token": expectedBindingToken } }
                : undefined,
        );
        if (!response.ok) {
            throw new Error(
                `Failed to load switched document: ${response.status}`,
            );
        }
        const content = await response.text();

        console.log(
            ` [DOCUMENT] Frontend switched to document: "${documentId}"`,
        );

        if (!this.editorManager) {
            throw new Error("Editor is not ready for a binding transition");
        }
        await this.editorManager.switchToDocument(documentId, content);

        document.title = `${documentName} - AI-Enhanced Markdown Editor`;
        const documentPath = relativePath || documentName;
        const newUrl = `/document/${encodeDocumentPathForUrl(documentPath)}`;
        window.history.pushState(
            { documentName: documentPath },
            document.title,
            newUrl,
        );
    }

    private async transitionToBinding(
        binding: {
            documentId: string;
            bindingToken: string;
            revision: unknown;
        },
        documentName: string,
        relativePath?: string,
    ): Promise<void> {
        const transition = this.bindingTransitionQueue.then(async () => {
            if (
                binding.bindingToken === this.bindingToken &&
                binding.documentId === this.currentDocumentId
            ) {
                this.adoptRevision(binding);
                return;
            }

            this.isBindingTransitionInProgress = true;
            try {
                await this.handleDocumentChangeFromBackend(
                    binding.documentId,
                    documentName,
                    relativePath,
                    binding.bindingToken,
                );
                this.adoptBinding(binding);
            } finally {
                this.isBindingTransitionInProgress = false;
            }
        });
        this.bindingTransitionQueue = transition.catch(() => undefined);
        await transition;
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

    /**
     * Handle markdown content request from view process
     * This provides proper markdown serialization from the Milkdown editor
     */
    private async handleMarkdownRequest(requestId: string): Promise<void> {
        console.log(`[CLIENT] Handling markdown request: ${requestId}`);
        console.log(
            `[CLIENT] Editor manager available: ${!!this.editorManager}`,
        );

        try {
            if (
                this.isBindingTransitionInProgress ||
                !this.editorManager ||
                !this.editorManager.getEditor()
            ) {
                throw new Error("Editor is not ready to serialize Markdown");
            }
            let markdown = "";
            let positionInfo = { position: 0 };

            if (this.editorManager) {
                const editor = this.editorManager.getEditor();
                console.log(`[CLIENT] Editor available: ${!!editor}`);
                if (editor) {
                    // Get proper markdown from the editor using serializer
                    console.log(
                        `[CLIENT] Getting markdown from editor using static import...`,
                    );

                    markdown = await getMarkdownFromEditor(editor);
                    positionInfo = await getEditorPositionInfo(editor);

                    console.log(
                        `[CLIENT] Retrieved markdown from editor: ${markdown.length} chars, position: ${positionInfo.position}`,
                    );
                } else {
                    console.warn(
                        "[CLIENT] No editor available for markdown request",
                    );
                }
            } else {
                console.warn(
                    "[CLIENT] No editor manager available for markdown request",
                );
            }

            console.log(`[CLIENT] Sending markdown response to server...`);
            // Send markdown content back to view process
            const response = await fetch("/api/markdown-response", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    requestId: requestId,
                    markdown: markdown,
                    positionInfo: positionInfo,
                    bindingToken: this.bindingToken,
                    timestamp: Date.now(),
                }),
            });

            if (!response.ok) {
                console.error(
                    `[CLIENT] Failed to send markdown response: ${response.statusText}`,
                );
            } else {
                console.log(
                    `[CLIENT] Successfully sent markdown response for request: ${requestId}`,
                );
            }
        } catch (error) {
            console.error(`[CLIENT] Error handling markdown request:`, error);

            // Send error response
            try {
                await fetch("/api/markdown-response", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        requestId: requestId,
                        markdown: "",
                        error:
                            error instanceof Error
                                ? error.message
                                : "Unknown error",
                        bindingToken: this.bindingToken,
                        timestamp: Date.now(),
                    }),
                });
            } catch (responseError) {
                console.error(
                    `[CLIENT] Failed to send error response:`,
                    responseError,
                );
            }
        }
    }

    public async saveDocument(editor?: Editor): Promise<void> {
        try {
            if (
                this.isBindingTransitionInProgress ||
                this.bindingToken === null
            ) {
                throw new Error("Cannot save while the binding is not ready");
            }
            // Get markdown content from editor or server
            const content = editor
                ? await this.getMarkdownContent(editor)
                : await this.loadContentFromServer();

            const saveUrl = AI_CONFIG.ENDPOINTS.DOCUMENT;

            const bindingToken = this.bindingToken;
            const bindingVersion = this.bindingVersion;
            const response = await fetch(saveUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content,
                    bindingToken,
                    expectedRevision: this.revision,
                }),
            });

            if (!response.ok) {
                throw new Error(`Save failed: ${response.status}`);
            }

            const result = await response.json();
            if (
                bindingVersion !== this.bindingVersion ||
                bindingToken !== this.bindingToken ||
                result.bindingToken !== bindingToken
            ) {
                throw new Error("Binding changed while saving");
            }
            this.adoptRevision(result);
            console.log(` [DOCUMENT] Document saved successfully`);
        } catch (error) {
            console.error("[DOCUMENT] Failed to save document:", error);
            if (this.notificationManager) {
                this.notificationManager.showSaveStatus("error");
            }
            throw error;
        }
    }

    public async getMarkdownContent(editor: Editor): Promise<string> {
        if (!editor) return "";
        return getMarkdownFromEditor(editor);
    }

    public async loadInitialContent(): Promise<string> {
        try {
            const documentUrl = AI_CONFIG.ENDPOINTS.DOCUMENT;

            const response = await fetch(documentUrl);

            if (response.ok) {
                const content = await response.text();
                this.adoptRevisionHeader(response);
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
            this.adoptRevisionHeader(response);
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

    public async getDocumentContent(): Promise<string> {
        try {
            const documentUrl = AI_CONFIG.ENDPOINTS.DOCUMENT;

            const response = await fetch(documentUrl);

            if (response.ok) {
                const content = await response.text();
                this.adoptRevisionHeader(response);
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
            if (
                this.isBindingTransitionInProgress ||
                this.bindingToken === null
            ) {
                throw new Error(
                    "Cannot update content while the binding is not ready",
                );
            }
            const saveUrl = AI_CONFIG.ENDPOINTS.DOCUMENT;
            const bindingToken = this.bindingToken;
            const bindingVersion = this.bindingVersion;
            const response = await fetch(saveUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content,
                    bindingToken,
                    expectedRevision: this.revision,
                }),
            });

            if (!response.ok) {
                throw new Error(
                    `Failed to set document content: ${response.status} ${response.statusText}`,
                );
            }

            const result = await response.json();
            if (
                bindingVersion !== this.bindingVersion ||
                bindingToken !== this.bindingToken ||
                result.bindingToken !== bindingToken
            ) {
                throw new Error("Binding changed while updating content");
            }
            this.adoptRevision(result);
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
            const startingBindingVersion = this.bindingVersion;

            // Call server to switch document
            const response = await fetch(switchUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentPath: documentName }),
            });

            if (!response.ok) {
                throw new Error(
                    `Failed to switch document: ${response.status} ${response.statusText}`,
                );
            }

            const result = await response.json();
            if (
                this.bindingVersion !== startingBindingVersion &&
                this.bindingToken !== result.bindingToken
            ) {
                return;
            }
            console.log(`[DOCUMENT] Server switched to: ${documentName}`);

            await this.transitionToBinding(
                {
                    documentId: result.documentId,
                    bindingToken: result.bindingToken,
                    revision: result.revision,
                },
                documentName,
                result.boundRelativePath,
            );
        } catch (error) {
            console.error("[DOCUMENT] Failed to switch document:", error);
            throw error;
        }
    }

    private adoptBinding(data: BindingStateData): void {
        this.bindingVersion++;
        if (typeof data.documentId === "string") {
            this.currentDocumentId = data.documentId;
        }
        this.bindingToken =
            typeof data.bindingToken === "string" ? data.bindingToken : null;
        this.revision =
            typeof data.revision === "string" ? data.revision : null;
    }

    private adoptRevision(data: BindingStateData): void {
        if (
            typeof data.bindingToken === "string" &&
            data.bindingToken !== this.bindingToken
        ) {
            return;
        }
        if (typeof data.revision === "string") {
            this.revision = data.revision;
        }
    }

    private adoptRevisionHeader(response: Response): void {
        const revision = response.headers.get("X-Content-Revision");
        if (revision) {
            this.revision = revision;
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
                            const headingText = this.extractTextFromContent(
                                item.content || item.text,
                            );
                            return headingText;

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

    /**
     * Handle AI awareness events from SSE
     */
    private async handleAIAwarenessEvent(data: any): Promise<void> {
        try {
            const { operation, position } = data;

            console.log(
                `[AI-AWARENESS] Handling ${operation} at position ${position}`,
            );

            // Get editor manager to access awareness
            if (!this.editorManager) {
                console.warn("[AI-AWARENESS] No editor manager available");
                return;
            }

            const collabService = this.editorManager.getCollaborationService();
            if (!collabService || !collabService.awareness) {
                console.warn(
                    "[AI-AWARENESS] No collaboration service or awareness available",
                );
                return;
            }

            if (operation === "showAICursor") {
                // Use a different approach: create a visual indicator directly in the editor
                // instead of trying to manipulate awareness which is meant for real users
                this.showAIVisualCursor(position);

                console.log(
                    `[AI-AWARENESS] Showed AI visual cursor at position ${position}`,
                );
            } else if (operation === "hideAICursor") {
                // Hide the visual AI cursor
                this.hideAIVisualCursor();

                console.log(`[AI-AWARENESS] Hid AI visual cursor`);
            }
        } catch (error) {
            console.error(
                "[AI-AWARENESS] Error handling awareness event:",
                error,
            );
        }
    }

    /**
     * Show AI visual cursor as a DOM element overlay
     */
    private showAIVisualCursor(position: number): void {
        try {
            // Remove any existing AI cursor
            this.hideAIVisualCursor();

            const editor = this.editorManager?.getEditor();
            if (!editor) {
                console.warn(
                    "[AI-AWARENESS] No editor available for visual cursor",
                );
                return;
            }

            // Get editor view to calculate position
            editor.action((ctx: any) => {
                const view = ctx.get(editorViewCtx);
                if (!view) return;

                // Create AI cursor element
                const aiCursor = document.createElement("div");
                aiCursor.id = "ai-visual-cursor";
                aiCursor.className = "ai-visual-cursor";
                aiCursor.innerHTML = `
                    <div class="ai-cursor-line"></div>
                    <div class="ai-cursor-label">🤖 AI Assistant</div>
                `;

                // Style the cursor
                aiCursor.style.cssText = `
                    position: absolute;
                    z-index: 1000;
                    pointer-events: none;
                    font-size: 12px;
                    color: #3b82f6;
                `;

                // Add CSS for cursor styling
                if (!document.getElementById("ai-cursor-styles")) {
                    const styles = document.createElement("style");
                    styles.id = "ai-cursor-styles";
                    styles.textContent = `
                        .ai-visual-cursor .ai-cursor-line {
                            width: 2px;
                            height: 20px;
                            background-color: #3b82f6;
                            animation: ai-cursor-blink 1s infinite;
                            margin-bottom: 2px;
                        }
                        .ai-visual-cursor .ai-cursor-label {
                            background: #3b82f6;
                            color: white;
                            padding: 2px 6px;
                            border-radius: 4px;
                            font-size: 11px;
                            white-space: nowrap;
                        }
                        @keyframes ai-cursor-blink {
                            0%, 50% { opacity: 1; }
                            51%, 100% { opacity: 0.3; }
                        }
                    `;
                    document.head.appendChild(styles);
                }

                // Position the cursor at the specified position
                try {
                    const coords = view.coordsAtPos(position);
                    const editorRect = view.dom.getBoundingClientRect();

                    aiCursor.style.left = `${coords.left - editorRect.left}px`;
                    aiCursor.style.top = `${coords.top - editorRect.top - 25}px`; // Offset above the line

                    // Add to editor DOM
                    view.dom.parentElement?.appendChild(aiCursor);

                    console.log(
                        `[AI-AWARENESS] AI visual cursor positioned at ${coords.left}, ${coords.top}`,
                    );
                } catch (posError) {
                    console.warn(
                        "[AI-AWARENESS] Could not position AI cursor:",
                        posError,
                    );
                    // Fallback: add to document body
                    document.body.appendChild(aiCursor);
                }
            });
        } catch (error) {
            console.error(
                "[AI-AWARENESS] Error showing AI visual cursor:",
                error,
            );
        }
    }

    /**
     * Hide AI visual cursor
     */
    private hideAIVisualCursor(): void {
        const existingCursor = document.getElementById("ai-visual-cursor");
        if (existingCursor) {
            existingCursor.remove();
            console.log("[AI-AWARENESS] Removed AI visual cursor");
        }
    }
}
