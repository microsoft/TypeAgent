// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AgentMessageKind,
    DisplayAppendMode,
    DisplayContent,
    TemplateSchema,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { RequestId, RequestMetrics } from "./dispatcher.js";
import type {
    UserFeedbackEntry,
    UserMessageHiddenEntry,
} from "./displayLogEntry.js";
import type { PendingInteractionRequest } from "./pendingInteraction.js";
import type {
    QueuedRequest,
    QueueCancelReason,
    QueueSnapshot,
} from "./queue.js";

export type TemplateData = {
    schema: TemplateSchema;
    data: unknown;
};

export type TemplateEditConfig = {
    templateAgentName: string;
    templateName: string;
    templateData: TemplateData | TemplateData[];
    defaultTemplate: TemplateSchema;
    preface?: string;
    editPreface?: string;
    completion?: boolean;
};

export interface IAgentMessage {
    message: DisplayContent;
    requestId: RequestId;
    source: string;
    sourceIcon?: string | undefined;
    actionIndex?: number | undefined;
    metrics?: RequestMetrics | undefined;
    // Render style for agent-initiated messages. Absent for messages that are
    // a response to a user request — those continue to render as bubbles.
    kind?: AgentMessageKind | undefined;
}

export type NotifyExplainedData = {
    error?: string | undefined;
    fromCache: "construction" | "grammar" | false;
    fromUser: boolean;
    time: string;
};

// Options for ClientIO.notify. All notifications are ephemeral by default and
// are NOT written to the DisplayLog — set persist:true to opt a notification
// in to durable logging and replay on conversation rejoin.
export type NotifyOptions = {
    persist?: boolean;
};

// Client provided IO
export interface ClientIO {
    clear(requestId: RequestId): void;
    exit(requestId: RequestId): void;
    shutdown(requestId: RequestId): void;

    // Display
    setUserRequest(requestId: RequestId, command: string, seq?: number): void;
    setDisplayInfo(
        requestId: RequestId,
        source: string,
        actionIndex?: number,
        action?: TypeAgentAction | string[],
        seq?: number,
    ): void;
    setDisplay(message: IAgentMessage, seq?: number): void;
    appendDisplay(
        message: IAgentMessage,
        mode: DisplayAppendMode,
        seq?: number,
    ): void;
    appendDiagnosticData(requestId: RequestId, data: any): void;
    setDynamicDisplay(
        requestId: RequestId,
        source: string,
        actionIndex: number,
        displayId: string,
        nextRefreshMs: number,
    ): void;

    // Input
    question(
        requestId: RequestId | undefined,
        message: string,
        choices: string[],
        defaultId?: number,
        source?: string,
    ): Promise<number>;
    proposeAction(
        requestId: RequestId,
        actionTemplates: TemplateEditConfig,
        source: string,
    ): Promise<unknown>;

    // Notification (TODO: turn these in to dispatcher events)
    // Default behavior is ephemeral: notifications are broadcast to clients
    // but not written to the DisplayLog. Pass options.persist=true to opt in
    // to logging and history replay.
    notify(
        notificationId: string | RequestId | undefined,
        event: string,
        data: any,
        source: string,
        seq?: number,
        options?: NotifyOptions,
    ): void;
    notify(
        requestId: RequestId,
        event: "explained",
        data: NotifyExplainedData,
        source: string,
        seq?: number,
        options?: NotifyOptions,
    ): void;

    openLocalView(requestId: RequestId, port: number): Promise<void>;
    closeLocalView(requestId: RequestId, port: number): Promise<void>;

    // Non-blocking choice request (yes/no buttons or multi-select checkboxes)
    requestChoice(
        requestId: RequestId,
        choiceId: string,
        type: "yesNo" | "multiChoice",
        message: string,
        choices: string[],
        source: string,
    ): void;

    // Non-blocking interaction requests (async deferred pattern)
    requestInteraction(interaction: PendingInteractionRequest): void;
    interactionResolved(interactionId: string, response: unknown): void;
    interactionCancelled(interactionId: string): void;

    // Host specific (TODO: Formalize the API)
    takeAction(requestId: RequestId, action: string, data: unknown): void;

    // User-feedback broadcast. When one client posts a rating via
    // Dispatcher.recordUserFeedback, the dispatcher fans the resulting
    // UserFeedbackEntry out to all connected clients via this call so
    // their views stay in sync without a full history refetch.
    // Optional: tests and CLI-only implementations may omit it.
    onUserFeedback?(entry: UserFeedbackEntry): void;

    // User-hide broadcast — fanned out when the user trashes or restores
    // a bubble via the UI, or when @shell trash flush/restore runs.
    onUserHide?(entry: UserMessageHiddenEntry): void;

    // ===== Message-queue push events (Phase 1) =====
    // All optional, all fire-and-forget. Existing clients that do not
    // implement them continue to work; they simply won't render queue UI.

    /** A new entry was appended to the queue tail. */
    requestQueued?(entry: QueuedRequest, version: number): void;

    /** The drain loop popped an entry and started executing it. */
    requestStarted?(entry: QueuedRequest, version: number): void;

    /**
     * A queued or running entry was cancelled. Cancellation of a
     * running entry continues to surface through the existing
     * AbortController + `commandComplete` notify path; this is a
     * supplementary signal so clients can update queue UI eagerly.
     */
    requestCancelled?(
        requestId: string,
        reason: QueueCancelReason,
        version: number,
    ): void;

    /**
     * Coarse-grained snapshot fired after every queue transition.
     * Clients that prefer not to track fine-grained events can simply
     * re-render from this. The snapshot reflects the state AFTER the
     * transition.
     */
    queueStateChanged?(snapshot: QueueSnapshot): void;
}
