// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type OnboardingPhaseName =
    | "Discovery"
    | "PhraseGen"
    | "SchemaGen"
    | "GrammarGen"
    | "Scaffolder"
    | "Testing"
    | "Packaging";

export const ONBOARDING_PHASE_ORDER: OnboardingPhaseName[] = [
    "Discovery",
    "PhraseGen",
    "SchemaGen",
    "GrammarGen",
    "Scaffolder",
    "Testing",
    "Packaging",
];

export type PhaseStatus = "pending" | "running" | "complete" | "stale";

export interface PhaseSnapshot {
    status: PhaseStatus;
    inputs: unknown;
    outputs?: unknown;
    startedAt?: number;
    completedAt?: number;
    /** Hashes of all ancestor outputs when this phase last completed. */
    ancestorPhaseHashes: string[];
}

export interface OnboardingState {
    sessionId: string;
    agentName: string;
    description: string;
    phases: Partial<Record<OnboardingPhaseName, PhaseSnapshot>>;
    currentPhase: OnboardingPhaseName;
    installedSandboxIds?: string[];
}

export interface OnboardingStartSeed {
    description: string;
    agentName?: string;
}

export interface RestorePhaseResult {
    state: OnboardingState;
    affectedDownstream: OnboardingPhaseName[];
    reconciliationRequired: boolean;
}

export interface OnboardingBridge {
    start(seed: OnboardingStartSeed): Promise<OnboardingState>;
    runPhase(
        sessionId: string,
        phase: OnboardingPhaseName,
        inputs?: unknown,
    ): Promise<PhaseSnapshot>;
    snapshot(sessionId: string): Promise<OnboardingState>;
    restorePhase(
        sessionId: string,
        phase: OnboardingPhaseName,
    ): Promise<RestorePhaseResult>;
    installToSandbox(sessionId: string, sandboxId: string): Promise<void>;
}

export class OnboardingSessionNotFoundError extends Error {
    constructor(public readonly sessionId: string) {
        super(`Onboarding session not found: ${sessionId}`);
        this.name = "OnboardingSessionNotFoundError";
    }
}
