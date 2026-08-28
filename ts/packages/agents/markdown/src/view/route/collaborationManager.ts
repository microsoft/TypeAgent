// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as Y from "yjs";
import registerDebug from "debug";
import { applyDocumentOperations } from "../../agent/documentOperations.js";
import type { DocumentOperation } from "../../agent/markdownOperationSchema.js";

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

    applyOperations(
        documentId: string,
        operations: DocumentOperation[],
    ): string {
        const ydoc = this.documents.get(documentId);
        if (!ydoc) {
            throw new Error(`No document found for ID: ${documentId}`);
        }

        const ytext = ydoc.getText("content");
        const updatedContent = applyDocumentOperations(
            ytext.toString(),
            operations,
        );

        ydoc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, updatedContent);
        });

        debug(
            `Applied ${operations.length} operations to document ${documentId}`,
        );
        return updatedContent;
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
