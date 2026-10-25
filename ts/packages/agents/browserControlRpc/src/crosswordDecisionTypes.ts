// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CrosswordMode = "generative" | "decision";
export type CrosswordDirection = "across" | "down";
export type CrosswordDecisionStrategy = "hybrid" | "hybrid2";

export function isCrosswordDecisionStrategy(
    value: unknown,
): value is CrosswordDecisionStrategy {
    return value === "hybrid" || value === "hybrid2";
}

export function parseCrosswordClueIdentity(
    text: string,
    context: string,
): { number?: number; direction?: CrosswordDirection; text: string } {
    const normalized = text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    const label =
        /^(?:(across|down)\s+)?(\d{1,4})(?!\d)(?:(?:\s*(across|down)\b|([ad])\b))?[\s.:)-]*/i.exec(
            normalized,
        );
    const explicit = label?.[1] ?? label?.[3] ?? label?.[4];
    const nearest = context
        .normalize("NFKC")
        .toLowerCase()
        .split("|")
        .map((part) => /^(across|down)\b/.exec(part.trim())?.[1])
        .find((part) => part !== undefined);
    const observedDirection = explicit ?? nearest;
    const direction =
        observedDirection === "a" || observedDirection === "across"
            ? "across"
            : observedDirection === "d" || observedDirection === "down"
              ? "down"
              : undefined;
    return {
        ...(label ? { number: Number(label[2]) } : {}),
        ...(direction ? { direction } : {}),
        text: normalized.slice(label?.[0].length ?? 0).trim(),
    };
}

export function isCrosswordMode(value: unknown): value is CrosswordMode {
    return value === "generative" || value === "decision";
}

export const CROSSWORD_DECISION_LIMITS = {
    candidates: 2048,
    decisionCandidates: 253,
    decisionQuestions: 64,
    textLength: 512,
    contextLength: 512,
    snapshotBytes: 2 * 1024 * 1024,
    decisionTokens: 24 * 1024,
    decisionRepackTokens: 16 * 1024,
    maxDecisionCalls: 32,
    timeoutMs: 60_000,
    snapshotLifetimeMs: 120_000,
    collectorVersion: 2,
    policyVersion: 11,
} as const;

export type CrosswordCandidate = {
    id: string;
    text: string;
    context: string;
    role?: string;
    regionId?: string;
    scopeId?: string;
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
    strategy?: CrosswordDecisionStrategy;
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
