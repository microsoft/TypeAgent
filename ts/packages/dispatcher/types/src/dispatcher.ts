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
import type { DisplayLogEntry } from "./displayLogEntry.js";
import type { PendingInteractionResponse } from "./pendingInteraction.js";

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
    ): Promise<CommandResult | undefined>;

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
     * Cancel an in-flight command. If the command identified by requestId is
     * currently executing, its AbortController is triggered, causing the
     * command pipeline to stop at the next cancellation checkpoint.
     *
     * This is a fire-and-forget operation — the in-flight processCommand()
     * call will resolve with `{ cancelled: true }`.
     *
     * @param requestId the requestId string of the command to cancel
     */
    cancelCommand(requestId: string): void;
}
