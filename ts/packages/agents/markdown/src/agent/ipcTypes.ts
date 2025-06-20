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
}

export interface DocumentContentMessage {
    type: "documentContent";
    content: string;
    timestamp: number;
}

// Agent → View: LLM operations
export interface LLMOperationsMessage {
    type: "applyLLMOperations";
    operations: any[]; // DocumentOperation[]
    timestamp: number;
}

export interface OperationsAppliedMessage {
    type: "operationsApplied";
    success: boolean;
    operationCount?: number;
    error?: string;
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
