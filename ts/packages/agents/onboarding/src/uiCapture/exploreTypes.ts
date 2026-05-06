// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionVerb } from "./types.js";

export type CapturedState = {
    id: string;
    fingerprint: string;
    capturedAt: number;
    windowTitle: string;
    treeFile: string;
    screenshotFile?: string;
    label?: string;
    notes?: string;
};

export type TransitionSource = "agent" | "user" | "external";

export type CapturedTransition = {
    id: string;
    iteration: number;
    fromStateId: string;
    toStateId: string;
    trigger: {
        selector: string;
        verb: ActionVerb;
        value?: string | number | boolean;
    };
    rationale?: string;
    expectedDelta?: string;
    observedDeltaSummary?: string;
    source: TransitionSource;
    timestamp: number;
    success: boolean;
    errorMessage?: string;
};

export type FrontierVerb = {
    verb: ActionVerb;
    valueShape?: "free-text" | "range" | "selection" | "boolean" | "none";
    rangeMeta?: { min: number; max: number; step?: number };
    selectionItems?: string[];
};

export type FrontierItem = {
    id: string;
    selector: string;
    controlType: string;
    name?: string;
    automationId?: string;
    className?: string;
    verbs: FrontierVerb[];
    destructiveHint: boolean;
    boundingRect?: { x: number; y: number; width: number; height: number };
};

export type ExploreDecisionAct = {
    kind: "act";
    frontierId: string;
    verb: ActionVerb;
    value?: string | number | boolean;
    expectedDelta: string;
    rationale: string;
};

export type ExploreDecisionStop = { kind: "stop"; reason: string };
export type ExploreDecisionRestore = { kind: "restore"; rationale: string };
export type ExploreDecisionUserPause = { kind: "userPause"; rationale: string };

export type ExploreDecision =
    | ExploreDecisionAct
    | ExploreDecisionStop
    | ExploreDecisionRestore
    | ExploreDecisionUserPause;

export type DecisionInput = {
    iteration: number;
    state: CapturedState;
    frontier: FrontierItem[];
    visitedStates: Array<{ id: string; label?: string; fingerprint: string }>;
    recentTransitions: CapturedTransition[];
    budget: { remainingIterations: number; remainingMs: number };
};

export interface DecisionOracle {
    decide(input: DecisionInput): Promise<ExploreDecision>;
}

export type ExploreBudget = {
    maxIterations?: number;
    maxWallClockMs?: number;
    maxStates?: number;
    convergenceThreshold?: number;
    historyTailSize?: number;
};

export type ExploreRunMetrics = {
    runId: string;
    startedAt: string;
    endedAt: string;
    walltimeMs: number;
    iterations: number;
    statesDiscovered: number;
    transitionsRecorded: number;
    successfulTransitions: number;
    failedTransitions: number;
    stopReason: string;
    convergenceIterations: number;
};
