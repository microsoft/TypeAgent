// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AgentMessageKind,
    DisplayAppendMode,
    DisplayContent,
    TemplateSchema,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { RequestId, RequestMetrics, UserContext } from "./dispatcher.js";
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
    /**
     * Relaunch the host process (agent-server) so it loads rebuilt code.
     * Optional: only the standalone agent-server implements it. Hosts that
     * can't self-restart (embedded/in-process) leave it undefined, and
     * `@server restart` reports that restart isn't available.
     */
    restart?(requestId: RequestId): void;

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

    /**
     * Return a fresh, coarse snapshot of the host editor state (no file or
     * selection text). Optional: only editor-hosted clients (e.g. the VS Code
     * shell) implement it. Others omit it and the reasoning `get_user_context`
     * tool reports that no editor context is available.
     *
     * `requestId` carries the originating client's connectionId so a routing
     * implementation (the agent-server SharedDispatcher) can prefer the client
     * that issued the request when several are joined to one conversation. Leaf
     * clients ignore it and report their own editor state.
     */
    getUserContext?(requestId?: RequestId): Promise<UserContext | undefined>;

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

    // Non-blocking choice request (yes/no buttons, multi-select checkboxes,
    // or a single-select pick + "remember" checkbox via `pickRemember`).
    requestChoice(
        requestId: RequestId,
        choiceId: string,
        type: "yesNo" | "multiChoice" | "pickRemember",
        message: string,
        choices: string[],
        source: string,
        checkboxLabel?: string,
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

    // Message-queue push events. All optional/fire-and-forget; clients that
    // don't implement them simply won't render queue UI.

    /** A new entry was appended to the queue tail. */
    requestQueued?(entry: QueuedRequest, version: number): void;

    /** The drain loop popped an entry and started executing it. */
    requestStarted?(entry: QueuedRequest, version: number): void;

    /**
     * A queued or running entry was cancelled. Supplementary signal — running
     * cancellations also surface through the AbortController + `commandComplete`
     * path.
     */
    requestCancelled?(
        requestId: string,
        reason: QueueCancelReason,
        version: number,
    ): void;

    /**
     * Coarse-grained snapshot fired after every queue transition. Reflects
     * the state AFTER the transition.
     */
    queueStateChanged?(snapshot: QueueSnapshot): void;
}
