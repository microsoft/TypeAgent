// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as Y from "yjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:markdown:collaboration");

/**
 * Server-side collaboration manager for handling Yjs synchronization
 * This works alongside the y-websocket-server for custom TypeAgent features
 */
export class CollaborationManager {
    private documents: Map<string, Y.Doc> = new Map();
    private documentPaths: Map<string, string> = new Map();

    /**
     * Initialize collaboration for a document
     */
    initializeDocument(documentId: string, filePath: string | null): void {
        if (!this.documents.has(documentId)) {
            const ydoc = new Y.Doc();
            this.documents.set(documentId, ydoc);
            this.documentPaths.set(documentId, filePath || ""); // Handle null paths

            debug(
                `Initialized collaboration document: ${documentId} ${filePath ? `(${filePath})` : "(memory-only)"}`,
            );
        }
    }

    /**
     * Use an existing Y.js document instead of creating a new one
     * This ensures consistency between CollaborationManager and WebSocket server
     */
    useExistingDocument(
        documentId: string,
        ydoc: Y.Doc,
        filePath: string | null,
    ): void {
        this.documents.set(documentId, ydoc);
        this.documentPaths.set(documentId, filePath || "");
        debug(
            `Using existing Y.js document: ${documentId} ${filePath ? `(${filePath})` : "(memory-only)"}`,
        );
    }
    getStats(): any {
        return {
            documents: this.documents.size,
            totalClients: 0, // Placeholder - would be provided by websocket server
            documentsWithClients: this.documents.size,
        };
    }

    /**
     * Apply operation to Yjs document
     */
    applyOperation(documentId: string, operation: any): void {
        const ydoc = this.documents.get(documentId);
        if (!ydoc) {
            console.warn(
                `No document found for ID: ${documentId}, cannot apply operation`,
            );
            return;
        }

        const ytext = ydoc.getText("content");
        debug(
            `Applying operation: ${operation.type} to document: ${documentId}`,
        );

        try {
            switch (operation.type) {
                case "insert": {
                    const insertText = operation.content
                        .map((item: any) => this.contentItemToText(item))
                        .join("");
                    const position = Math.min(
                        operation.position || 0,
                        ytext.length,
                    );
                    ytext.insert(position, insertText);
                    debug(
                        `Inserted ${insertText.length} chars at position ${position} in document ${documentId}`,
                    );
                    break;
                }
                case "replace": {
                    const replaceText = operation.content
                        .map((item: any) => this.contentItemToText(item))
                        .join("");
                    const fromPos = Math.min(operation.from || 0, ytext.length);
                    const toPos = Math.min(
                        operation.to || fromPos + 1,
                        ytext.length,
                    );
                    const deleteLength = toPos - fromPos;

                    ytext.delete(fromPos, deleteLength);
                    ytext.insert(fromPos, replaceText);
                    debug(
                        `Replaced ${deleteLength} chars with ${replaceText.length} chars at position ${fromPos} in document ${documentId}`,
                    );
                    break;
                }
                case "delete": {
                    const fromPos = Math.min(operation.from || 0, ytext.length);
                    const toPos = Math.min(
                        operation.to || fromPos + 1,
                        ytext.length,
                    );
                    const deleteLength = toPos - fromPos;

                    ytext.delete(fromPos, deleteLength);
                    debug(
                        `Deleted ${deleteLength} chars at position ${fromPos} in document ${documentId}`,
                    );
                    break;
                }
                default:
                    console.warn(
                        `[COLLAB] Unknown operation type: ${operation.type}`,
                    );
            }
        } catch (error) {
            console.error(
                `[COLLAB] Failed to apply operation ${operation.type}:`,
                error,
            );
        }
    }

    /**
     * Get document content as string (SINGLE SOURCE OF TRUTH)
     */
    getDocumentContent(documentId: string): string {
        const ydoc = this.documents.get(documentId);
        if (!ydoc) {
            console.warn(
                `No document found for ID: ${documentId}, returning empty content`,
            );
            return "";
        }

        const ytext = ydoc.getText("content");
        return ytext.toString(); // Yjs is the authoritative source
    }

    /**
     * Set document content from string
     */
    setDocumentContent(documentId: string, content: string): void {
        let ydoc = this.documents.get(documentId);
        if (!ydoc) {
            this.initializeDocument(documentId, documentId + ".md");
            ydoc = this.documents.get(documentId)!;
        }

        const ytext = ydoc.getText("content");
        ytext.delete(0, ytext.length);
        ytext.insert(0, content);
    }

    /**
     * Convert content item to text (helper for operation application)
     */
    private contentItemToText(item: any): string {
        if (item.text) {
            return item.text;
        }

        if (item.content) {
            return item.content
                .map((child: any) => this.contentItemToText(child))
                .join("");
        }

        // Handle special node types
        switch (item.type) {
            case "paragraph":
                return (
                    "\n" +
                    (item.content
                        ? item.content
                              .map((child: any) =>
                                  this.contentItemToText(child),
                              )
                              .join("")
                        : "") +
                    "\n"
                );
            case "heading":
                const level = item.attrs?.level || 1;
                const prefix = "#".repeat(level) + " ";
                return (
                    "\n" +
                    prefix +
                    (item.content
                        ? item.content
                              .map((child: any) =>
                                  this.contentItemToText(child),
                              )
                              .join("")
                        : "") +
                    "\n"
                );
            case "code_block":
                return (
                    "\n```\n" +
                    (item.content
                        ? item.content
                              .map((child: any) =>
                                  this.contentItemToText(child),
                              )
                              .join("")
                        : "") +
                    "\n```\n"
                );
            case "mermaid":
                return (
                    "\n```mermaid\n" + (item.attrs?.content || "") + "\n```\n"
                );
            case "math_display":
                return "\n$$\n" + (item.attrs?.content || "") + "\n$$\n";
            default:
                return item.content
                    ? item.content
                          .map((child: any) => this.contentItemToText(child))
                          .join("")
                    : "";
        }
    }
}
