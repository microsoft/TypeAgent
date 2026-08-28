// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as Y from "yjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:markdown:collaboration");

/**
 * Server-side collaboration manager for Yjs document lifecycle.
 *
 * NOTE: We intentionally do NOT expose an `applyOperations` method
 * here. The production write path in `service.ts` reads live content
 * from the connected browser (which is the actual source of truth for
 * unsaved edits), runs `applyDocumentOperations` against that string,
 * and then mirrors the result into the appropriate authoritative Yjs
 * room. Running a separate `applyOperations` off the Yjs mirror would
 * be a second, divergent write path with a different input surface,
 * so it stays deleted rather than reintroduced as parallel logic.
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

    /**
     * Forget everything we know about a document. Callers use this
     * from the service level after a binding rotation, when no
     * WebSocket clients are attached to the old room, so the old
     * Yjs mirror does not linger in memory forever.
     */
    forgetDocument(documentId: string): void {
        this.documents.delete(documentId);
        this.documentPaths.delete(documentId);
        debug(`Forgot document: ${documentId}`);
    }

    getStats(): any {
        return {
            documents: this.documents.size,
            totalClients: 0, // Placeholder - would be provided by websocket server
            documentsWithClients: this.documents.size,
        };
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
}
