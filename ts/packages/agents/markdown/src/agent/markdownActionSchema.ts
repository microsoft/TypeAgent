// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MarkdownAction =
    | CreateDocumentAction
    | OpenDocumentAction
    | UpdateDocumentAction
    | StreamingUpdateDocumentAction;

// creates a new markdown document
export type CreateDocumentAction = {
    actionName: "createDocument";
    parameters: {
        // the name to use for the document
        name: string;
    };
};

// opens an existing markdown document
export type OpenDocumentAction = {
    actionName: "openDocument";
    parameters: {
        // the name to use for the document
        name: string;
    };
};

// Updates the document by adding, removing or editing parts of the document.
export type UpdateDocumentAction = {
    actionName: "updateDocument";
    parameters: {
        // the original request of the user
        originalRequest: string;
    };
};

// Updates the document with streaming support for real-time AI operations
export type StreamingUpdateDocumentAction = {
    actionName: "streamingUpdateDocument";
    parameters: {
        // the original request of the user
        originalRequest: string;
        // Stream-friendly properties that can be updated incrementally
        generatedContent?: string; // Streamed content for AI operations
        progressStatus?: string; // Status updates for long operations
        validationResults?: string; // Validation feedback
        // AI command type for specialized processing
        aiCommand?: "continue" | "diagram" | "augment" | "research";
    };
};
