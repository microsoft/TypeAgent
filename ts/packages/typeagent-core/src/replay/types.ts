// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CorpusFilter, CorpusSource, FeedbackLabel } from "../corpus/types.js";
import type { CollisionDetectedEvent } from "../events/types.js";

export type ReplayMissPolicy =
    | "needs-explanation"
    | "live-llm"
    | "strict-cache";

export type VersionSpec =
    | { kind: "git"; ref: string }
    | { kind: "workingTree" };

export interface ReplayOptions {
    agent: string;
    corpus: CorpusFilter;
    versionA: VersionSpec;
    versionB: VersionSpec;
    missPolicy: ReplayMissPolicy;
    batchSize?: number;
}

export type ReplayCacheState =
    | "hit"
    | "miss"
    | "needs-explanation"
    | "llm-resolved"
    | "skipped";

export interface ActionDelta {
    utterance: string;
    source: CorpusSource;
    utteranceId: string;
    actionA?: unknown;
    actionB?: unknown;
    equal: boolean;
    cacheStateA: ReplayCacheState;
    cacheStateB: ReplayCacheState;
    feedbackA?: FeedbackLabel;
    feedbackB?: FeedbackLabel;
    collisionsA: CollisionDetectedEvent[];
    collisionsB: CollisionDetectedEvent[];
    latencyA: number;
    latencyB: number;
    requestIdA: string;
    requestIdB: string;
}

export interface ReplaySummary {
    runId: string;
    agent: string;
    versionA: VersionSpec;
    versionB: VersionSpec;
    corpusSize: number;
    rowCount: number;
    equalCount: number;
    changedCount: number;
    newMatchCount: number;
    lostMatchCount: number;
    collisionDelta: number;
    duration: number;
    missPolicy: ReplayMissPolicy;
}

export interface ReplayCostEstimate {
    estimatedCalls: number;
    estimatedCostUsd: number;
}

export function estimateLiveLlmCost(
    utteranceCount: number,
    unresolvedMisses: number,
    avgCallCostUsd: number,
): ReplayCostEstimate {
    const calls = Math.max(0, Math.min(utteranceCount, unresolvedMisses));
    return {
        estimatedCalls: calls,
        estimatedCostUsd: Number((calls * avgCallCostUsd).toFixed(4)),
    };
}
