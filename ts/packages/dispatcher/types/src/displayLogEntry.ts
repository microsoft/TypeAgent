// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { DisplayAppendMode, TypeAgentAction } from "@typeagent/agent-sdk";
import type {
    IAgentMessage,
    NotifyExplainedData,
    TemplateEditConfig,
} from "./clientIO.js";
import type { RequestId, RequestMetrics } from "./dispatcher.js";
import type { PendingInteractionType } from "./pendingInteraction.js";

export type SetDisplayEntry = {
    type: "set-display";
    seq: number;
    timestamp: number;
    message: IAgentMessage;
};

export type AppendDisplayEntry = {
    type: "append-display";
    seq: number;
    timestamp: number;
    message: IAgentMessage;
    mode: DisplayAppendMode;
};

export type SetDisplayInfoEntry = {
    type: "set-display-info";
    seq: number;
    timestamp: number;
    requestId: RequestId;
    source: string;
    actionIndex?: number;
    action?: TypeAgentAction | string[];
};

export type NotifyEntry = {
    type: "notify";
    seq: number;
    timestamp: number;
    notificationId: string | RequestId | undefined;
    event: string;
    data: NotifyExplainedData | any;
    source: string;
};

export type UserRequestEntry = {
    type: "user-request";
    seq: number;
    timestamp: number;
    requestId: RequestId;
    command: string;
};

export type PendingInteractionEntry = {
    type: "pending-interaction";
    seq: number;
    timestamp: number;
    interactionId: string;
    interactionType: PendingInteractionType;
    requestId?: RequestId;
    source: string;
    // question fields
    message?: string;
    choices?: string[];
    defaultId?: number;
    // proposeAction fields
    actionTemplates?: TemplateEditConfig;
};

export type InteractionResolvedEntry = {
    type: "interaction-resolved";
    seq: number;
    timestamp: number;
    interactionId: string;
    response: unknown;
};

export type InteractionCancelledEntry = {
    type: "interaction-cancelled";
    seq: number;
    timestamp: number;
    interactionId: string;
};

/**
 * Logged when a command completes. Carries the full RequestMetrics and
 * the LLM token usage so that consumers replaying history can re-render
 * timing/cost information (e.g. hover tooltip on the agent bubble) just
 * like they would for a live command.
 */
export type CommandResultEntry = {
    type: "command-result";
    seq: number;
    timestamp: number;
    requestId: RequestId;
    metrics?: RequestMetrics;
    tokenUsage?: import("./dispatcher.js").CompletionUsageStats;
    // Token usage accumulated across executed actions/commands (self-reported
    // via ActionResult.tokenUsage). `undefined` => not reported / unknown.
    actionTokenUsage?: import("./dispatcher.js").CompletionUsageStats;
};

export type UserFeedbackRating = "up" | "down" | null;

export type UserFeedbackCategory =
    | "wrong-agent"
    | "didnt-understand"
    | "bad-response"
    | "other";

/**
 * A user's rating of a completed agent message, keyed by the request
 * that produced the message. Append-only: later entries with the same
 * requestId shadow earlier ones, so editing or clearing a rating is
 * just another entry.
 */
export type UserFeedbackEntry = {
    type: "user-feedback";
    seq: number;
    timestamp: number;
    requestId: RequestId;
    rating: UserFeedbackRating;
    category?: UserFeedbackCategory;
    comment?: string;
};

/**
 * Tracks user-driven hide/restore of one side of a request — the user
 * message bubble OR the agent response (independent toggles). Append-
 * only: a later entry with the same (requestId, target) supersedes the
 * earlier one. `permanent` marks a flushed hide — `@shell trash
 * restore` skips these so the user can't recover bubbles they
 * explicitly flushed.
 *
 * `target` is optional for back-compat with entries written before the
 * split (those hid the whole MessageGroup). New code always sets it.
 */
export type UserMessageHiddenEntry = {
    type: "user-message-hidden";
    seq: number;
    timestamp: number;
    requestId: RequestId;
    hidden: boolean;
    permanent?: boolean;
    target?: "user" | "agent";
};

export type DisplayLogEntry =
    | SetDisplayEntry
    | AppendDisplayEntry
    | SetDisplayInfoEntry
    | NotifyEntry
    | UserRequestEntry
    | PendingInteractionEntry
    | InteractionResolvedEntry
    | InteractionCancelledEntry
    | CommandResultEntry
    | UserFeedbackEntry
    | UserMessageHiddenEntry;
