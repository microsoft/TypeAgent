// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// IPC Message Types for TypeAgent Communication

// Agent ← View: UI command requests
export interface UICommandMessage {
    type: "uiCommand";
    requestId: string;
    command: string; // "continue" | "diagram" | "augment"
    parameters: {
        originalRequest: string;
        context?: {
            position?: number;
            selection?: any;
        };
    };
    timestamp: number;
}

// Agent → View: UI command results
export interface UICommandResultMessage {
    type: "uiCommandResult";
    requestId: string;
    result: UICommandResult;
}

export interface UICommandResult {
    success: boolean;
    operations?: any[]; // DocumentOperation[]
    message: string;
    type: "success" | "error" | "warning";
    error?: string;
}

// Agent → View: Content requests
export interface GetDocumentContentMessage {
    type: "getDocumentContent";
    requestId: string;
    expectedBindingToken?: string;
    expectedRoot?: string;
    expectedRelativePath?: string;
}

export interface DocumentContentMessage {
    type: "documentContent";
    requestId: string;
    content: string;
    source?: "file" | "error";
    error?: string;
    timestamp: number;
    bindingToken: string | null;
    boundFilePath: string | null;
    boundRoot: string | null;
    boundRelativePath: string | null;
    revision: string | null;
    identityMismatch?: boolean;
}

// Agent → View: LLM operations
export interface LLMOperationsMessage {
    type: "applyLLMOperations";
    requestId: string;
    operations: any[]; // DocumentOperation[]
    timestamp: number;
    expectedBindingToken?: string;
    expectedRoot?: string;
    expectedRelativePath?: string;
    expectedRevision: string;
    expectedUpdatedRevision?: string;
}

export interface OperationsAppliedMessage {
    type: "operationsApplied";
    requestId: string;
    success: boolean;
    operationCount?: number;
    error?: string;
    identityMismatch?: boolean;
    revisionMismatch?: boolean;
    bindingToken?: string | null;
    revision?: string | null;
}

// View → Frontend: Auto-save notifications
export interface AutoSaveMessage {
    type: "autoSave";
    timestamp: number;
}

// View → Frontend: Notifications and status
export interface NotificationEvent {
    type: "notification";
    message: string;
    notificationType: "success" | "error" | "warning" | "info";
}

export interface OperationsAppliedEvent {
    type: "operationsApplied";
    operationCount: number;
}

// Client ← View: Markdown content requests
export interface RequestMarkdownMessage {
    type: "requestMarkdown";
    requestId: string;
    timestamp: number;
}

// View ← Client: Markdown content responses
export interface MarkdownResponseMessage {
    type: "markdownResponse";
    requestId: string;
    markdown: string;
    positionInfo?: {
        position: number;
        selection?: { from: number; to: number };
    };
    error?: string;
    timestamp: number;
}
