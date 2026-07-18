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
    // Total tokens (prompt + completion, plus cached_tokens when reported)
    total_tokens: number;
    // Cached prompt tokens (read from / written to the model provider's prompt
    // cache), reported separately from prompt_tokens. Optional; undefined =>
    // not reported.
    cached_tokens?: number;
};

export type CommandResult = {
    // last error message
    lastError?: string;

    // True if the command was cancelled via cancelCommand().
    cancelled?: boolean;

    // Actions that were executed as part of the command.
    actions?: TypeAgentAction[];
    metrics?: RequestMetrics;
    // Token usage for translating the user's request into actions (the LLM
    // "translation" step). Absent for @-commands and cached translations.
    tokenUsage?: CompletionUsageStats;
    // Token usage accumulated across all executed actions/commands that
    // self-reported via `ActionResult.tokenUsage`. `undefined` => no action
    // reported usage (unknown). A present all-zero value => actions ran but
    // made no LLM call.
    actionTokenUsage?: CompletionUsageStats;
};

// Architecture: docs/architecture/core/completion.md — Data flow / Key types
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

/**
 * A line/character position. Uses the host editor's native 0-based indexing
 * (VS Code), so ranges line up with the CODA read actions that return text.
 */
export type EditorPosition = {
    line: number;
    character: number;
};

/** A single diagnostic (compiler/linter message) on the active file. */
export type DiagnosticItem = {
    severity: "error" | "warning" | "info" | "hint";
    /** 0-based line of the diagnostic's start position. */
    line: number;
    message: string;
    /** Producer of the diagnostic (e.g. "ts", "eslint"), when known. */
    source?: string;
};

/** One open file editor (tab) in the host. */
export type OpenEditorInfo = {
    /** Workspace-relative path of the open file. */
    path: string;
    /** Whether this is the active tab. */
    active: boolean;
    /** Whether the tab has unsaved changes. */
    dirty: boolean;
};

/**
 * Coarse snapshot of the host editor state. Carries lightweight metadata
 * (paths, ranges, counts) plus bounded samples of what the user is likely
 * pointing at - the active selection's text, the active file's diagnostic
 * messages, and the open-editor list. Heavier text (full file contents, git
 * diff, on-screen range) is still pulled on demand through the CODA read
 * actions so nothing large is attached by default.
 */
export type EditorContext = {
    /** Workspace-relative path of the active file, if any. */
    activeFilePath?: string;
    /** Language id of the active file (e.g. "typescript"). */
    languageId?: string;
    /** Whether the active file has unsaved changes. */
    isDirty?: boolean;
    /** Cursor position (0-based). */
    cursor?: EditorPosition;
    /** Selection range (0-based). `isEmpty` true means it is just the caret. */
    selection?: {
        isEmpty: boolean;
        start: EditorPosition;
        end: EditorPosition;
        /**
         * The selected text, present only when the selection is non-empty.
         * Bounded to a cap by the host (large highlights are truncated with
         * `truncated: true`) so a big selection can't bloat the prompt. Full
         * file contents are still pulled on demand via the CODA read actions.
         */
        text?: string;
        /** True when `text` was truncated to the host's cap. */
        truncated?: boolean;
    };
    /** Names of the open workspace folders. */
    workspaceFolders?: string[];
    /**
     * Diagnostics for the active file: severity counts plus a bounded,
     * severity-ordered sample of the actual messages so the model can act on
     * "fix the error" without a separate pull.
     */
    diagnostics?: {
        errors: number;
        warnings: number;
        infos: number;
        hints: number;
        /** Bounded sample of the actual diagnostics (errors first). */
        items?: DiagnosticItem[];
        /** Count of diagnostics beyond the sampled `items`. */
        omitted?: number;
    };
    /** Number of open editor tabs across all groups. */
    openEditorCount?: number;
    /**
     * Bounded list of open file editors so the model can resolve references
     * like "the other file". `openEditorsOmitted` counts any beyond the cap.
     */
    openEditors?: OpenEditorInfo[];
    openEditorsOmitted?: number;
};

/**
 * User-environment context for translation prompts.
 * Provides information about the host application context to improve translation accuracy.
 */
export type UserContext = {
    /** Top-level appAgent name the user is currently working in (e.g., "code", "spotify"). */
    activeApp: string;
    /** Free-text description of the app, typically copied from the agent manifest. Optional. */
    activeAppDescription?: string;
    /**
     * Coarse editor state: lightweight metadata plus a bounded copy of the
     * active selection's text (no full file contents). Present when the host is
     * an editor (e.g. the VS Code shell). Pull heavier text via CODA.
     */
    editor?: EditorContext;
    // TODO (client-capability context): UserContext models only the
    // editor/environment state today. A separate "client capability" context -
    // what the originating client can do (render images, apply diffs, voice,
    // whether it hosts an editor) - is not modeled yet. Add it here (or as a
    // sibling type) when reasoning needs capability-aware responses. See
    // docs/plans/vscode-devx.
};

export type ProcessCommandOptions = {
    /**
     * When true, skip reasoning, clarification, and chat fallback.
     * Use when the caller (e.g. an AI agent) handles reasoning itself
     * and TypeAgent should act as a pure action executor.
     */
    noReasoning?: boolean;
    /**
     * User-environment context for translation prompts.
     * Provides information about which app/host the user is currently in
     * to improve translation accuracy (e.g., to disambiguate "change volume"
     * between desktop audio and a media player app).
     */
    userContext?: UserContext;
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
     * `docs/architecture/core/messageQueueing.md`.
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
     * Whether developer mode is currently on for this session. Clients call
     * this after connecting so dev-only UI (e.g. the per-message delete
     * button) reflects a server started with `--dev` without waiting for a
     * `@config dev` toggle.
     */
    getDeveloperMode(): Promise<boolean>;

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
        response: boolean | number[] | { selected: number; remember: boolean },
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
     * Promote a queued command so it runs next, ahead of any other queued
     * entries ("jump the queue"). Does not affect the currently-running
     * request — the promoted entry runs when the running one finishes.
     *
     * Resolves `true` if a matching queued entry was found (and moved, or was
     * already next); `false` for the running entry or an unknown requestId.
     * Never rejects under normal operation.
     *
     * @param requestId the requestId string of the queued command to promote
     */
    promoteCommand(requestId: string): Promise<boolean>;

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
