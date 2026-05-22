// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CompletionDirection,
    CompletionGroup,
    DisplayType,
    DynamicDisplay,
    TemplateSchema,
    TypeAgentAction,
    AfterWildcard,
} from "@typeagent/agent-sdk";
import type {
    DisplayLogEntry,
    UserFeedbackCategory,
    UserFeedbackRating,
} from "./displayLogEntry.js";
import type { PendingInteractionResponse } from "./pendingInteraction.js";
import type { CancelResult, QueueSnapshot, SubmitResult } from "./queue.js";

export const DispatcherName = "dispatcher";
export const DispatcherEmoji = "🤖";

/**
 * Identifies a command request across the dispatcher and all connected clients.
 *
 * - `requestId` is assigned by the dispatcher via `randomUUID()` and is
 *   **guaranteed unique within a session**. It serves as the canonical key for
 *   associating all output (setDisplay, appendDisplay, etc.) with the
 *   originating request. Clients should use this value — not clientRequestId —
 *   to key message groups and other per-request state.
 *
 * - `clientRequestId` is an opaque, client-assigned identifier passed through
 *   by the dispatcher. Its format and uniqueness are client-specific (e.g. the
 *   shell uses incrementing "cmd-0", "cmd-1", ...) and it is NOT guaranteed
 *   unique across sessions or clients.
 *
 * - `connectionId` identifies the client connection that originated the request.
 */
export type RequestId = {
    connectionId?: string | undefined;
    requestId: string;
    clientRequestId?: unknown | undefined;
};

export type Timing = {
    duration: number;
    count: number;
};

export type PhaseTiming = {
    marks?: Record<string, Timing>;
    duration?: number | undefined;
};
export type RequestMetrics = {
    parse?: PhaseTiming | undefined;
    command?: PhaseTiming | undefined;
    actions: (PhaseTiming | undefined)[];
    duration?: number | undefined;
};

// Statistics returned by the LLM completion APIs
export type CompletionUsageStats = {
    // Number of tokens in the generated completion
    completion_tokens: number;
    // Number of tokens in the prompt
    prompt_tokens: number;
    // Total tokens (prompt + completion)
    total_tokens: number;
};

export type CommandResult = {
    // last error message
    lastError?: string;

    // True if the command was cancelled via cancelCommand().
    cancelled?: boolean;

    // Actions that were executed as part of the command.
    actions?: TypeAgentAction[];
    metrics?: RequestMetrics;
    tokenUsage?: CompletionUsageStats;
};

// Architecture: docs/architecture/completion.md — Data flow / Key types
export type CommandCompletionResult = {
    // Index into the input where the resolved prefix ends and the
    // filter/completion region begins.  input[0..startIndex) is fully
    // resolved; completions describe what can follow after that prefix.
    startIndex: number;
    completions: CompletionGroup[]; // completions available at the current position
    // True when the completions form a closed set — if the user types
    // something not in the list, no further completions can exist
    // beyond it.  When true and the user types something that doesn't
    // prefix-match any completion, the caller can skip refetching since
    // no other valid input exists.
    closedSet: boolean;
    // True when the result would differ if queried with the opposite
    // direction.  When false, the caller can skip re-fetching on
    // direction change.
    directionSensitive: boolean;
    // Describes how the grammar rules that produced completions at
    // this position relate to wildcards.  See AfterWildcard in
    // @typeagent/agent-sdk.
    //   "none" — no wildcard; position is structurally pinned.
    //   "some" — mixed; some rules used wildcards, some didn't.
    //   "all"  — every rule used a wildcard; position can slide.
    afterWildcard: AfterWildcard;
};

export type AppAgentStatus = {
    emoji: string;
    name: string;
    lastUsed: boolean;
    priority: boolean;
    request: boolean;
    active: boolean;
};

export type DispatcherStatus = {
    agents: AppAgentStatus[];
    details: string;
};

export type ConnectionId = string;

/** A single action exposed by an agent sub-schema. */
export type ActionInfo = {
    name: string;
    description: string;
};

/** One schema group within an agent (main schema or sub-schema). */
export type AgentSubSchemaInfo = {
    /** Exact schemaName to supply to @action dispatch, e.g. "desktop.desktop-taskbar" */
    schemaName: string;
    description: string;
    /** Generated TypeScript schema text for this sub-schema, if available. */
    schemaText: string | undefined;
    actions: ActionInfo[];
};

/** Top-level agent with its grouped sub-schemas. */
export type AgentSchemaInfo = {
    name: string;
    emoji: string;
    description: string;
    subSchemas: AgentSubSchemaInfo[];
};

export type ProcessCommandOptions = {
    /**
     * When true, skip reasoning, clarification, and chat fallback.
     * Use when the caller (e.g. an AI agent) handles reasoning itself
     * and TypeAgent should act as a pure action executor.
     */
    noReasoning?: boolean;
};

/**
 * A dispatcher instance
 */
export interface Dispatcher {
    readonly connectionId: ConnectionId | undefined;

    /**
     * Capability flag — `true` when this dispatcher is backed by a
     * real server-side message queue (i.e. `submitCommand` provides
     * meaningful FIFO + cross-client broadcast semantics). `false` or
     * `undefined` for the in-process / direct dispatcher fallback,
     * which executes synchronously and offers no queueing guarantees.
     *
     * Clients that want to gate UX on real queue support (e.g. show a
     * `(queue: N)` badge) should check this rather than testing for
     * the presence of `submitCommand`, which is always defined for
     * type-completeness even in the fallback.
     */
    readonly supportsQueueing?: boolean;

    /**
     * Process a single user request.
     *
     * @param command user request to process.  Request that starts with '@' are direct commands, otherwise they are treaded as a natural language request.
     * @param requestId an optional request id to track the command
     * @param attachments encoded image attachments for the model
     * @param options optional processing options
     */
    processCommand(
        command: string,
        clientRequestId?: unknown,
        attachments?: string[],
        options?: ProcessCommandOptions,
        requestId?: string,
    ): Promise<CommandResult | undefined>;

    /**
     * Submit a request for queued execution.
     *
     * Unlike `processCommand`, this resolves as soon as the request
     * has been accepted onto the server-side message queue, returning
     * a discriminated `SubmitResult`. Completion is observed via
     * ClientIO push events (`requestStarted`, `queueStateChanged`, the
     * existing `setDisplay`/`notify` flow, and ultimately the
     * `commandComplete` notify already broadcast by SharedDispatcher).
     *
     * The `SubmitResult` discriminator carries `queue_full` /
     * `server_stopping` as data rather than thrown errors because the
     * RPC layer strips error subclass identity — see `SubmitResult`
     * for the rationale.
     *
     * Implementations that do not own a queue (direct in-process
     * dispatcher mode, indicated by `supportsQueueing !== true`) fall
     * back to invoking `processCommand` and synthesizing a single-
     * entry `{ ok: true, entry }` result — failures from the
     * underlying execution are surfaced to the originator via a
     * `commandComplete` notify with the error attached. Callers that
     * need true FIFO + cross-client broadcast semantics MUST check
     * `supportsQueueing`.
     */
    submitCommand(
        command: string,
        attachments?: string[],
        options?: ProcessCommandOptions,
        clientRequestId?: unknown,
    ): Promise<SubmitResult>;

    /**
     * Snapshot of the server-side queue. Cheap, in-memory. Returns an
     * empty snapshot for dispatchers without a queue.
     */
    getQueueSnapshot(): Promise<QueueSnapshot>;

    /**
     * Steering primitive — cancel the currently-running request (if
     * any) and immediately enqueue `text` at the head of the queue so
     * it runs *next*, ahead of anything already queued. Returns a
     * `SubmitResult` describing the new entry (or the standard queue-
     * full / server-stopping failure modes).
     *
     * Atomicity: the cancel-then-prepend pair is performed inside
     * the server-side queue's critical section so a racing
     * `submitCommand` from another client cannot land between them
     * and steal the head slot. This is the whole reason `interrupt`
     * exists as a server RPC rather than client-side composition of
     * `cancelCommand` + `submitCommand` — see messageSteering.md §4.5.
     *
     * The rest of the queue is preserved: pre-existing queued
     * entries stay queued, just behind the interrupting one. Side
     * effects from the cancelled running request are NOT rolled back
     * (same semantics as `cancelCommand`).
     *
     * Implementations without a queue (`supportsQueueing !== true`)
     * SHOULD reject with `SubmitResult.error = "server_stopping"`
     * or an analogous failure; callers MUST gate interrupt UX on
     * `supportsQueueing`.
     */
    interrupt(
        text: string,
        attachments?: string[],
        options?: ProcessCommandOptions,
        clientRequestId?: unknown,
    ): Promise<SubmitResult>;

    /**
     * Close the dispatcher and release all resources.
     */
    close(): Promise<void>;

    /**
     * Get the latest update on a dynamic display that is returned to the host via ClientIO or CommandResult
     * @param appAgentName the agent name that originated the display
     * @param type the type of the display content.
     * @param displayId the displayId of the display content as given from ClientIO or CommandResult.
     */
    getDynamicDisplay(
        appAgentName: string,
        type: DisplayType,
        displayId: string,
    ): Promise<DynamicDisplay>;

    // APIs for form filling templates.
    getTemplateSchema(
        templateAgentName: string,
        templateName: string,
        data: unknown,
    ): Promise<TemplateSchema>;

    getTemplateCompletion(
        templateAgentName: string,
        templateName: string,
        data: unknown,
        propertyName: string,
    ): Promise<string[] | undefined>;

    // APIs to get command completion for intellisense like functionality.
    getCommandCompletion(
        prefix: string,
        direction: CompletionDirection,
    ): Promise<CommandCompletionResult>;

    // Check if a request can be handled by cache without executing
    checkCache(request: string): Promise<CommandResult | undefined>;

    getStatus(): Promise<DispatcherStatus>;

    /**
     * Get schema and action metadata for all active agents, or a specific agent.
     * @param agentName optional — if provided, returns only the named agent
     */
    getAgentSchemas(agentName?: string): Promise<AgentSchemaInfo[]>;

    /**
     * Respond to a pending choice from an agent.
     * @param choiceId the choice ID returned from ChoiceManager.registerChoice
     * @param response boolean for yesNo, number[] of selected indices for multiChoice
     */
    respondToChoice(
        choiceId: string,
        response: boolean | number[],
    ): Promise<CommandResult | undefined>;

    /**
     * Get the display log entries for the current session.
     * @param afterSeq if provided, return only entries with seq > afterSeq
     */
    getDisplayHistory(afterSeq?: number): Promise<DisplayLogEntry[]>;

    /**
     * Respond to a pending interaction (async deferred pattern).
     * Resolves the deferred promise associated with the given interactionId.
     *
     * @param response the client's response containing the interactionId and value
     */
    respondToInteraction(response: PendingInteractionResponse): Promise<void>;

    /**
     * Explicitly cancel a pending interaction by the client.
     * Cancellations by client are explicit; disconnects do not auto-cancel.
     *
     * This is a fire-and-forget operation — the server silently ignores
     * unknown interactionIds and broadcasts `interactionCancelled` to all
     * clients regardless of whether the interaction was found.
     *
     * @param interactionId the interactionId of the pending interaction to cancel
     */
    cancelInteraction(interactionId: string): void;

    /**
     * Cancel an in-flight or queued command.
     *
     * The returned `CancelResult` distinguishes whether the entry was
     * cancelled while still queued (no work ran), while running (the
     * AbortController was triggered and `processCommand` will resolve
     * with `{ cancelled: true }` at the next checkpoint), or whether
     * the requestId was unknown (`not_found`). Phase 1 implementations
     * never report `already_completed` — see `CancelResult`.
     *
     * Fire-and-forget callers may ignore the returned promise; it
     * never rejects under normal operation.
     *
     * @param requestId the requestId string of the command to cancel
     * @returns a `CancelResult` describing what the server did
     */
    cancelCommand(requestId: string): Promise<CancelResult>;

    /**
     * Cancel an in-flight command using the client-assigned id that was passed
     * as the second argument to processCommand().  This is the early-cancel
     * path: the client can call this immediately after processCommand() returns
     * without waiting for setUserRequest() to deliver the server-assigned UUID.
     *
     * @param clientRequestId the same value passed to processCommand() as clientRequestId
     */
    cancelCommandByClientId(clientRequestId: unknown): void;

    /**
     * Record a user's rating on the agent message identified by requestId.
     * Append-only: a subsequent call with the same requestId supersedes the
     * earlier rating. Pass `rating: null` to clear.
     *
     * The dispatcher persists the rating in displayLog, emits a telemetry
     * "userFeedback" event, and broadcasts the change to other connected
     * clients via ClientIO.onUserFeedback so their views stay in sync.
     */
    recordUserFeedback(
        requestId: RequestId,
        rating: UserFeedbackRating,
        category?: UserFeedbackCategory,
        comment?: string,
        includeContext?: boolean,
    ): Promise<void>;

    /**
     * Move (or restore) one side of a request — `target: "user"` for
     * the user message bubble, `target: "agent"` for the agent
     * response(s), or omit `target` to apply to both. Append-only: a
     * subsequent call with the same (requestId, target) supersedes the
     * earlier state. `permanent: true` marks the hide as flushed — the
     * user can't recover it via `@shell trash restore`.
     *
     * Persists to displayLog, broadcasts via ClientIO.onUserHide.
     */
    recordUserHide(
        requestId: RequestId,
        hidden: boolean,
        target?: "user" | "agent",
        permanent?: boolean,
    ): Promise<void>;

    /**
     * Restore every currently-hidden (non-permanent) bubble. Writes one
     * `hidden: false` entry per restored request. Returns the count
     * restored.
     */
    restoreAllHidden(): Promise<number>;

    /**
     * Flush the trash: every currently-hidden (non-permanent) bubble is
     * re-recorded with `permanent: true`. The bubbles stay hidden, and
     * `restoreAllHidden` will no longer touch them. Returns the count
     * flushed.
     */
    flushHidden(): Promise<number>;
}
