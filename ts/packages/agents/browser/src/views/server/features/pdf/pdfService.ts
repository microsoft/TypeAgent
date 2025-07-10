// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PDFDocument,
    PDFAnnotation,
    PDFBookmark,
    UserPresence,
} from "./pdfTypes.js";
import registerDebug from "debug";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const debug = registerDebug("typeagent:views:server:pdf:service");

/**
 * PDF business logic service
 */
export class PDFService {
    private documents: Map<string, PDFDocument> = new Map();
    private annotations: Map<string, PDFAnnotation[]> = new Map();
    private bookmarks: Map<string, PDFBookmark[]> = new Map();
    private userPresence: Map<string, Map<string, UserPresence>> = new Map();
    private storePath: string = "";
    private annotationsPath: string = "";

    constructor() {
        this.initializeStoragePaths();
    }

    /**
     * Initialize storage paths and load existing data
     */
    private initializeStoragePaths(): void {
        this.storePath =
            process.env.TYPEAGENT_BROWSER_FILES ||
            path.join(os.homedir(), ".typeagent", "browser", "viewstore");

        this.annotationsPath = path.join(this.storePath, "annotations");
        debug(`PDF storage initialized at: ${this.storePath}`);
    }

    /**
     * Initialize the service with storage and sample data
     */
    async initialize(): Promise<void> {
        try {
            // Ensure storage directory exists
            await fs.mkdir(this.annotationsPath, { recursive: true });
            debug(`Annotations directory created/verified: ${this.annotationsPath}`);

            // Load existing annotations from disk
            await this.loadAnnotationsFromDisk();

            // Initialize sample data (only if no existing data)
            this.initializeSampleData();

            debug("PDF service initialization complete");
        } catch (error) {
            debug("Error initializing PDF service:", error);
            // Fallback to in-memory only
            this.initializeSampleData();
        }
    }

    /**
     * Load annotations from disk storage
     */
    private async loadAnnotationsFromDisk(): Promise<void> {
        try {
            const files = await fs.readdir(this.annotationsPath);
            const annotationFiles = files.filter(file => file.endsWith('.json'));

            for (const file of annotationFiles) {
                const documentId = path.basename(file, '.json');
                const filePath = path.join(this.annotationsPath, file);

                try {
                    const data = await fs.readFile(filePath, 'utf-8');
                    const annotations: PDFAnnotation[] = JSON.parse(data);
                    this.annotations.set(documentId, annotations);
                    debug(`Loaded ${annotations.length} annotations for document ${documentId}`);
                } catch (parseError) {
                    debug(`Error parsing annotations file ${file}:`, parseError);
                }
            }

            debug(`Loaded annotations for ${annotationFiles.length} documents from disk`);
        } catch (error) {
            debug("Error loading annotations from disk:", error);
            // Continue with empty annotations if loading fails
        }
    }

    /**
     * Save annotations for a document to disk
     */
    private async saveAnnotationsToDisk(documentId: string): Promise<void> {
        try {
            const annotations = this.annotations.get(documentId) || [];
            const filePath = path.join(this.annotationsPath, `${documentId}.json`);
            
            await fs.writeFile(filePath, JSON.stringify(annotations, null, 2), 'utf-8');
            debug(`Saved ${annotations.length} annotations for document ${documentId} to disk`);
        } catch (error) {
            debug(`Error saving annotations for document ${documentId}:`, error);
            // Don't throw - continue operation even if disk write fails
        }
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
        
        // Only initialize annotations if they don't already exist (preserve loaded annotations)
        if (!this.annotations.has(document.id)) {
            this.annotations.set(document.id, []);
        }
        
        // Only initialize bookmarks if they don't already exist
        if (!this.bookmarks.has(document.id)) {
            this.bookmarks.set(document.id, []);
        }
        
        // Only initialize presence if it doesn't already exist
        if (!this.userPresence.has(document.id)) {
            this.userPresence.set(document.id, new Map());
        }

        debug(`Added new document: ${document.id}`);
    }

    /**
     * Get annotations for a document
     */
    async getAnnotations(documentId: string): Promise<PDFAnnotation[]> {
        // First try to get from memory
        let annotations = this.annotations.get(documentId);
        
        // If not in memory, try to load from disk
        if (!annotations) {
            try {
                const filePath = path.join(this.annotationsPath, `${documentId}.json`);
                const data = await fs.readFile(filePath, 'utf-8');
                const loadedAnnotations: PDFAnnotation[] = JSON.parse(data);
                
                // Cache in memory for future requests
                this.annotations.set(documentId, loadedAnnotations);
                annotations = loadedAnnotations;
                debug(`Loaded ${loadedAnnotations.length} annotations for document ${documentId} from disk on demand`);
            } catch (error) {
                // File doesn't exist or can't be read, return empty array
                annotations = [];
                this.annotations.set(documentId, annotations);
                debug(`No annotations found for document ${documentId}, starting with empty array`);
            }
        }
        
        return annotations;
    }

    /**
     * Add annotation to a document
     */
    async addAnnotation(annotation: PDFAnnotation): Promise<PDFAnnotation> {
        const docAnnotations =
            this.annotations.get(annotation.documentId) || [];
        docAnnotations.push(annotation);
        this.annotations.set(annotation.documentId, docAnnotations);

        // Persist to disk
        await this.saveAnnotationsToDisk(annotation.documentId);

        debug(
            `Added annotation ${annotation.id} to document ${annotation.documentId}`,
        );
        return annotation;
    }

    /**
     * Update annotation
     */
    async updateAnnotation(annotation: PDFAnnotation): Promise<PDFAnnotation | null> {
        const docAnnotations =
            this.annotations.get(annotation.documentId) || [];
        const index = docAnnotations.findIndex((a) => a.id === annotation.id);

        if (index !== -1) {
            docAnnotations[index] = {
                ...annotation,
                updatedAt: new Date().toISOString(),
            };

            // Persist to disk
            await this.saveAnnotationsToDisk(annotation.documentId);

            debug(`Updated annotation ${annotation.id}`);
            return docAnnotations[index];
        }

        return null;
    }

    /**
     * Delete annotation
     */
    async deleteAnnotation(documentId: string, annotationId: string): Promise<boolean> {
        const docAnnotations = this.annotations.get(documentId) || [];
        const index = docAnnotations.findIndex((a) => a.id === annotationId);

        if (index !== -1) {
            docAnnotations.splice(index, 1);

            // Persist to disk
            await this.saveAnnotationsToDisk(documentId);

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
