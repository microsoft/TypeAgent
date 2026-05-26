// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * F0.3 — Structured event stream types.
 *
 * See docs/plans/vscode-devx/05-implementation-plan.md §2 for the schema-versioning
 * rule: bump the top-level `schemaVersion` only on payload-breaking changes; adding
 * a new optional field or a new event type does not bump it.
 */

export const EVENT_SCHEMA_VERSION = 1;

export interface StudioEventBase {
    /** Top-level schema version. Bumped only on payload-breaking changes. */
    schemaVersion: typeof EVENT_SCHEMA_VERSION;
    /** Discriminator for the union types below. */
    type: string;
    /** Epoch ms. */
    ts: number;
    /** Correlates a single user-request dispatch. */
    requestId?: string;
    /** Correlates a single replay run (F4.1). */
    runId?: string;
    /** Which sandbox emitted the event. Always present. */
    sandboxId: string;
    /** Agent involved, when applicable. */
    agent?: string;
}

/* -------------------------------------------------------------------------- */
/* Phase events                                                                */
/* -------------------------------------------------------------------------- */

export interface PhaseStartEvent extends StudioEventBase {
    type: "phase.start";
    /** Dispatcher phase name (e.g. "translate", "execute"). */
    phase: string;
}

export interface PhaseEndEvent extends StudioEventBase {
    type: "phase.end";
    phase: string;
    /** Milliseconds since matching phase.start. */
    durationMs: number;
    success: boolean;
    errorMessage?: string;
}

/* -------------------------------------------------------------------------- */
/* Cache events                                                                */
/* -------------------------------------------------------------------------- */

export type CacheSystemKind = "completionBased" | "nfa";

export interface CacheHitEvent extends StudioEventBase {
    type: "cache.hit";
    cacheKey: string;
    systemKind: CacheSystemKind;
}

export interface CacheMissEvent extends StudioEventBase {
    type: "cache.miss";
    cacheKey: string;
    systemKind: CacheSystemKind;
    reason?: string;
}

/* -------------------------------------------------------------------------- */
/* Grammar match events                                                        */
/* -------------------------------------------------------------------------- */

export interface GrammarMatchAttemptEvent extends StudioEventBase {
    type: "grammar.match.attempt";
    utterance: string;
    ruleId?: string;
}

export interface GrammarMatchResultEvent extends StudioEventBase {
    type: "grammar.match.result";
    utterance: string;
    matched: boolean;
    ruleId?: string;
    /** Number of candidate rules considered. */
    candidateCount?: number;
}

/* -------------------------------------------------------------------------- */
/* Action events                                                               */
/* -------------------------------------------------------------------------- */

export interface ActionSelectedEvent extends StudioEventBase {
    type: "action.selected";
    actionType: string;
    /** Source of the selection: grammar match, cache hit, LLM translation. */
    source: "grammar" | "cache" | "llm";
}

export interface ActionExecutedEvent extends StudioEventBase {
    type: "action.executed";
    actionType: string;
    success: boolean;
    durationMs: number;
    errorMessage?: string;
}

/* -------------------------------------------------------------------------- */
/* Feedback events (PR #2341)                                                  */
/* -------------------------------------------------------------------------- */

export type FeedbackRating = "up" | "down";
export type FeedbackCategory =
    | "wrong-agent"
    | "didnt-understand"
    | "bad-response"
    | "other";

export interface FeedbackRecordedEvent extends StudioEventBase {
    type: "feedback.recorded";
    rating: FeedbackRating;
    category?: FeedbackCategory;
    comment?: string;
    /** True when user attached prompt/responses/actions context to the feedback. */
    includesContext?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Collision events (§10)                                                      */
/* -------------------------------------------------------------------------- */

export type CollisionKind = "overlap" | "shadow" | "ambiguity";
export type CollisionDetectionPoint =
    | "load"
    | "schema-edit"
    | "grammar-edit"
    | "replay";

export interface CollisionParticipant {
    agent: string;
    actionType: string;
    file: string;
    /** [startLine, endLine] (1-based, inclusive). */
    range: [number, number];
}

export interface CollisionDetectedEvent extends StudioEventBase {
    type: "collision.detected";
    kind: CollisionKind;
    detectionPoint: CollisionDetectionPoint;
    /** Experiment id from the §10 tagging system. */
    experimentId?: string;
    participants: CollisionParticipant[];
    exemplarUtterances?: string[];
}

/* -------------------------------------------------------------------------- */
/* Reasoning trace events                                                      */
/* -------------------------------------------------------------------------- */

export interface ReasoningStepEvent extends StudioEventBase {
    type: "reasoning.step";
    stepName: string;
    /** Opaque payload captured by the reasoning subsystem. */
    payload?: unknown;
}

/* -------------------------------------------------------------------------- */
/* Sandbox lifecycle events (F0.1)                                             */
/* -------------------------------------------------------------------------- */

export type SandboxState =
    | "starting"
    | "running"
    | "stopping"
    | "stopped"
    | "crashed";

export interface SandboxLifecycleEvent extends StudioEventBase {
    type:
        | "sandbox.start"
        | "sandbox.stop"
        | "sandbox.restart"
        | "sandbox.agent.loaded"
        | "sandbox.agent.unloaded";
    state?: SandboxState;
    /** Name of the agent for agent.loaded / agent.unloaded. */
    affectedAgent?: string;
}

/* -------------------------------------------------------------------------- */
/* Replay events (F4.1)                                                        */
/* -------------------------------------------------------------------------- */

export interface ReplayRowEvent extends StudioEventBase {
    type: "replay.row";
    /** Index of the row within the replay run. */
    rowIndex: number;
    utteranceId: string;
    /** Equal action JSON across versions A and B. */
    equal: boolean;
}

export interface ReplaySummaryEvent extends StudioEventBase {
    type: "replay.summary";
    rowCount: number;
    equalCount: number;
    changedCount: number;
    durationMs: number;
}

/* -------------------------------------------------------------------------- */
/* Union + filter + versioning                                                 */
/* -------------------------------------------------------------------------- */

export type StudioEvent =
    | PhaseStartEvent
    | PhaseEndEvent
    | CacheHitEvent
    | CacheMissEvent
    | GrammarMatchAttemptEvent
    | GrammarMatchResultEvent
    | ActionSelectedEvent
    | ActionExecutedEvent
    | FeedbackRecordedEvent
    | CollisionDetectedEvent
    | ReasoningStepEvent
    | SandboxLifecycleEvent
    | ReplayRowEvent
    | ReplaySummaryEvent;

export type StudioEventType = StudioEvent["type"];

/** Filter passed to subscribe / query. All fields are AND'd; arrays within a field are OR'd. */
export interface EventFilter {
    types?: StudioEventType[];
    requestIds?: string[];
    runIds?: string[];
    agents?: string[];
    sandboxIds?: string[];
}

export interface EventStreamVersions {
    schemaVersion: typeof EVENT_SCHEMA_VERSION;
    supportedEventTypes: StudioEventType[];
}

export const SUPPORTED_EVENT_TYPES: StudioEventType[] = [
    "phase.start",
    "phase.end",
    "cache.hit",
    "cache.miss",
    "grammar.match.attempt",
    "grammar.match.result",
    "action.selected",
    "action.executed",
    "feedback.recorded",
    "collision.detected",
    "reasoning.step",
    "sandbox.start",
    "sandbox.stop",
    "sandbox.restart",
    "sandbox.agent.loaded",
    "sandbox.agent.unloaded",
    "replay.row",
    "replay.summary",
];

/** Helper to check filter applicability to a single event. Exported for reuse + tests. */
export function eventMatchesFilter(
    event: StudioEvent,
    filter: EventFilter | undefined,
): boolean {
    if (!filter) return true;
    if (filter.types && !filter.types.includes(event.type)) return false;
    if (filter.sandboxIds && !filter.sandboxIds.includes(event.sandboxId)) {
        return false;
    }
    if (
        filter.requestIds &&
        (event.requestId === undefined ||
            !filter.requestIds.includes(event.requestId))
    ) {
        return false;
    }
    if (
        filter.runIds &&
        (event.runId === undefined || !filter.runIds.includes(event.runId))
    ) {
        return false;
    }
    if (
        filter.agents &&
        (event.agent === undefined || !filter.agents.includes(event.agent))
    ) {
        return false;
    }
    return true;
}
