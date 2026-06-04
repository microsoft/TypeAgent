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
     * Submit a request for queued execution.
     *
     * Resolves with a discriminated `SubmitResult`:
     *
     * - On success, `{ok: true, entry}` where `entry` is a
     *   `SubmittedRequest` — the server-assigned `QueuedRequest`
     *   (use `entry.requestId` to key UI state, cancellation, etc.)
     *   plus an `entry.completion` promise that resolves with the
     *   eventual `CommandResult` (or `{cancelled: true}` when the
     *   request is cancelled) and rejects with `ServerStoppingError`
     *   if the server abandons the entry during shutdown.
     *
     * - On submit-time failure, `{ok: false, error: "queue_full" | "server_stopping"}`
     *   with a typed `error` discriminant. Callers that need to preserve
     *   the historical `processCommand` semantics convert these to thrown
     *   `QueueFullError` / `ServerStoppingError` instances before awaiting
     *   `entry.completion`.
     *
     * The drain loop, fan-out, and cancellation semantics are described in
     * `docs/architecture/messageQueueing.md`.
     *
     * @param command user request to process. Requests that start with '@' are direct commands, otherwise treated as natural language.
     * @param attachments encoded image attachments forwarded to the inner dispatcher.
     * @param options optional processing options.
     * @param clientRequestId opaque client-assigned id surfaced back on the entry; pair with `cancelCommandByClientId` for early cancel.
     * @param requestId optional caller-supplied server-side request id. Defaults to a fresh UUID when omitted; useful for hosts (Shell main, VS) that pre-allocate ids to keep UI state in sync before the ack arrives.
     */
    submitCommand(
        command: string,
        attachments?: string[],
        options?: ProcessCommandOptions,
        clientRequestId?: unknown,
        requestId?: string,
    ): Promise<SubmitResult>;

    /**
     * Snapshot of the server-side queue. Cheap, in-memory.
     */
    getQueueSnapshot(): Promise<QueueSnapshot>;

    /**
     * Cancel the currently-running request (if any) and enqueue `text` at the
     * head of the queue so it runs next. The cancel-then-prepend pair is
     * atomic within the server's critical section so a racing `submitCommand`
     * cannot steal the head slot — this is why `interrupt` exists as a server
     * RPC rather than client-side composition.
     *
     * Pre-existing queued entries are preserved (just shifted back). Side
     * effects from the cancelled running request are NOT rolled back.
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
     * @param response boolean for yesNo, number[] of selected indices for
     *   multiChoice, or `{ selected, remember }` for pickRemember
     */
    respondToChoice(
        choiceId: string,
        response:
            | boolean
            | number[]
            | { selected: number; remember: boolean },
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
     * The returned `CancelResult` indicates whether the entry was cancelled
     * while queued (no work ran), while running (the AbortController was
     * triggered; the entry's `completion` resolves with `{ cancelled: true }`
     * at the next checkpoint), or whether the requestId was unknown.
     *
     * Never rejects under normal operation.
     *
     * @param requestId the requestId string of the command to cancel
     * @returns a `CancelResult` describing what the server did
     */
    cancelCommand(requestId: string): Promise<CancelResult>;

    /**
     * Cancel an in-flight command using the client-assigned id that was passed
     * as the `clientRequestId` argument to `submitCommand()`.  This is the
     * early-cancel path: the client can call this immediately after
     * `submitCommand()` returns without waiting for the server-assigned UUID
     * to round-trip back via `entry.requestId`.
     *
     * @param clientRequestId the same value passed to submitCommand() as clientRequestId
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
