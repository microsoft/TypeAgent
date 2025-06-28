// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PDFDocument,
    PDFAnnotation,
    PDFBookmark,
    UserPresence,
} from "./pdfTypes.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:views:server:pdf:service");

/**
 * PDF business logic service
 */
export class PDFService {
    private documents: Map<string, PDFDocument> = new Map();
    private annotations: Map<string, PDFAnnotation[]> = new Map();
    private bookmarks: Map<string, PDFBookmark[]> = new Map();
    private userPresence: Map<string, Map<string, UserPresence>> = new Map();

    constructor() {
        this.initializeSampleData();
    }

    /**
     * Initialize with sample data for development
     */
    private initializeSampleData(): void {
        // Add a sample PDF document
        const sampleDoc: PDFDocument = {
            id: "sample-pdf-1",
            title: "Sample PDF Document",
            filename: "sample.pdf",
            size: 1024 * 1024, // 1MB
            pageCount: 10,
            uploadDate: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            mimeType: "application/pdf",
        };

        this.documents.set(sampleDoc.id, sampleDoc);
        this.annotations.set(sampleDoc.id, []);
        this.bookmarks.set(sampleDoc.id, []);
        this.userPresence.set(sampleDoc.id, new Map());

        debug("Sample PDF data initialized");
    }

    /**
     * Get PDF document by ID
     */
    getDocument(documentId: string): PDFDocument | null {
        return this.documents.get(documentId) || null;
    }

    /**
     * Get all documents
     */
    getAllDocuments(): PDFDocument[] {
        return Array.from(this.documents.values());
    }

    /**
     * Add new PDF document
     */
    addDocument(document: PDFDocument): void {
        this.documents.set(document.id, document);
        this.annotations.set(document.id, []);
        this.bookmarks.set(document.id, []);
        this.userPresence.set(document.id, new Map());

        debug(`Added new document: ${document.id}`);
    }

    /**
     * Get annotations for a document
     */
    getAnnotations(documentId: string): PDFAnnotation[] {
        return this.annotations.get(documentId) || [];
    }

    /**
     * Add annotation to a document
     */
    addAnnotation(annotation: PDFAnnotation): PDFAnnotation {
        const docAnnotations =
            this.annotations.get(annotation.documentId) || [];
        docAnnotations.push(annotation);
        this.annotations.set(annotation.documentId, docAnnotations);

        debug(
            `Added annotation ${annotation.id} to document ${annotation.documentId}`,
        );
        return annotation;
    }

    /**
     * Update annotation
     */
    updateAnnotation(annotation: PDFAnnotation): PDFAnnotation | null {
        const docAnnotations =
            this.annotations.get(annotation.documentId) || [];
        const index = docAnnotations.findIndex((a) => a.id === annotation.id);

        if (index !== -1) {
            docAnnotations[index] = {
                ...annotation,
                updatedAt: new Date().toISOString(),
            };
            debug(`Updated annotation ${annotation.id}`);
            return docAnnotations[index];
        }

        return null;
    }

    /**
     * Delete annotation
     */
    deleteAnnotation(documentId: string, annotationId: string): boolean {
        const docAnnotations = this.annotations.get(documentId) || [];
        const index = docAnnotations.findIndex((a) => a.id === annotationId);

        if (index !== -1) {
            docAnnotations.splice(index, 1);
            debug(`Deleted annotation ${annotationId}`);
            return true;
        }

        return false;
    }
    /**
     * Get bookmarks for a document
     */
    getBookmarks(documentId: string): PDFBookmark[] {
        return this.bookmarks.get(documentId) || [];
    }

    /**
     * Add bookmark to a document
     */
    addBookmark(bookmark: PDFBookmark): PDFBookmark {
        const docBookmarks = this.bookmarks.get(bookmark.documentId) || [];
        docBookmarks.push(bookmark);
        this.bookmarks.set(bookmark.documentId, docBookmarks);

        debug(
            `Added bookmark ${bookmark.id} to document ${bookmark.documentId}`,
        );
        return bookmark;
    }

    /**
     * Delete bookmark
     */
    deleteBookmark(documentId: string, bookmarkId: string): boolean {
        const docBookmarks = this.bookmarks.get(documentId) || [];
        const index = docBookmarks.findIndex((b) => b.id === bookmarkId);

        if (index !== -1) {
            docBookmarks.splice(index, 1);
            debug(`Deleted bookmark ${bookmarkId}`);
            return true;
        }

        return false;
    }

    /**
     * Update user presence for a document
     */
    updateUserPresence(documentId: string, presence: UserPresence): void {
        const docPresence = this.userPresence.get(documentId) || new Map();
        docPresence.set(presence.userId, presence);
        this.userPresence.set(documentId, docPresence);

        debug(
            `Updated presence for user ${presence.userId} in document ${documentId}`,
        );
    }

    /**
     * Remove user presence
     */
    removeUserPresence(documentId: string, userId: string): void {
        const docPresence = this.userPresence.get(documentId);
        if (docPresence) {
            docPresence.delete(userId);
            debug(
                `Removed presence for user ${userId} from document ${documentId}`,
            );
        }
    }

    /**
     * Get all users present in a document
     */
    getUserPresence(documentId: string): UserPresence[] {
        const docPresence = this.userPresence.get(documentId);
        return docPresence ? Array.from(docPresence.values()) : [];
    }

    /**
     * Generate unique ID
     */
    generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}
