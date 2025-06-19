// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Consolidated types for the markdown editor site

import type { Editor } from "@milkdown/core";
import type { Doc } from "yjs";
import type { WebsocketProvider } from "y-websocket";

// ============================================================================
// AI Agent Types
// ============================================================================

export interface DocumentOperation {
    type: string;
    position?: number;
    content?: any;
    description?: string;
}

export interface AgentRequest {
    action: string;
    parameters: {
        originalRequest: string;
        context: {
            position: number;
            command: string;
            params: any;
        };
    };
}

export interface AgentCommandParams {
    position?: number;
    testMode?: boolean;
    description?: string;
    instruction?: string;
}

export interface StreamEvent {
    type:
        | "start"
        | "typing"
        | "content"
        | "operation"
        | "complete"
        | "error"
        | "notification"
        | "operationsApplied"
        | "llmOperations"
        | "operationsBeingApplied";
    message?: string;
    chunk?: string;
    position?: number;
    operation?: DocumentOperation;
    operations?: DocumentOperation[];
    error?: string;
    notificationType?: string;
    operationCount?: number;
    source?: string;
    clientRole?: string;
    timestamp?: number;
}

export interface ContentItem {
    type: string;
    content?: any[];
    attrs?: Record<string, any>;
    text?: string;
}

export type AgentCommand = "continue" | "diagram" | "augment";

export type SaveStatus = "saving" | "saved" | "error";
export type NotificationType = "success" | "error" | "info";

// ============================================================================
// Collaboration Types
// ============================================================================

export interface CollaborationInfo {
    websocketServerUrl: string;
    currentDocument: string;
    documents: number;
    totalClients: number;
}

export interface CollaborationConfig {
    websocketServerUrl: string;
    documentId: string;
    fallbackToLocal: boolean;
}

// ============================================================================
// Editor Types
// ============================================================================

export interface EditorState {
    editor: Editor | null;
    yjsDoc: Doc | null;
    websocketProvider: WebsocketProvider | null;
}

export interface EditorConfig {
    enableCollaboration: boolean;
    enableAI: boolean;
    enableMermaid: boolean;
    defaultContent: string;
}

export interface MenuBuilder {
    addGroup(id: string, label: string): MenuBuilder;
    addItem(id: string, config: MenuItemConfig): MenuBuilder;
}

export interface MenuItemConfig {
    label: string;
    icon: string;
    onRun: (ctx: any) => Promise<void>;
}
