// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StudioServiceInvokeFunctions } from "@typeagent/core/runtime";
import type { SandboxStatus } from "@typeagent/core/sandbox";
import type { OnboardingState } from "@typeagent/core/onboardingBridge";

const RUNNING = {
    id: "studio-default",
    agents: [],
    state: "running",
} as unknown as SandboxStatus;

const ONBOARDING_STATE: OnboardingState = {
    sessionId: "stub-session",
    agentName: "thermostat",
    description: "a stub onboarding session",
    phases: {},
    currentPhase: "Discovery",
};

const HEALTH_GATE = {
    status: "unavailable" as const,
    summary: "stub",
    findings: [],
    artifactPath: "/repo/ts/stub",
};

/**
 * Full {@link StudioServiceInvokeFunctions} with harmless defaults, so test
 * stub servers only override the handful of methods a test exercises (keeps the
 * stubs complete as the protocol grows without per-test churn).
 */
export function stubInvokeHandlers(
    overrides: Partial<StudioServiceInvokeFunctions> = {},
): StudioServiceInvokeFunctions {
    return {
        getStudioInfo: async () => ({
            repoRootInfo: { repoRoot: "/repo/ts", agentsDirFound: true },
            agentLocations: [],
        }),
        listCollisions: async () => [],
        scanGrammarCollisions: async () => ({
            scanned: [],
            skipped: [],
            collisionCount: 0,
        }),
        clearCollisions: async () => 0,
        queryRecentEvents: async () => [],
        listCorpusAgents: async () => [],
        canValidateWildcards: async () => false,
        listCorpusEntries: async () => [],
        seedInRepoCorpus: async () => ({
            path: "/repo/ts/corpus",
            created: false,
        }),
        addExternalCorpusSource: async () => {},
        recordFeedback: async () => {},
        replayCorpus: async () => ({
            runId: "r",
            summary: {} as never,
            rows: [],
        }),
        replayResolutionTrace: async () => ({ status: "unavailable" }),
        subscribeEvents: async () => {},
        unsubscribeEvents: async () => {},
        listSandboxes: async () => [],
        listAvailableAgents: async () => [],
        startSandbox: async () => RUNNING,
        stopSandbox: async () => {},
        restartSandbox: async () => {},
        loadSandboxAgent: async () => RUNNING,
        unloadSandboxAgent: async () => RUNNING,
        refreshSandboxAgent: async () => 0,
        restoreSandboxes: async () => {},
        startOnboarding: async () => ONBOARDING_STATE,
        getActiveOnboardingSession: async () => ONBOARDING_STATE,
        clearActiveOnboardingSession: async () => {},
        listPhases: async () => ["Discovery"],
        getDefaultInputsForPhaseOnActiveSession: async () => ({}),
        runPhaseOnActiveSession: async () => ONBOARDING_STATE,
        getPhaseStatusOnActiveSession: async () => "pending",
        listStalePhasesOnActiveSession: async () => [],
        runRemainingPhasesOnActiveSession: async () => ({
            state: ONBOARDING_STATE,
            completedPhases: [],
        }),
        rerunPhasesOnActiveSession: async () => ({
            state: ONBOARDING_STATE,
            rerunPhases: [],
        }),
        restorePhaseOnActiveSession: async () => ({
            state: ONBOARDING_STATE,
            affectedDownstream: [],
            reconciliationRequired: false,
        }),
        resolveInstallArtifactPathForActiveSession: async () => "/repo/ts/stub",
        evaluatePackagingHealthGateForActiveSession: async () => HEALTH_GATE,
        enforcePackagingHealthGateForActiveSession: async () => HEALTH_GATE,
        checkPackagingHealthGate: async () => HEALTH_GATE,
        installLastSessionToSandbox: async () => ({
            sessionId: "stub-session",
            artifactPath: "/repo/ts/stub",
        }),
        installArtifactToSandbox: async () => ({
            sessionId: "stub-session",
            artifactPath: "/repo/ts/stub",
        }),
        routeConversation: async () => ({
            target: "onboarding",
            reason: "stub",
        }),
        ...overrides,
    };
}
