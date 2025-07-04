// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface UrlDocumentMapping {
    documentId: string;
    url: string;
    createdAt: string;
    lastAccessedAt: string;
}

/**
 * PDF API Service for communicating with the TypeAgent PDF server
 */
export class PDFApiService {
    private baseUrl = "/api/pdf";

    /**
     * Get or create document ID from URL
     */
    async getDocumentIdFromUrl(url: string): Promise<UrlDocumentMapping> {
        const response = await fetch(`${this.baseUrl}/url-to-id`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ url }),
        });

        if (!response.ok) {
            throw new Error(
                `Failed to get document ID: ${response.statusText}`,
            );
        }

        return response.json();
    }

    /**
     * Get document metadata
     */
    async getDocument(documentId: string): Promise<any> {
        const response = await fetch(`${this.baseUrl}/${documentId}`);

        if (!response.ok) {
            throw new Error(`Failed to get document: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Get all documents
     */
    async getDocuments(): Promise<any[]> {
        const response = await fetch(`${this.baseUrl}/documents`);

        if (!response.ok) {
            throw new Error(`Failed to get documents: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Get annotations for a document
     */
    async getAnnotations(documentId: string): Promise<any[]> {
        const response = await fetch(
            `${this.baseUrl}/${documentId}/annotations`,
        );

        if (!response.ok) {
            throw new Error(
                `Failed to get annotations: ${response.statusText}`,
            );
        }

        return response.json();
    }

    /**
     * Add annotation to a document
     */
    async addAnnotation(documentId: string, annotation: any): Promise<any> {
        const response = await fetch(
            `${this.baseUrl}/${documentId}/annotations`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(annotation),
            },
        );

        if (!response.ok) {
            throw new Error(`Failed to add annotation: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Update annotation
     */
    async updateAnnotation(
        documentId: string,
        annotationId: string,
        annotation: any,
    ): Promise<any> {
        const response = await fetch(
            `${this.baseUrl}/${documentId}/annotations/${annotationId}`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(annotation),
            },
        );

        if (!response.ok) {
            throw new Error(
                `Failed to update annotation: ${response.statusText}`,
            );
        }

        return response.json();
    }

    /**
     * Delete annotation
     */
    async deleteAnnotation(
        documentId: string,
        annotationId: string,
    ): Promise<void> {
        const response = await fetch(
            `${this.baseUrl}/${documentId}/annotations/${annotationId}`,
            {
                method: "DELETE",
            },
        );

        if (!response.ok) {
            throw new Error(
                `Failed to delete annotation: ${response.statusText}`,
            );
        }
    }

    /**
     * Get bookmarks for a document
     */
    async getBookmarks(documentId: string): Promise<any[]> {
        const response = await fetch(`${this.baseUrl}/${documentId}/bookmarks`);

        if (!response.ok) {
            throw new Error(`Failed to get bookmarks: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Add bookmark to a document
     */
    async addBookmark(documentId: string, bookmark: any): Promise<any> {
        const response = await fetch(
            `${this.baseUrl}/${documentId}/bookmarks`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(bookmark),
            },
        );

        if (!response.ok) {
            throw new Error(`Failed to add bookmark: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Delete bookmark
     */
    async deleteBookmark(
        documentId: string,
        bookmarkId: string,
    ): Promise<void> {
        const response = await fetch(
            `${this.baseUrl}/${documentId}/bookmarks/${bookmarkId}`,
            {
                method: "DELETE",
            },
        );

        if (!response.ok) {
            throw new Error(
                `Failed to delete bookmark: ${response.statusText}`,
            );
        }
    }

    /**
     * Update user presence
     */
    async updatePresence(documentId: string, presence: any): Promise<any> {
        const response = await fetch(`${this.baseUrl}/${documentId}/presence`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(presence),
        });

        if (!response.ok) {
            throw new Error(
                `Failed to update presence: ${response.statusText}`,
            );
        }

        return response.json();
    }

    /**
     * Get user presence for a document
     */
    async getPresence(documentId: string): Promise<any[]> {
        const response = await fetch(`${this.baseUrl}/${documentId}/presence`);

        if (!response.ok) {
            throw new Error(`Failed to get presence: ${response.statusText}`);
        }

        return response.json();
    }
}
