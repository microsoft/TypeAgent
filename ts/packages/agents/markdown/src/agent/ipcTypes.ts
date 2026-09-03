// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// IPC Message Types for TypeAgent Communication

// Agent to View: rebind the view service to a specific workspace file. The
// message carries the canonical workspace root (as authorized by the host)
// plus a normalized POSIX-style relative path under that root. The service
// re-validates both under pathPolicy, so a compromised agent process cannot
// coerce the view to write outside a host-authorized workspace. `filePath`
// is omitted (or "") to switch to memory-only mode.
export interface SetFileMessage {
    type: "setFile";
    // Absolute canonical workspace root. Optional so the caller can leave
    // the root unchanged when only the bound file is switching within it.
    workspaceRoot?: string;
    // Normalized POSIX-style relative path under `workspaceRoot`. When
    // omitted (or empty) the view unbinds and goes memory-only.
    relativePath?: string;
}

// View to Agent: emitted from the view service after every successful setFile
// or /api/switch-document binding rotation. Carries the freshly-rotated
// binding token so the agent can attach it to subsequent read/apply IPC.
export interface BindingUpdatedMessage {
    type: "bindingUpdated";
    bindingToken: string | null;
    boundFilePath: string | null;
    boundRoot: string | null;
    boundRelativePath: string | null;
}

// Agent to View: UI command requests
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

// Agent to View: UI command results
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

// Agent to View: content requests. `requestId` correlates the response.
// `expectedBindingToken` lets the agent detect races where the view was
// rebound (e.g. the browser switched files) since the token was observed.
// `expectedRoot`/`expectedRelativePath` add a second identity check the
// view enforces alongside the token, so a request sent during the brief
// window when no token has been observed yet (right after setFile before
// bindingUpdated returns) still cannot land on an arbitrary browser-
// selected binding. Recovery requests may omit both expectations.
export interface GetDocumentContentMessage {
    type: "getDocumentContent";
    requestId: string;
    expectedBindingToken?: string;
    expectedRoot?: string;
    expectedRelativePath?: string;
}

// View to Agent: content responses. `requestId` is echoed for correlation.
// `bindingToken` carries the current binding so recovery can adopt it
// (see BindingUpdatedMessage). `revision` is the SHA-256 of `content` and
// forms the base version for subsequent applyLLMOperations calls.
export interface DocumentContentMessage {
    type: "documentContent";
    requestId: string;
    content: string;
    source?: "client-serializer" | "yjs-fallback" | "file-fallback" | "error";
    error?: string;
    timestamp: number;
    bindingToken: string | null;
    boundFilePath: string | null;
    boundRoot: string | null;
    boundRelativePath: string | null;
    revision: string | null;
    identityMismatch?: boolean;
}

// Agent to View: LLM operations. `requestId` correlates the response.
// `expectedBindingToken` protects against races where the view rebound to a
// different file between the agent's content read and its apply.
// `expectedRoot`/`expectedRelativePath` add a second identity check the
// view enforces alongside the token, so a request sent during the brief
// window when no token has been observed yet still cannot land on an
// arbitrary browser-selected binding. `expectedRevision` is the SHA-256
// the agent observed for the base content it fed to the LLM; the view
// rejects the apply when the current markdown (via the browser when
// present, or the Yjs mirror otherwise) hashes to a different value.
export interface LLMOperationsMessage {
    type: "applyLLMOperations";
    requestId: string;
    operations: any[]; // DocumentOperation[]
    timestamp: number;
    expectedBindingToken?: string;
    expectedRoot?: string;
    expectedRelativePath?: string;
    expectedRevision?: string;
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

// View to Frontend: notifications and status
export interface AutoSaveMessage {
    type: "autoSave";
    timestamp: number;
}

export interface NotificationEvent {
    type: "notification";
    message: string;
    notificationType: "success" | "error" | "warning" | "info";
}

export interface OperationsAppliedEvent {
    type: "operationsApplied";
    operationCount: number;
}

// View to Frontend: post-commit full-Markdown snapshot. Sent after the
// server-authoritative apply succeeds so browsers can adopt the new
// content without applying raw offsets against their ProseMirror-backed
// document. Tied to the binding token: a browser that has since rebound
// (or a browser bound to a different document) discards the snapshot.
export interface DocumentSnapshotEvent {
    type: "documentSnapshot";
    bindingToken: string;
    markdown: string;
    revision: string;
    timestamp: number;
}

// View to Frontend: emitted once to every newly-connected SSE client so
// browsers that missed the last documentChanged (e.g. connected after
// the setFile from parent IPC) still learn the currently-active binding
// token. Without this bootstrap a browser that never observed a
// documentChanged would have no token to compare a documentSnapshot
// against; the browser fails closed and discards snapshots until a
// trusted token is learned.
export interface BindingBootstrapEvent {
    type: "bindingBootstrap";
    bindingToken: string | null;
    documentId: string | null;
    documentName: string | null;
    boundRelativePath: string | null;
    revision: string | null;
    timestamp: number;
}

// Client to View: Markdown content requests
export interface RequestMarkdownMessage {
    type: "requestMarkdown";
    requestId: string;
    timestamp: number;
}

// View to Client: Markdown content responses
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
