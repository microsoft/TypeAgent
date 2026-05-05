// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TypeChat schemas for the synthesis pass: neutral-state classification,
// chunk clustering, and synthesized-action generation. Loaded as text by
// TypeChat — keep self-contained, no runtime imports.

/* ---------- Neutral state classification ---------- */

/** Classify a batch of captured states as "neutral" (settled, awaiting next user action) or not. */
export type NeutralStatesClassification = {
    classifications: NeutralStateClassification[];
};

export type NeutralStateClassification = {
    /** State id from the input (e.g. "state-007"). */
    stateId: string;
    /** True if this state is a settled rest point — the user could start a new task from here.
     *  False if this state is mid-flow (e.g., a modal dialog requires resolution, an animation in progress). */
    isNeutral: boolean;
    /** One sentence: why neutral or not. */
    reason: string;
    /** Optional human-friendly label like "alarmTab.empty" or "timerTab.running". Camel-and-dot case. */
    tabOrSection?: string;
};

/* ---------- Chunk clustering ---------- */

/** Group chunks by user-meaningful intent. */
export type ClusteringResult = {
    clusters: ChunkCluster[];
    /** Chunks that don't fit any cluster (e.g., partial paths the explorer abandoned). */
    orphans?: string[];
};

export type ChunkCluster = {
    /** Stable id for this cluster (e.g. "cl-001"). */
    clusterId: string;
    /** camelCase verb-noun, e.g. "createAlarm", "startTimer", "navigateToTab". */
    intentName: string;
    /** One sentence describing what the user accomplishes by performing this intent. */
    shortDescription: string;
    /** Ids of chunks (from the input) that belong to this cluster. */
    chunkIds: string[];
};

/* ---------- Synthesized action ---------- */

/** A user-meaningful action ready for downstream phases (phraseGen / schemaGen). */
export type SynthesizedAction = {
    /** camelCase verb-noun (matches the cluster's intentName by default). */
    actionName: string;
    /** Short user-facing description, suitable for help text. */
    description: string;
    /** Parameters extracted from the cluster's chunk variations (empty if all chunks were identical). */
    parameters: ParamSpec[];
    /** Sequenced steps to replay this action at runtime. */
    playback: PlaybackStep[];
    /** Required app state before invoking this action. */
    preconditions: { neutralState: string; description: string };
    /** What the app looks like after the action completes successfully. */
    postconditions: { description: string };
    /** True if the action irreversibly destroys user data (deletes, resets, clears). */
    destructive: boolean;
};

export type ParamSpec = {
    /** camelCase, e.g. "name", "minutes", "enabled". */
    name: string;
    /** "string" | "number" | "boolean" | "enum". */
    type: "string" | "number" | "boolean" | "enum";
    /** When type is "enum", the allowed values. */
    enumValues?: string[];
    /** One short sentence describing what this parameter controls. */
    description: string;
    /** Concrete values observed in the source chunks. */
    examples: Array<string | number | boolean>;
};

export type PlaybackStep = {
    /** Selector path of the control to act on. */
    selector: string;
    /** Verb to apply to that control. */
    verb:
        | "invoke"
        | "toggle"
        | "setValue"
        | "select"
        | "expand"
        | "scroll"
        | "focus"
        | "click";
    /**
     * If this step's value is parameterized, ${paramName} reference. Set
     * either valueRef OR valueLiteral, not both. Omit both for verbs with
     * no value (invoke/focus/click).
     */
    valueRef?: string;
    /** Constant value for verbs that need one. */
    valueLiteral?: string | number | boolean;
    /** Wait for UIA to settle after this step. Default true for invoke/select; false otherwise. */
    waitForIdle?: boolean;
    /** Optional: short description of what changed after this step (sanity check at replay time). */
    expectedDeltaSummary?: string;
};

/* ---------- Validation ---------- */

/** Result of reviewing the full synthesized action set for quality issues. */
export type ValidationResult = {
    /** Per-action review. */
    reviews: ActionReview[];
    /**
     * Action names that should be MERGED — they're really the same intent
     * with different parameters and should be one parameterized action.
     * Each entry lists the names to combine.
     */
    mergeRecommendations?: MergeRecommendation[];
    /** High-level notes about the overall set: gaps, naming conventions, etc. */
    overallNotes?: string;
};

export type ActionReview = {
    actionName: string;
    /** Quality verdict. */
    verdict: "ok" | "fragment" | "duplicate" | "broken" | "ambiguous";
    /** One sentence explanation of any concern. */
    note: string;
    /** Suggested fix in plain English (optional — only when verdict != "ok"). */
    suggestion?: string;
};

export type MergeRecommendation = {
    /** Names of the existing actions that should be merged into one. */
    actionNames: string[];
    /** Proposed combined name (camelCase verb-noun). */
    proposedName: string;
    /** Proposed parameter name that distinguishes the variants (the dimension along which they differ). */
    proposedParam: {
        name: string;
        type: "string" | "number" | "boolean" | "enum";
        enumValues?: string[];
    };
    /** One sentence: why these belong together. */
    rationale: string;
};
