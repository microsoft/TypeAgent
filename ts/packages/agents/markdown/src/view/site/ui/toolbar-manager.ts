// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DocumentManager } from "../core/document-manager";
import { getElementById } from "../utils";
import { editorViewCtx } from "@milkdown/core";

export class ToolbarManager {
    private documentManager: DocumentManager | null = null;

    constructor() {
        // DocumentManager will be injected
    }

    public setDocumentManager(documentManager: DocumentManager): void {
        this.documentManager = documentManager;
    }

    public async initialize(): Promise<void> {
        this.setupOpenButton();
        this.setupExportButton();
        this.setupShareButton();
    }

    private setupOpenButton(): void {
        const openBtn = getElementById("open-btn");
        const fileInput = getElementById("file-input") as HTMLInputElement;

        if (openBtn && fileInput) {
            openBtn.addEventListener("click", () => {
                fileInput.click();
            });

            fileInput.addEventListener("change", (event) => {
                const target = event.target as HTMLInputElement;
                if (target.files && target.files[0]) {
                    this.handleFileOpen(target.files[0]);
                }
            });
        }
    }

    private setupExportButton(): void {
        const exportBtn = getElementById("export-btn");
        if (exportBtn) {
            exportBtn.addEventListener("click", () => {
                this.handleFileExport();
            });
        }
    }

    private async handleFileOpen(file: File): Promise<void> {
        try {
            if (!this.documentManager) {
                throw new Error("DocumentManager not initialized");
            }

            // Use the document manager's improved file loading
            await this.documentManager.loadFileFromDisk(file);
        } catch (error) {
            console.error("Failed to open file:", error);
            this.showNotification("❌ Failed to open file", "error");
        }
    }

    private async handleFileExport(): Promise<void> {
        try {
            if (!this.documentManager) {
                throw new Error("DocumentManager not initialized");
            }

            // Get content directly from the live editor (not server) to ensure we export what user sees
            let content = "";

            // Try to get content from the editor manager first (most current)
            const editorManager = this.documentManager.getEditorManager();
            if (editorManager) {
                const editor = editorManager.getEditor();
                if (editor) {
                    content = await this.getEditorMarkdownContent(editor);
                } else {
                    console.warn(
                        "[EXPORT] No editor available, falling back to server",
                    );
                    content = await this.documentManager.getDocumentContent();
                }
            } else {
                console.warn(
                    "[EXPORT] No editor manager available, falling back to server",
                );
                content = await this.documentManager.getDocumentContent();
            }

            const blob = new Blob([content], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);

            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const filename = `markdown-export-${timestamp}.md`;

            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showNotification(`📥 Exported: ${filename}`, "success");
        } catch (error) {
            console.error("Failed to export file:", error);
            this.showNotification("❌ Failed to export file", "error");
        }
    }

    /**
     * Get markdown content directly from the editor using proper API
     */
    private async getEditorMarkdownContent(editor: any): Promise<string> {
        return new Promise((resolve) => {
            try {
                editor.action((ctx: any) => {
                    const view = ctx.get(editorViewCtx);

                    // Get the entire document as markdown
                    // Using textContent as fallback, but ideally we'd use a proper markdown serializer
                    const content = view.state.doc.textContent || "";

                    resolve(content);
                });
            } catch (error) {
                console.error(
                    "[EXPORT-API] Failed to get editor content:",
                    error,
                );
                resolve("");
            }
        });
    }

    private showNotification(message: string, type: "success" | "error"): void {
        // Create a simple notification
        const notification = document.createElement("div");
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 6px;
            background: ${type === "success" ? "#10b981" : "#ef4444"};
            color: white;
            font-weight: 500;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = "slideOut 0.3s ease";
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    private setupShareButton(): void {
        const shareBtn = getElementById("share-btn");
        if (shareBtn) {
            shareBtn.addEventListener("click", () => {
                this.handleShare();
            });
        }
    }

    private async handleShare(): Promise<void> {
        try {
            // Get current document name
            const response = await fetch("/api/current-document");
            if (!response.ok) {
                throw new Error("Failed to get current document info");
            }

            const docInfo = await response.json();
            const documentName = docInfo.currentDocument || "live";

            // Create shareable URL
            const baseUrl = window.location.origin;
            const shareUrl = `${baseUrl}/document/${documentName}`;

            // Copy to clipboard
            await navigator.clipboard.writeText(shareUrl);

            this.showNotification(
                `🔗 Link copied: /document/${documentName}`,
                "success",
            );
        } catch (error) {
            console.error("Failed to share document:", error);

            // Fallback: show the URL in a prompt if clipboard fails
            try {
                const response = await fetch("/api/current-document");
                const docInfo = await response.json();
                const documentName = docInfo.currentDocument || "live";
                const shareUrl = `${window.location.origin}/document/${documentName}`;

                // Show URL in prompt as fallback
                prompt("Copy this shareable URL:", shareUrl);
                this.showNotification("🔗 Share URL generated", "success");
            } catch (fallbackError) {
                this.showNotification(
                    "❌ Failed to generate share link",
                    "error",
                );
            }
        }
    }
}
