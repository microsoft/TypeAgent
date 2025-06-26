// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Express, Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { SSEManager, FeatureConfig } from "../../core/types.js";
import { SSEManagerImpl } from "../../core/sseManager.js";
import { PDFService } from "./pdfService.js";
import {
    PDFSSEEvent,
    PDFAnnotation,
    PDFBookmark,
    UserPresence,
} from "./pdfTypes.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:views:server:pdf:routes");

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * PDF feature routes configuration
 */
export class PDFRoutes {
    private pdfService: PDFService;
    private sseManager?: SSEManager;

    constructor() {
        this.pdfService = new PDFService();
    }

    /**
     * Create the feature configuration for PDF
     */
    static createFeatureConfig(): FeatureConfig {
        const pdfRoutes = new PDFRoutes();

        return {
            name: "pdf",
            basePath: "/pdf",
            setupRoutes: (app: Express) => pdfRoutes.setupRoutes(app),
            setupSSE: (sseManager: SSEManager) =>
                pdfRoutes.setupSSE(sseManager),
        };
    }

    /**
     * Setup SSE for PDF
     */
    setupSSE(sseManager: SSEManager): void {
        this.sseManager = sseManager;
        debug("PDF SSE setup complete");
    }

    /**
     * Broadcast update to connected clients for a specific document
     */
    private broadcastUpdate(
        documentId: string,
        eventType: string,
        data: any,
        userId?: string,
    ): void {
        if (!this.sseManager) {
            debug("No SSE manager available for broadcast");
            return;
        }

        const eventData: PDFSSEEvent = {
            type: eventType as any,
            data: data,
            timestamp: new Date().toISOString(),
            documentId,
            userId,
        };

        // Broadcast to the document-specific namespace
        this.sseManager.broadcast(`pdf-${documentId}`, eventData);
    }

    /**
     * Setup all PDF routes
     */
    setupRoutes(app: Express): void {
        // Serve the PDF viewer page
        app.get("/pdf", this.servePDFViewer.bind(this));
        app.get("/pdf/", this.servePDFViewer.bind(this));
        app.get("/pdf/:documentId", this.servePDFViewer.bind(this));

        // Document management
        app.get("/api/pdf/documents", this.getDocuments.bind(this));
        app.get("/api/pdf/:documentId", this.getDocument.bind(this));
        app.post("/api/pdf/upload", this.uploadDocument.bind(this));
        app.get(
            "/api/pdf/:documentId/download",
            this.downloadDocument.bind(this),
        );

        // SSE endpoint for real-time updates
        app.get(
            "/api/pdf/:documentId/events",
            this.handleSSEConnection.bind(this),
        );

        // Annotations
        app.get(
            "/api/pdf/:documentId/annotations",
            this.getAnnotations.bind(this),
        );
        app.post(
            "/api/pdf/:documentId/annotations",
            this.addAnnotation.bind(this),
        );
        app.put(
            "/api/pdf/:documentId/annotations/:annotationId",
            this.updateAnnotation.bind(this),
        );
        app.delete(
            "/api/pdf/:documentId/annotations/:annotationId",
            this.deleteAnnotation.bind(this),
        );

        // Bookmarks
        app.get("/api/pdf/:documentId/bookmarks", this.getBookmarks.bind(this));
        app.post("/api/pdf/:documentId/bookmarks", this.addBookmark.bind(this));
        app.delete(
            "/api/pdf/:documentId/bookmarks/:bookmarkId",
            this.deleteBookmark.bind(this),
        );

        // User presence
        app.post(
            "/api/pdf/:documentId/presence",
            this.updatePresence.bind(this),
        );
        app.get("/api/pdf/:documentId/presence", this.getPresence.bind(this));

        debug("PDF routes setup complete");
    }

    /**
     * Serve the PDF viewer page
     */
    private servePDFViewer(req: Request, res: Response): void {
        res.sendFile(
            path.join(__dirname, "..", "..", "..", "public", "pdf-viewer.html"),
        );
    }
    /**
     * Handle SSE connection for a specific PDF document
     */
    private handleSSEConnection(req: Request, res: Response): void {
        if (!this.sseManager) {
            res.status(500).json({ error: "SSE not configured" });
            return;
        }

        const documentId = req.params.documentId;
        if (!documentId) {
            res.status(400).json({ error: "Document ID required" });
            return;
        }

        // Verify document exists
        const document = this.pdfService.getDocument(documentId);
        if (!document) {
            res.status(404).json({ error: "Document not found" });
            return;
        }

        SSEManagerImpl.setupSSEHeaders(res);
        this.sseManager.addClient(`pdf-${documentId}`, res);

        debug(`New PDF SSE client connected for document ${documentId}`);
    }

    /**
     * Get all documents
     */
    private getDocuments(req: Request, res: Response): void {
        try {
            const documents = this.pdfService.getAllDocuments();
            res.json(documents);
        } catch (error) {
            debug("Error getting documents:", error);
            res.status(500).json({ error: "Failed to get documents" });
        }
    }

    /**
     * Get specific document
     */
    private getDocument(req: Request, res: Response): void {
        try {
            const documentId = req.params.documentId;
            const document = this.pdfService.getDocument(documentId);

            if (!document) {
                res.status(404).json({ error: "Document not found" });
                return;
            }

            res.json(document);
        } catch (error) {
            debug("Error getting document:", error);
            res.status(500).json({ error: "Failed to get document" });
        }
    }

    /**
     * Upload new document (placeholder implementation)
     */
    private uploadDocument(req: Request, res: Response): void {
        res.status(501).json({
            error: "Upload functionality not yet implemented",
        });
    }

    /**
     * Download document (placeholder implementation)
     */
    private downloadDocument(req: Request, res: Response): void {
        res.status(501).json({
            error: "Download functionality not yet implemented",
        });
    }

    /**
     * Get annotations for a document
     */
    private getAnnotations(req: Request, res: Response): void {
        try {
            const documentId = req.params.documentId;
            const annotations = this.pdfService.getAnnotations(documentId);
            res.json(annotations);
        } catch (error) {
            debug("Error getting annotations:", error);
            res.status(500).json({ error: "Failed to get annotations" });
        }
    }

    /**
     * Add annotation to a document
     */
    private addAnnotation(req: Request, res: Response): void {
        try {
            const documentId = req.params.documentId;
            const annotationData = req.body;

            const annotation: PDFAnnotation = {
                ...annotationData,
                id: this.pdfService.generateId(),
                documentId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            const savedAnnotation = this.pdfService.addAnnotation(annotation);

            // Broadcast to other clients
            this.broadcastUpdate(
                documentId,
                "annotation-added",
                savedAnnotation,
            );

            res.status(201).json(savedAnnotation);
        } catch (error) {
            debug("Error adding annotation:", error);
            res.status(400).json({ error: "Failed to add annotation" });
        }
    }

    /**
     * Update annotation
     */
    private updateAnnotation(req: Request, res: Response): void {
        try {
            const documentId = req.params.documentId;
            const annotationId = req.params.annotationId;
            const annotationData = req.body;

            const annotation: PDFAnnotation = {
                ...annotationData,
                id: annotationId,
                documentId,
            };

            const updatedAnnotation =
                this.pdfService.updateAnnotation(annotation);

            if (!updatedAnnotation) {
                res.status(404).json({ error: "Annotation not found" });
                return;
            }

            // Broadcast to other clients
            this.broadcastUpdate(
                documentId,
                "annotation-updated",
                updatedAnnotation,
            );

            res.json(updatedAnnotation);
        } catch (error) {
            debug("Error updating annotation:", error);
            res.status(400).json({ error: "Failed to update annotation" });
        }
    }

    /**
     * Delete annotation
     */
    private deleteAnnotation(req: Request, res: Response): void {
        try {
            const documentId = req.params.documentId;
            const annotationId = req.params.annotationId;

            const deleted = this.pdfService.deleteAnnotation(
                documentId,
                annotationId,
            );

            if (!deleted) {
                res.status(404).json({ error: "Annotation not found" });
                return;
            }

            // Broadcast to other clients
            this.broadcastUpdate(documentId, "annotation-deleted", {
                id: annotationId,
            });

            res.status(204).send();
        } catch (error) {
            debug("Error deleting annotation:", error);
            res.status(500).json({ error: "Failed to delete annotation" });
        }
    }

    /**
     * Get bookmarks for a document
     */
    private getBookmarks(req: Request, res: Response): void {
        try {
            const documentId = req.params.documentId;
            const bookmarks = this.pdfService.getBookmarks(documentId);
            res.json(bookmarks);
        } catch (error) {
            debug("Error getting bookmarks:", error);
            res.status(500).json({ error: "Failed to get bookmarks" });
        }
    }

    /**
     * Add bookmark to a document
     */
    private addBookmark(req: Request, res: Response): void {
        try {
            const documentId = req.params.documentId;
            const bookmarkData = req.body;

            const bookmark: PDFBookmark = {
                ...bookmarkData,
                id: this.pdfService.generateId(),
                documentId,
                createdAt: new Date().toISOString(),
            };

            const savedBookmark = this.pdfService.addBookmark(bookmark);

            // Broadcast to other clients
            this.broadcastUpdate(documentId, "bookmark-added", savedBookmark);

            res.status(201).json(savedBookmark);
        } catch (error) {
            debug("Error adding bookmark:", error);
            res.status(400).json({ error: "Failed to add bookmark" });
        }
    }

    /**
     * Delete bookmark
     */
    private deleteBookmark(req: Request, res: Response): void {
        try {
            const documentId = req.params.documentId;
            const bookmarkId = req.params.bookmarkId;

            const deleted = this.pdfService.deleteBookmark(
                documentId,
                bookmarkId,
            );

            if (!deleted) {
                res.status(404).json({ error: "Bookmark not found" });
                return;
            }

            // Broadcast to other clients
            this.broadcastUpdate(documentId, "bookmark-deleted", {
                id: bookmarkId,
            });

            res.status(204).send();
        } catch (error) {
            debug("Error deleting bookmark:", error);
            res.status(500).json({ error: "Failed to delete bookmark" });
        }
    }

    /**
     * Update user presence
     */
    private updatePresence(req: Request, res: Response): void {
        try {
            const documentId = req.params.documentId;
            const presenceData = req.body;

            const presence: UserPresence = {
                ...presenceData,
                lastSeen: new Date().toISOString(),
            };

            this.pdfService.updateUserPresence(documentId, presence);

            // Broadcast to other clients
            this.broadcastUpdate(
                documentId,
                "user-joined",
                presence,
                presence.userId,
            );

            res.json(presence);
        } catch (error) {
            debug("Error updating presence:", error);
            res.status(400).json({ error: "Failed to update presence" });
        }
    }

    /**
     * Get user presence for a document
     */
    private getPresence(req: Request, res: Response): void {
        try {
            const documentId = req.params.documentId;
            const presence = this.pdfService.getUserPresence(documentId);
            res.json(presence);
        } catch (error) {
            debug("Error getting presence:", error);
            res.status(500).json({ error: "Failed to get presence" });
        }
    }
}
