// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Collaboration message types for websocket communication
 */
export interface CollaborationMessage {
    type:
        | "yjs-update"
        | "awareness"
        | "ai-request"
        | "ai-status"
        | "sync-request";
    documentId: string;
    userId: string;
    timestamp: number;
    data: any;
}

/**
 * AI request message for async operations
 */
export interface AIRequestMessage extends CollaborationMessage {
    type: "ai-request";
    data: {
        requestId: string;
        command: "continue" | "diagram" | "augment";
        parameters: any;
        context: {
            position: number;
            documentSnapshot: Uint8Array;
            surroundingText: string;
            sectionHeading?: string;
        };
    };
}

/**
 * AI status update message
 */
export interface AIStatusMessage extends CollaborationMessage {
    type: "ai-status";
    data: {
        requestId: string;
        status: "started" | "processing" | "completed" | "failed";
        progress?: number;
        description?: string;
        estimatedCompletion?: number;
    };
}

/**
 * Yjs update message
 */
export interface YjsUpdateMessage extends CollaborationMessage {
    type: "yjs-update";
    data: {
        update: ArrayBuffer;
        origin?: string;
    };
}
