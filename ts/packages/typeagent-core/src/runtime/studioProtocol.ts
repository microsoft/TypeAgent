// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StudioEvent, CollisionDetectedEvent } from "../events/index.js";
import type { CollisionFilter } from "../collisions/index.js";
import type { SandboxStatus } from "../sandbox/index.js";
import type { CorpusEntry, ExternalSourceSpec } from "../corpus/index.js";
import type { FeedbackRecordInput } from "../feedback/index.js";
import type { RepoRootResolution } from "./repoRootResolver.js";
import type {
    AgentLocation,
    AvailableAgent,
    StudioReplayRequest,
    StudioReplayResult,
    ReplayResolutionTraceRequest,
    ReplayResolutionTraceResult,
    StudioCollisionScanRequest,
    StudioCollisionScanResult,
    StudioCorpusImportRequest,
    StudioCorpusImportResult,
    PackagingHealthGateResult,
    ProveUtteranceOptions,
    UtteranceProofResult,
} from "./studioRuntimeCore.js";
import type {
    OnboardingState,
    OnboardingPhaseName,
    PhaseStatus,
    RestorePhaseResult,
} from "../onboardingBridge/index.js";

/**
 * Wire types for the Studio service channel — the typed protocol the standalone,
 * per-workspace Studio service serves over its WebSocket and the
 * `typeagent-studio` extension (and the `studio` agent proxy, and any other rich
 * client) consumes.
 *
 * These are **pure data / function-map types** with no transport dependency:
 * `@typeagent/core` must not depend on `agent-rpc`. The server and client
 * modules pair these with `createRpc` from `agent-rpc` separately.
 *
 * Repo scoping: the Studio runtime is per-workspace (one per resolved repo
 * root), so **every request carries `repoRoot`** and the event subscription is
 * per-connection — a client for one repo must never receive another repo's
 * events.
 */

/** Result of the service-level `getStudioInfo` (composes two runtime reads). */
export interface StudioInfo {
    repoRootInfo: RepoRootResolution;
    agentLocations: AgentLocation[];
}

/**
 * Client → server requests (request/response). The leading `repoRoot` selects
 * the target workspace runtime; omit to use the service's default
 * (`TYPEAGENT_STUDIO_REPO_ROOT` / cwd).
 */
export type StudioServiceInvokeFunctions = {
    /** Repo root + the agent search locations Studio scans. */
    getStudioInfo(repoRoot?: string): Promise<StudioInfo>;
    /** Known cross-schema grammar collisions (newest first). */
    listCollisions(
        repoRoot?: string,
        filter?: CollisionFilter,
    ): Promise<CollisionDetectedEvent[]>;
    /**
     * Scan agents' compiled grammars for cross-schema collisions (read-only
     * analysis — reads compiled grammars, reports into the collision store; no
     * agent/sandbox mutation).
     */
    scanGrammarCollisions(
        repoRoot?: string,
        request?: StudioCollisionScanRequest,
    ): Promise<StudioCollisionScanResult>;
    /** Remove stored collisions matching the filter (all when omitted). */
    clearCollisions(
        repoRoot?: string,
        filter?: CollisionFilter,
    ): Promise<number>;
    /** Most recent structured Studio events, oldest-to-newest. */
    queryRecentEvents(
        repoRoot?: string,
        limit?: number,
    ): Promise<StudioEvent[]>;
    /** Corpus agents available for replay in this workspace. */
    listCorpusAgents(repoRoot?: string): Promise<string[]>;
    /**
     * Whether wildcard validation can run for `agent` in replay — the agent
     * loads and exposes a `validateWildcardMatch`. The Impact Report reads this
     * before a run to disable its validation toggle when there is nothing to
     * run.
     */
    canValidateWildcards(
        repoRoot: string | undefined,
        agent: string,
    ): Promise<boolean>;
    /**
     * Federated corpus entries for an agent (in-repo, external, feedback) —
     * what the Corpus tree expands.
     */
    listCorpusEntries(
        repoRoot: string | undefined,
        agent: string,
    ): Promise<CorpusEntry[]>;
    /**
     * Ensure an agent's in-repo corpus file exists so it can be populated;
     * returns its path and whether it was newly created.
     */
    seedInRepoCorpus(
        repoRoot: string | undefined,
        agent: string,
    ): Promise<{ path: string; created: boolean }>;
    /**
     * Register an external JSONL corpus source for an agent. Throws if a source
     * with the same name already exists for the agent.
     */
    addExternalCorpusSource(
        repoRoot: string | undefined,
        spec: ExternalSourceSpec,
    ): Promise<void>;
    /**
     * Import one or more `displayLog.json` files into the shared in-repo corpus
     * for this workspace. Returns counts written/skipped per agent and the files
     * read.
     */
    importCorpusFromLogs(
        repoRoot: string | undefined,
        request: StudioCorpusImportRequest,
    ): Promise<StudioCorpusImportResult>;
    /**
     * Record a thumbs-up/down feedback row (emits `feedback.recorded`; surfaces
     * in the agent's federated corpus when an utterance is supplied).
     */
    recordFeedback(
        repoRoot: string | undefined,
        input: FeedbackRecordInput,
    ): Promise<void>;
    /**
     * Replay an agent's corpus comparing two versions (read-only analysis — the
     * Impact Report contract). `request.agent` is required; the rows array is
     * bounded for transport while `summary` retains the full totals.
     */
    replayCorpus(
        repoRoot: string | undefined,
        request: StudioReplayRequest,
    ): Promise<StudioReplayResult>;
    /**
     * Recompute a single utterance's resolution trace from a stored run
     * descriptor (the drill-in "replay this trace" path).
     */
    replayResolutionTrace(
        repoRoot: string | undefined,
        request: ReplayResolutionTraceRequest,
    ): Promise<ReplayResolutionTraceResult>;
    /**
     * Start pushing live `studioEvent` calls to *this* connection for the given
     * repo. Idempotent per connection: a second call replaces the connection's
     * single subscription (it never stacks duplicate listeners). The
     * subscription is released when the connection closes or via
     * {@link unsubscribeEvents}.
     */
    subscribeEvents(repoRoot?: string): Promise<void>;
    /**
     * Cancel this connection's live event subscription, if any. Idempotent — a
     * no-op when not subscribed.
     */
    unsubscribeEvents(): Promise<void>;

    // --- Sandbox lifecycle (mutating; the channel is capability-token gated and
    // the extension client represents a human action, so no per-call approval —
    // the AI/MCP action surface is where the dryRun/approval boundary lives). ---

    /** Sandboxes currently running in the agent runtime. */
    listSandboxes(repoRoot?: string): Promise<SandboxStatus[]>;
    /** Agents available to load (name + manifest emoji), discovered from disk. */
    listAvailableAgents(repoRoot?: string): Promise<AvailableAgent[]>;
    startSandbox(
        repoRoot: string | undefined,
        options?: { id?: string; agents?: string[] },
    ): Promise<SandboxStatus>;
    stopSandbox(repoRoot: string | undefined, id: string): Promise<void>;
    restartSandbox(repoRoot: string | undefined, id: string): Promise<void>;
    loadSandboxAgent(
        repoRoot: string | undefined,
        id: string,
        agentRef: string,
    ): Promise<SandboxStatus>;
    unloadSandboxAgent(
        repoRoot: string | undefined,
        id: string,
        agentName: string,
    ): Promise<SandboxStatus>;
    /** Re-load a named agent everywhere it's loaded; returns sandboxes touched. */
    refreshSandboxAgent(
        repoRoot: string | undefined,
        agentName: string,
    ): Promise<number>;
    /** Re-create sandboxes from the agent runtime's persisted snapshot. */
    restoreSandboxes(repoRoot?: string): Promise<void>;

    // --- Onboarding / New Agent wizard (F1.x). Mutating: runs the onboarding
    // agent in the SERVICE process via the injected phaseRunner, so installs
    // land in the real service sandboxes (not a split-brain in-process copy).
    // Repo-scoped like the rest; the "active session" is per-workspace runtime
    // state, keyed by the last-started session. ---

    /** Start a New Agent onboarding session from a natural-language seed. */
    startOnboarding(
        repoRoot: string | undefined,
        seed: { description: string; agentName?: string },
    ): Promise<OnboardingState>;
    /** Snapshot the active (last-started) onboarding session. */
    getActiveOnboardingSession(repoRoot?: string): Promise<OnboardingState>;
    /** Forget the active onboarding session pointer (does not delete artifacts). */
    clearActiveOnboardingSession(repoRoot?: string): Promise<void>;
    /** The canonical ordered phase list the wizard renders as tabs. */
    listPhases(repoRoot?: string): Promise<readonly OnboardingPhaseName[]>;
    /** Default inputs the wizard pre-fills for a phase's form. */
    getDefaultInputsForPhaseOnActiveSession(
        repoRoot: string | undefined,
        phase: OnboardingPhaseName,
    ): Promise<unknown>;
    /** Run a single phase (with optional overridden inputs); returns new state. */
    runPhaseOnActiveSession(
        repoRoot: string | undefined,
        phase: OnboardingPhaseName,
        inputs?: unknown,
    ): Promise<OnboardingState>;
    /** Status badge for one phase (pending/running/complete/stale). */
    getPhaseStatusOnActiveSession(
        repoRoot: string | undefined,
        phase: OnboardingPhaseName,
    ): Promise<PhaseStatus>;
    /** Phases marked stale because an upstream phase re-ran (F1.5). */
    listStalePhasesOnActiveSession(
        repoRoot?: string,
    ): Promise<OnboardingPhaseName[]>;
    /** Run every not-yet-complete phase in order; returns the phases run. */
    runRemainingPhasesOnActiveSession(repoRoot?: string): Promise<{
        state: OnboardingState;
        completedPhases: OnboardingPhaseName[];
    }>;
    /** Force-rerun the given phases in order (F1.5 reconciliation). */
    rerunPhasesOnActiveSession(
        repoRoot: string | undefined,
        phases: OnboardingPhaseName[],
    ): Promise<{
        state: OnboardingState;
        rerunPhases: OnboardingPhaseName[];
    }>;
    /** Restore a phase's prior outputs and report the stale downstream (F1.5). */
    restorePhaseOnActiveSession(
        repoRoot: string | undefined,
        phase: OnboardingPhaseName,
    ): Promise<RestorePhaseResult>;
    /** Resolve the install artifact (scaffolded dir/package) for the session. */
    resolveInstallArtifactPathForActiveSession(
        repoRoot?: string,
    ): Promise<string>;
    /** Evaluate the packaging health gate for the active session (F1.4). */
    evaluatePackagingHealthGateForActiveSession(
        repoRoot?: string,
    ): Promise<PackagingHealthGateResult>;
    /** Evaluate + throw on a failing gate (the install-blocking variant). */
    enforcePackagingHealthGateForActiveSession(
        repoRoot?: string,
    ): Promise<PackagingHealthGateResult>;
    /** Evaluate the packaging health gate for an explicit artifact path. */
    checkPackagingHealthGate(
        repoRoot: string | undefined,
        artifactPath: string,
    ): Promise<PackagingHealthGateResult>;
    /** Install the active session's agent into a sandbox (F1.3). */
    installLastSessionToSandbox(
        repoRoot: string | undefined,
        sandboxId?: string,
        options?: { skipHealthGate?: boolean },
    ): Promise<{ sessionId: string; artifactPath: string }>;
    /** Install a specific artifact into a sandbox (F1.3). */
    installArtifactToSandbox(
        repoRoot: string | undefined,
        artifactPath: string,
        sandboxId?: string,
    ): Promise<{ sessionId: string; artifactPath: string }>;
    /** Route a conversational prompt to onboarding vs. schema author (F1.2). */
    routeConversation(
        repoRoot: string | undefined,
        prompt: string,
    ): Promise<{ target: "onboarding" | "schemaAuthor"; reason: string }>;
    /** Prove the active session's generated agent answers an utterance (t4). */
    proveActiveSessionUtterance(
        repoRoot: string | undefined,
        options?: ProveUtteranceOptions,
    ): Promise<UtteranceProofResult>;
};

/** Server → client pushes. */
export type StudioClientCallFunctions = {
    /** A live structured Studio event (reuses the core event union). */
    studioEvent(event: StudioEvent): void;
};
