// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * PDF-specific types for the PDF viewer feature
 */

export interface PDFDocument {
    id: string;
    title: string;
    filename: string;
    size: number;
    pageCount: number;
    uploadDate: string;
    lastModified: string;
    mimeType: string;
    path?: string;
}

export interface PDFViewerState {
    documentId: string;
    currentPage: number;
    zoom: number;
    viewMode: "fit-width" | "fit-page" | "custom";
    searchQuery?: string;
    searchResults?: SearchResult[];
    sidebarView: "thumbnails" | "outline" | "attachments" | "layers" | "none";
    scrollMode: "vertical" | "horizontal" | "wrapped";
    spreadMode: "none" | "odd" | "even";
}

export interface SearchResult {
    pageIndex: number;
    matchIndex: number;
    text: string;
    highlight: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export interface PDFAnnotation {
    id: string;
    documentId: string;
    page: number;
    type: "highlight" | "note" | "drawing" | "text" | "image" | "question";
    coordinates: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    content?: string;
    color?: string;
    thickness?: number;
    opacity?: number;
    storage?: "custom" | "pdfjs"; // Storage type for hybrid approach
    createdAt: string;
    updatedAt: string;
    userId?: string;
}

export interface PDFBookmark {
    id: string;
    documentId: string;
    title: string;
    page: number;
    zoom?: number;
    coordinates?: {
        x: number;
        y: number;
    };
    createdAt: string;
    userId?: string;
}

export interface PDFSSEEvent {
    type:
        | "annotation-added"
        | "annotation-updated"
        | "annotation-deleted"
        | "bookmark-added"
        | "bookmark-deleted"
        | "user-joined"
        | "user-left"
        | "view-state-changed"
        | "document-loaded";
    data: any;
    timestamp: string;
    documentId: string;
    userId?: string | undefined;
}

export interface PDFUploadRequest {
    title?: string;
    file: Buffer;
    filename: string;
    mimeType: string;
}

export interface UserPresence {
    userId: string;
    username: string;
    currentPage: number;
    lastSeen: string;
    color: string;
}
