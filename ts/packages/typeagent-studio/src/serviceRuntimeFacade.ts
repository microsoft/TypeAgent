// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RepoRootResolution,
    StudioReplayRequest,
    StudioReplayResult,
    ReplayResolutionTraceRequest,
    ReplayResolutionTraceResult,
    StudioCorpusImportRequest,
    StudioCorpusImportResult,
    PackagingHealthGateResult,
    ProveUtteranceOptions,
    UtteranceProofResult,
} from "@typeagent/core/runtime";
import type {
    OnboardingState,
    OnboardingPhaseName,
    PhaseStatus,
    RestorePhaseResult,
} from "@typeagent/core/onboardingBridge";
import type { CorpusEntry, ExternalSourceSpec } from "@typeagent/core/corpus";
import type { FeedbackRecordInput } from "@typeagent/core/feedback";
import type { SandboxStatus } from "@typeagent/core/sandbox";
import type { StudioServiceConnection } from "./studioServiceConnection.js";

/** The Corpus tree's read+subscribe surface (channel-backed). */
export interface CorpusSource {
    onSandboxChanged(listener: () => void): { dispose(): void };
    getRepoRootInfo(): RepoRootResolution;
    listCorpusAgents(): Promise<string[]>;
    listCorpusEntries(agent: string): Promise<CorpusEntry[]>;
}

/** The health status bar's surface (repo info is local; sandboxes are remote). */
export interface HealthSource {
    onSandboxChanged(listener: () => void): { dispose(): void };
    getRepoRootInfo(): RepoRootResolution;
    listSandboxes(): Promise<SandboxStatus[]>;
}

/**
 * The onboarding surface the New Agent wizard (F1.1) and the onboarding command
 * palette consume. It mirrors the onboarding subset of the service's
 * `StudioRuntime`, but every method is **async** — onboarding now runs in the
 * standalone Studio service (where the real sandboxes live, so installs no
 * longer split-brain), reached over the channel. `listPhases`/`routeConversation`
 * are async here (they are sync on the in-process `StudioRuntime`).
 */
export interface OnboardingRuntime {
    startOnboarding(seed: {
        description: string;
        agentName?: string;
    }): Promise<OnboardingState>;
    getActiveOnboardingSession(): Promise<OnboardingState>;
    clearActiveOnboardingSession(): Promise<void>;
    listPhases(): Promise<readonly OnboardingPhaseName[]>;
    getDefaultInputsForPhaseOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<unknown>;
    runPhaseOnActiveSession(
        phase: OnboardingPhaseName,
        inputs?: unknown,
    ): Promise<OnboardingState>;
    getPhaseStatusOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<PhaseStatus>;
    listStalePhasesOnActiveSession(): Promise<OnboardingPhaseName[]>;
    runRemainingPhasesOnActiveSession(): Promise<{
        state: OnboardingState;
        completedPhases: OnboardingPhaseName[];
    }>;
    rerunPhasesOnActiveSession(phases: OnboardingPhaseName[]): Promise<{
        state: OnboardingState;
        rerunPhases: OnboardingPhaseName[];
    }>;
    restorePhaseOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<RestorePhaseResult>;
    resolveInstallArtifactPathForActiveSession(): Promise<string>;
    evaluatePackagingHealthGateForActiveSession(): Promise<PackagingHealthGateResult>;
    enforcePackagingHealthGateForActiveSession(): Promise<PackagingHealthGateResult>;
    installLastSessionToSandbox(
        sandboxId?: string,
        options?: { skipHealthGate?: boolean },
    ): Promise<{ sessionId: string; artifactPath: string }>;
    installArtifactToSandbox(
        artifactPath: string,
        sandboxId?: string,
    ): Promise<{ sessionId: string; artifactPath: string }>;
    routeConversation(
        prompt: string,
    ): Promise<{ target: "onboarding" | "schemaAuthor"; reason: string }>;
    proveActiveSessionUtterance(
        options?: ProveUtteranceOptions,
    ): Promise<UtteranceProofResult>;
}

const NOT_CONNECTED =
    "Studio service is not connected. Open the workspace so Studio can launch it, or run `typeagent-studio serve`.";

/**
 * Backs the extension's corpus / health / feedback / replay surfaces with the
 * shared {@link StudioServiceConnection} to the standalone Studio service — the
 * single live runtime for the workspace (the extension no longer runs its own).
 * `repoRootInfo` is resolved locally from the VS Code workspace (no runtime
 * needed); everything else routes to the service. Reads return empty when
 * momentarily disconnected; mutations reject with a clear message.
 */
export class StudioServiceRuntimeFacade
    implements CorpusSource, HealthSource, OnboardingRuntime
{
    constructor(
        private readonly connection: StudioServiceConnection,
        private readonly repoRootInfo: RepoRootResolution,
    ) {}

    private require() {
        const client = this.connection.getClient();
        if (client === undefined) {
            throw new Error(NOT_CONNECTED);
        }
        return client;
    }

    getRepoRootInfo(): RepoRootResolution {
        return this.repoRootInfo;
    }

    onSandboxChanged(listener: () => void): { dispose(): void } {
        return this.connection.onEvent((event) => {
            if (event.type.startsWith("sandbox.")) {
                listener();
            }
        });
    }

    async listSandboxes(): Promise<SandboxStatus[]> {
        return (await this.connection.getClient()?.listSandboxes()) ?? [];
    }

    async listCorpusAgents(): Promise<string[]> {
        return (await this.connection.getClient()?.listCorpusAgents()) ?? [];
    }

    async listCorpusEntries(agent: string): Promise<CorpusEntry[]> {
        return (
            (await this.connection.getClient()?.listCorpusEntries(agent)) ?? []
        );
    }

    async seedInRepoCorpus(
        agent: string,
    ): Promise<{ path: string; created: boolean }> {
        return this.require().seedInRepoCorpus(agent);
    }

    async addExternalCorpusSource(spec: ExternalSourceSpec): Promise<void> {
        return this.require().addExternalCorpusSource(spec);
    }

    async importCorpusFromLogs(
        request: StudioCorpusImportRequest,
    ): Promise<StudioCorpusImportResult> {
        return this.require().importCorpusFromLogs(request);
    }

    async recordFeedback(input: FeedbackRecordInput): Promise<void> {
        return this.require().recordFeedback(input);
    }

    async replayCorpus(
        request: StudioReplayRequest,
    ): Promise<StudioReplayResult> {
        return this.require().replayCorpus(request);
    }

    async replayResolutionTrace(
        request: ReplayResolutionTraceRequest,
    ): Promise<ReplayResolutionTraceResult> {
        return this.require().replayResolutionTrace(request);
    }

    // --- Onboarding / New Agent wizard (F1.x). All route to the service, whose
    // injected phaseRunner runs the onboarding agent in that process. Mutations
    // (and reads) reject with a clear "not connected" message when the service
    // socket is momentarily down — the wizard treats a failed snapshot as "no
    // active session" (start screen) and surfaces other errors inline. ---

    async startOnboarding(seed: {
        description: string;
        agentName?: string;
    }): Promise<OnboardingState> {
        return this.require().startOnboarding(seed);
    }

    async getActiveOnboardingSession(): Promise<OnboardingState> {
        return this.require().getActiveOnboardingSession();
    }

    async clearActiveOnboardingSession(): Promise<void> {
        return this.require().clearActiveOnboardingSession();
    }

    async listPhases(): Promise<readonly OnboardingPhaseName[]> {
        return this.require().listPhases();
    }

    async getDefaultInputsForPhaseOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<unknown> {
        return this.require().getDefaultInputsForPhaseOnActiveSession(phase);
    }

    async runPhaseOnActiveSession(
        phase: OnboardingPhaseName,
        inputs?: unknown,
    ): Promise<OnboardingState> {
        return this.require().runPhaseOnActiveSession(phase, inputs);
    }

    async getPhaseStatusOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<PhaseStatus> {
        return this.require().getPhaseStatusOnActiveSession(phase);
    }

    async listStalePhasesOnActiveSession(): Promise<OnboardingPhaseName[]> {
        return this.require().listStalePhasesOnActiveSession();
    }

    async runRemainingPhasesOnActiveSession(): Promise<{
        state: OnboardingState;
        completedPhases: OnboardingPhaseName[];
    }> {
        return this.require().runRemainingPhasesOnActiveSession();
    }

    async rerunPhasesOnActiveSession(phases: OnboardingPhaseName[]): Promise<{
        state: OnboardingState;
        rerunPhases: OnboardingPhaseName[];
    }> {
        return this.require().rerunPhasesOnActiveSession(phases);
    }

    async restorePhaseOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<RestorePhaseResult> {
        return this.require().restorePhaseOnActiveSession(phase);
    }

    async resolveInstallArtifactPathForActiveSession(): Promise<string> {
        return this.require().resolveInstallArtifactPathForActiveSession();
    }

    async evaluatePackagingHealthGateForActiveSession(): Promise<PackagingHealthGateResult> {
        return this.require().evaluatePackagingHealthGateForActiveSession();
    }

    async enforcePackagingHealthGateForActiveSession(): Promise<PackagingHealthGateResult> {
        return this.require().enforcePackagingHealthGateForActiveSession();
    }

    async installLastSessionToSandbox(
        sandboxId?: string,
        options?: { skipHealthGate?: boolean },
    ): Promise<{ sessionId: string; artifactPath: string }> {
        return this.require().installLastSessionToSandbox(sandboxId, options);
    }

    async installArtifactToSandbox(
        artifactPath: string,
        sandboxId?: string,
    ): Promise<{ sessionId: string; artifactPath: string }> {
        return this.require().installArtifactToSandbox(artifactPath, sandboxId);
    }

    async routeConversation(
        prompt: string,
    ): Promise<{ target: "onboarding" | "schemaAuthor"; reason: string }> {
        return this.require().routeConversation(prompt);
    }

    async proveActiveSessionUtterance(
        options?: ProveUtteranceOptions,
    ): Promise<UtteranceProofResult> {
        return this.require().proveActiveSessionUtterance(options);
    }
}
