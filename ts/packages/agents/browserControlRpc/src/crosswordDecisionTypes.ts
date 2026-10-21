// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CrosswordMode = "generative" | "decision";
export type CrosswordDirection = "across" | "down";

export function isCrosswordMode(value: unknown): value is CrosswordMode {
    return value === "generative" || value === "decision";
}

export const CROSSWORD_DECISION_LIMITS = {
    candidates: 64,
    textLength: 512,
    contextLength: 512,
    snapshotBytes: 64 * 1024,
    timeoutMs: 60_000,
    snapshotLifetimeMs: 120_000,
    fitThreshold: 0.8,
    collectorVersion: 1,
    policyVersion: 1,
} as const;

export type CrosswordCandidate = {
    id: string;
    text: string;
    context: string;
    role?: string;
};

export type CrosswordSnapshot = {
    snapshotId: string;
    documentToken: string;
    puzzleId: string;
    revision: number;
    modeGeneration: number;
    createdAt: number;
    collectorVersion: number;
    complete: boolean;
    candidates: CrosswordCandidate[];
};

// Added by the extension service worker, never taken from a page message.
export type CrosswordRpcOrigin = {
    tabId: number;
    frameId: number;
    documentId: string;
};

export type ResolveCrosswordClueRequest = {
    snapshot: CrosswordSnapshot;
    clueNumber: number;
    clueDirection: CrosswordDirection;
    origin?: CrosswordRpcOrigin;
};

export type CrosswordDecisionStatus =
    | "resolved"
    | "no_fit"
    | "ambiguous"
    | "unsupported"
    | "stale"
    | "unavailable"
    | "cancelled"
    | "provider_error";

export type ResolveCrosswordClueResponse = {
    snapshotId: string;
    documentToken: string;
    puzzleId: string;
    revision: number;
    modeGeneration: number;
    configGeneration: string;
    status: CrosswordDecisionStatus;
    candidateId?: string;
    fit?: number;
    choiceProbability?: number;
    message?: string;
};

export type CrosswordDecisionCapabilities = {
    available: boolean;
    provider?: string;
    model?: string;
    configGeneration: string;
    message?: string;
};
