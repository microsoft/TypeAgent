// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TypeChat schema for the autonomous-explore decision oracle.
// Loaded as text by TypeChat — keep self-contained, no runtime imports.

/** One decision per iteration: act / stop / restore. */
export type ExploreDecision = ActDecision | StopDecision | RestoreDecision;

/** Take an action against a control on the current frontier. */
export type ActDecision = {
    /** Always "act". */
    kind: "act";
    /** ID of a frontier item from the input (e.g. "F-007"). Must be one shown to you. */
    frontierId: string;
    /** Verb to apply. Must be one of the verbs declared on the chosen frontier item. */
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
     * Target value for setValue / toggle / select. Omit for verbs that take no value
     * (invoke, focus, click, scroll, expand without an explicit boolean).
     */
    value?: string | number | boolean;
    /**
     * Short prediction of how the app state will change after this action.
     * Compared against the observed delta on the next iteration.
     */
    expectedDelta: string;
    /** One sentence: why this action advances the goal. */
    rationale: string;
};

/** End exploration. */
export type StopDecision = {
    /** Always "stop". */
    kind: "stop";
    /** Why exploration is complete (e.g. "all observed states have empty frontier"). */
    reason: string;
};

/**
 * Reset to baseline. Use when current branch is exhausted or the app is in
 * an unhelpful state and a clean slate is needed.
 */
export type RestoreDecision = {
    /** Always "restore". */
    kind: "restore";
    /** One sentence: why a restore is preferable to acting in the current state. */
    rationale: string;
};
