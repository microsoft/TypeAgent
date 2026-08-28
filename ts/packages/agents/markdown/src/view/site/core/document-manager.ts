// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { editorViewCtx, type Editor } from "@milkdown/core";
import { AI_CONFIG, DEFAULT_MARKDOWN_CONTENT, EDITOR_CONFIG } from "../config";
import { getMarkdownFromEditor, getEditorPositionInfo } from "../utils";
import {
    encodeDocumentPathForUrl,
    ensureMarkdownExtension,
} from "../../route/urlPath.js";

class DocumentWriteConflictError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "DocumentWriteConflictError";
    }
}

interface DocumentWriteResponse {
    content?: unknown;
    error?: unknown;
    revision?: unknown;
}

export class DocumentManager {
    private notificationManager: any = null;
    private editorManager: any = null;
    private eventSource: EventSource | null = null;
    private autoSaveTimer: NodeJS.Timeout | null = null;
    private isPrimaryClient = false;
    private lastAutoSaveContent = "";
    // A 409 with different on-disk content blocks repeated autosaves of
    // exactly the same editor state. A subsequent edit may try again, but
    // the conflicted payload is never retried indefinitely.
    private lastConflictedAutoSaveContent: string | null = null;
    private currentDocumentId = "default";
    private currentRevision: string | null = null;
    // Token rotated by the view service on every trusted rebinding
    // (setFile from the agent or /api/switch-document from another
    // browser). Snapshots we accept must carry this exact value or
    // we discard them - a stale snapshot for a previous binding must
    // never overwrite the current editor content.
    private currentBindingToken: string | null = null;
    // Full user-relative path (POSIX form) of the currently-bound
    // document. Nested paths (docs/team/roadmap.md) are preserved end
    // to end; the browser never derives this from an absolute path
    // because the service does not expose absolute paths to callers.
    private currentBoundRelativePath: string | null = null;

    /**
     * Expose the current bound relative path (POSIX form, includes .md)
     * for callers that need to render or route with it. Read-only from
     * outside; the value is only mutated from bindingBootstrap /
     * documentChanged / switchToDocument.
     */
    public getCurrentBoundRelativePath(): string | null {
        return this.currentBoundRelativePath;
    }

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
        await this.loadCurrentBindingPath();

        // Initialize auto-save if enabled
        if (EDITOR_CONFIG.FEATURES.AUTO_SAVE) {
            this.startAutoSave();
        }
    }

    private async loadCurrentBindingPath(): Promise<void> {
        try {
            const response = await fetch("/api/current-document");
            if (!response.ok) {
                return;
            }
            const current = (await response.json()) as {
                boundRelativePath?: unknown;
            };
            if (typeof current.boundRelativePath === "string") {
                this.currentBoundRelativePath = current.boundRelativePath;
            }
        } catch (error) {
            console.warn(
                "[DOCUMENT] Failed to load current binding path:",
                error,
            );
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
     * Perform auto-save if content has changed. Autosave requires a
     * live binding token learned from bindingBootstrap /
     * documentChanged; without one the server would (and does) reject
     * the request, so we skip locally rather than firing a doomed
     * write.
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

            if (this.currentBindingToken === null) {
                console.log(
                    "[AUTO-SAVE] Skipping - no bindingToken yet (unbootstrapped)",
                );
                return;
            }

            const currentContent = await this.getMarkdownContent(editor);
            if (currentContent === this.lastAutoSaveContent) {
                console.log("[AUTO-SAVE] Skipping - content unchanged");
                return;
            }
            if (currentContent === this.lastConflictedAutoSaveContent) {
                console.warn(
                    "[AUTO-SAVE] Skipping unchanged content after a write conflict",
                );
                return;
            }

            console.log(`[AUTO-SAVE] Content changed, auto-saving...`);

            // Send the binding identity and base revision with the save.
            // They prevent a stale tab from confusing one binding or
            // revision for another; they are not authorization credentials.
            // We do NOT
            // send any absolute path - the server writes only to its
            // snapshotted trusted file/root.
            const response = await fetch(AI_CONFIG.ENDPOINTS.AUTOSAVE, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: currentContent,
                    documentId: this.currentDocumentId,
                    bindingToken: this.currentBindingToken,
                    expectedRevision: this.currentRevision,
                }),
            });

            await this.reconcileDocumentWriteResponse(
                response,
                currentContent,
                "Auto-save",
            );
            if (response.ok) {
                console.log("[AUTO-SAVE] Successfully saved document");
            } else {
                console.log(
                    "[AUTO-SAVE] Reconciled with content already persisted by another client",
                );
            }
        } catch (error) {
            console.error("[AUTO-SAVE] Error during auto-save:", error);
            if (
                error instanceof DocumentWriteConflictError &&
                this.notificationManager
            ) {
                this.notificationManager.showNotification(
                    error.message,
                    "error",
                );
            }
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
                // Adopt the new identity atomically before we touch the
                // editor or fire autosave: pairing the new token with the
                // new documentId prevents a same-tick autosave from
                // carrying a stale token that would then be rejected.
                if (typeof data.newDocumentId === "string") {
                    this.currentDocumentId = data.newDocumentId;
                }
                if (typeof data.bindingToken === "string") {
                    this.currentBindingToken = data.bindingToken;
                }
                if (typeof data.boundRelativePath === "string") {
                    this.currentBoundRelativePath = data.boundRelativePath;
                }
                this.adoptRevision(data.revision);

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

            case "documentSynced":
                console.log(`[SSE] Document synchronized: ${data.documentId}`);
                // Document sync notification removed per user request
                break;

            case "autoSave":
                console.log(`[SSE] Auto-save completed for: ${data.filePath}`);
                if (
                    typeof data.bindingToken === "string" &&
                    data.bindingToken === this.currentBindingToken
                ) {
                    this.adoptRevision(data.revision);
                } else {
                    console.warn(
                        "[SSE] Ignoring autoSave revision for a stale binding",
                    );
                }
                // Auto-save notification removed per user request
                break;

            case "autoSaveError":
                console.error(`[SSE] Auto-save error: ${data.error}`);
                // Auto-save error notification removed per user request
                break;

            case "bindingBootstrap": {
                // Trusted bootstrap from the same-origin service. Its
                // view of the current binding is authoritative on every
                // reconnect: a stale in-memory token here would just
                // paper over a real rebinding (e.g. another tab or the
                // agent switched files while this tab was offline).
                // Adopt the identity atomically so a subsequent
                // autosave and any pending snapshots compare against
                // a consistent token/documentId pair.
                if (typeof data.bindingToken === "string") {
                    this.currentBindingToken = data.bindingToken;
                    if (typeof data.documentId === "string") {
                        this.currentDocumentId = data.documentId;
                    }
                    if (typeof data.boundRelativePath === "string") {
                        this.currentBoundRelativePath = data.boundRelativePath;
                    }
                    this.adoptRevision(data.revision);
                    console.log(
                        `[SSE] Adopted bindingBootstrap token for ${data.documentId ?? "<memory>"}`,
                    );
                } else if (data.bindingToken === null) {
                    // View is in memory-only mode. Clear our token so a
                    // stale value cannot survive across an unbind /
                    // rebind cycle and get re-associated with a
                    // different file.
                    this.currentBindingToken = null;
                    this.currentBoundRelativePath = null;
                    this.currentRevision = null;
                }
                // clientRole is assigned by SSE connection ordering (see
                // service /events). The first-connected browser is the
                // primary autosave writer; secondary tabs skip autosave.
                if (data.clientRole === "primary") {
                    this.isPrimaryClient = true;
                    console.log("[SSE] bindingBootstrap assigned PRIMARY role");
                } else if (data.clientRole === "secondary") {
                    this.isPrimaryClient = false;
                    console.log(
                        "[SSE] bindingBootstrap assigned SECONDARY role",
                    );
                }
                break;
            }

            case "primaryElected": {
                // Sent to the next-connected browser when the previous
                // primary tab closed. Flip the autosave flag on so this
                // tab starts writing on the next timer tick. Promotion must
                // not seat a new binding token by itself: without the matching
                // documentChanged/bootstrap content that could pair stale
                // editor content with a new file identity.
                if (data.bindingToken !== this.currentBindingToken) {
                    console.warn(
                        "[SSE] Ignoring primaryElected for a stale binding",
                    );
                    break;
                }
                this.isPrimaryClient = true;
                this.adoptRevision(data.revision);
                console.log("[SSE] Promoted to PRIMARY for autosave");
                break;
            }

            case "documentSnapshot": {
                // Post-commit snapshot from the server after it applied
                // LLM operations to raw Markdown. Only adopt it when the
                // binding token matches the one we last recorded from
                // documentChanged / bindingBootstrap. Fail closed when
                // we have no token yet: an untrusted snapshot on an
                // unbootstrapped browser must never seat a token from
                // arbitrary content.
                const snapshotToken = data.bindingToken;
                if (typeof snapshotToken !== "string") {
                    console.warn(
                        "[SSE] Ignoring documentSnapshot with no bindingToken",
                    );
                    break;
                }
                if (this.currentBindingToken === null) {
                    console.warn(
                        `[SSE] Ignoring documentSnapshot: no established binding token to compare against (snapshot ${snapshotToken})`,
                    );
                    break;
                }
                if (snapshotToken !== this.currentBindingToken) {
                    console.warn(
                        `[SSE] Ignoring documentSnapshot for stale binding (snapshot ${snapshotToken}, current ${this.currentBindingToken})`,
                    );
                    break;
                }
                if (
                    this.editorManager &&
                    typeof data.markdown === "string" &&
                    typeof this.editorManager.setContent === "function"
                ) {
                    try {
                        await this.editorManager.setContent(data.markdown);
                        this.lastAutoSaveContent = data.markdown;
                        this.adoptRevision(data.revision);
                        console.log(
                            `[SSE] Adopted documentSnapshot (${data.markdown.length} chars, revision ${data.revision ?? "-"})`,
                        );
                    } catch (error) {
                        console.error(
                            "[ERROR] [SSE] Failed to apply documentSnapshot:",
                            error,
                        );
                    }
                }
                break;
            }

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
            this.adoptRevisionFromResponse(response);
            console.log(
                ` [DOCUMENT] Frontend switched to document: "${documentId}"`,
            );

            // Switch editor collaboration to new document room
            if (this.editorManager) {
                await this.editorManager.switchToDocument(documentId, content);
            }

            // Update page title and URL
            const relativePath =
                this.currentBoundRelativePath ?? `${documentName}.md`;
            const displayPath = relativePath.replace(/\.md$/i, "");
            document.title = `${displayPath} - AI-Enhanced Markdown Editor`;
            const newUrl = `/document/${encodeDocumentPathForUrl(relativePath)}`;
            window.history.pushState(
                { documentPath: displayPath },
                document.title,
                newUrl,
            );
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
            // Send markdown content back to view process. Echo our
            // currentBindingToken so the service can reject the
            // response when we rebound mid-flight (the pending server
            // request is pinned to the token that was live when the
            // SSE was sent). A null echo is fine and expected during
            // the pre-bootstrap window; the service simply skips the
            // check when both sides carry null.
            const response = await fetch("/api/markdown-response", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    requestId: requestId,
                    markdown: markdown,
                    positionInfo: positionInfo,
                    bindingToken: this.currentBindingToken,
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
                        bindingToken: this.currentBindingToken,
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

    /**
     * Persist the current editor state to the bound file. Payload is
     * the serialized Markdown from getMarkdownContent - never plain
     * text - so headings/bold/code/links survive a manual save. When
     * an editor is provided, we carry the current bindingToken as an
     * identity proof: the service applies the same trust check the
     * autosave endpoint does and rejects a missing/stale token
     * without touching disk.
     */
    public async saveDocument(editor?: Editor): Promise<void> {
        try {
            // Get markdown content from editor (via serializer) or,
            // when there is no editor to serialize from, from the
            // service's current view of the bound file.
            const content = editor
                ? await this.getMarkdownContent(editor)
                : await this.loadContentFromServer();

            const saveUrl = AI_CONFIG.ENDPOINTS.DOCUMENT;

            const response = await fetch(saveUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content,
                    documentId: this.currentDocumentId,
                    bindingToken: this.currentBindingToken,
                    expectedRevision: this.currentRevision,
                }),
            });

            await this.reconcileDocumentWriteResponse(
                response,
                content,
                "Save",
            );

            console.log(` [DOCUMENT] Document saved successfully`);
        } catch (error) {
            console.error("[DOCUMENT] Failed to save document:", error);
            if (this.notificationManager) {
                this.notificationManager.showSaveStatus("error");
            }
            throw error;
        }
    }

    /**
     * Get the full serialized Markdown for the editor. This is the
     * ONLY content that autosave / saveDocument may persist: it runs
     * the ProseMirror doc through Milkdown's serializerCtx so
     * headings, bold, code fences, links, etc. round-trip. The
     * ProseMirror `textContent` shortcut is intentionally not used
     * here - it strips formatting and would silently overwrite the
     * bound file with plain text.
     */
    public async getMarkdownContent(editor: Editor): Promise<string> {
        return getMarkdownFromEditor(editor);
    }

    public async loadInitialContent(): Promise<string> {
        try {
            const documentUrl = AI_CONFIG.ENDPOINTS.DOCUMENT;

            const response = await fetch(documentUrl);

            if (response.ok) {
                const content = await response.text();
                this.adoptRevisionFromResponse(response);
                this.lastAutoSaveContent = content;
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
            this.adoptRevisionFromResponse(response);
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
                this.adoptRevisionFromResponse(response);
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
                body: JSON.stringify({
                    content,
                    documentId: this.currentDocumentId,
                    bindingToken: this.currentBindingToken,
                    expectedRevision: this.currentRevision,
                }),
            });

            await this.reconcileDocumentWriteResponse(
                response,
                content,
                "Set document content",
            );

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

    public async switchToDocument(documentPath: string): Promise<void> {
        try {
            // Short-circuit when the SSE bootstrap already bound this
            // browser to the requested document. Without this guard
            // the initial `/document/team/2025/plan.md` load would
            // trigger a redundant /api/switch-document call, which
            // rotates the binding token, might race the
            // bootstrap adoption path, and - if the raw path is not
            // normalized identically - could persuade the service to
            // create a new empty file.
            if (this.currentBoundRelativePath !== null) {
                const targetRelative = ensureMarkdownExtension(documentPath);
                if (this.currentBoundRelativePath === targetRelative) {
                    console.log(
                        `[DOCUMENT] Already bound to ${this.currentBoundRelativePath}; skipping /api/switch-document`,
                    );
                    return;
                }
            }

            const switchUrl = "/api/switch-document";

            // Send the raw user-relative path (possibly nested, e.g.
            // "docs/team/roadmap"). The service re-validates via
            // pathPolicy, appends .md if needed, and returns the full
            // normalized relative path plus the freshly-rotated
            // bindingToken and documentId (Yjs room) it assigned.
            const response = await fetch(switchUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    documentPath,
                    // Back-compat for older callers/tests that read
                    // this on the server side; the server prefers
                    // documentPath.
                    documentName: documentPath,
                }),
            });

            if (!response.ok) {
                throw new Error(
                    `Failed to switch document: ${response.status} ${response.statusText}`,
                );
            }

            const result = await response.json();
            console.log(`[DOCUMENT] Server switched to: ${documentPath}`);

            // Adopt the new identity atomically BEFORE the editor
            // room switch and any autosave. Otherwise the next
            // autosave tick would carry the previous token/documentId
            // and be rejected by the service - and worse, if the
            // service had already rotated to a different binding
            // (concurrent switch), we would pair new content with
            // the old identity.
            const documentId =
                typeof result.documentId === "string"
                    ? result.documentId
                    : documentPath;
            const relative =
                typeof result.boundRelativePath === "string"
                    ? result.boundRelativePath
                    : typeof result.relativePath === "string"
                      ? result.relativePath
                      : null;
            this.currentDocumentId = documentId;
            this.currentBoundRelativePath = relative;
            if (typeof result.bindingToken === "string") {
                this.currentBindingToken = result.bindingToken;
            }
            this.adoptRevision(result.revision);

            if (this.editorManager) {
                await this.editorManager.switchToDocument(
                    documentId,
                    result.content,
                );
                console.log(
                    ` [DOCUMENT] Editor switched to document: "${documentId}"`,
                );
            }

            // Update page title and URL. For nested paths, encode each
            // segment so slashes are preserved.
            const displayPath = relative
                ? relative.replace(/\.md$/i, "")
                : documentPath;
            document.title = `${displayPath} - AI-Enhanced Markdown Editor`;
            const encodedPath = encodeDocumentPathForUrl(
                relative ?? ensureMarkdownExtension(documentPath),
            );
            const newUrl = `/document/${encodedPath}`;
            window.history.pushState(
                { documentPath: displayPath },
                document.title,
                newUrl,
            );
        } catch (error) {
            console.error("[DOCUMENT] Failed to switch document:", error);
            throw error;
        }
    }

    private adoptRevision(revision: unknown): void {
        if (typeof revision === "string" && revision.length > 0) {
            this.currentRevision = revision;
        }
    }

    private adoptRevisionFromResponse(response: Response): void {
        this.adoptRevision(response.headers.get("X-Content-Revision"));
    }

    private async parseDocumentWriteResponse(
        response: Response,
    ): Promise<DocumentWriteResponse | undefined> {
        try {
            const result: unknown = await response.json();
            if (
                typeof result === "object" &&
                result !== null &&
                !Array.isArray(result)
            ) {
                return result as DocumentWriteResponse;
            }
        } catch (error) {
            console.warn(
                `[DOCUMENT] Could not parse ${response.status} response body:`,
                error,
            );
        }
        return undefined;
    }

    /**
     * Reconcile an optimistic document write. A 409 is considered resolved
     * only when the server proves that the exact attempted content is already
     * on disk. Otherwise we retain the old base revision and surface a
     * conflict, preventing a follow-up save from overwriting newer disk data.
     */
    private async reconcileDocumentWriteResponse(
        response: Response,
        attemptedContent: string,
        operation: string,
    ): Promise<void> {
        const result = await this.parseDocumentWriteResponse(response);

        if (response.ok) {
            this.adoptRevision(result?.revision);
            this.lastAutoSaveContent = attemptedContent;
            this.lastConflictedAutoSaveContent = null;
            return;
        }

        if (
            response.status === 409 &&
            typeof result?.revision === "string" &&
            result.content === attemptedContent
        ) {
            this.adoptRevision(result.revision);
            this.lastAutoSaveContent = attemptedContent;
            this.lastConflictedAutoSaveContent = null;
            return;
        }

        if (response.status === 409) {
            this.lastConflictedAutoSaveContent = attemptedContent;
            const detail =
                typeof result?.error === "string" ? ` ${result.error}` : "";
            throw new DocumentWriteConflictError(
                `${operation} conflict: the document changed on disk and was not overwritten.${detail}`,
            );
        }

        const detail =
            typeof result?.error === "string" ? ` ${result.error}` : "";
        throw new Error(
            `${operation} failed: ${response.status} ${response.statusText}.${detail}`,
        );
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
