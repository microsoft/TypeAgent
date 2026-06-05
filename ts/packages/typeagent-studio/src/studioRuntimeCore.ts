// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
    InMemoryOnboardingBridge,
    ONBOARDING_PHASE_ORDER,
    type OnboardingPhaseName,
    type PhaseStatus,
    type OnboardingState,
    type RestorePhaseResult,
    routeStudioConversation,
} from "@typeagent/core/onboardingBridge";
import { FileHealthService, type HealthFinding } from "@typeagent/core/health";
import { InProcessEventStream } from "@typeagent/core/events";
import type { StudioEvent, StudioEventType } from "@typeagent/core/events";
import {
    createRepoAgentLoader,
    InMemorySandboxManager,
    type SandboxManager,
    type SandboxStatus,
} from "@typeagent/core/sandbox";
import {
    FileCorpusService,
    type CorpusEntry,
    type CorpusFilter,
    type CorpusService,
} from "@typeagent/core/corpus";
import {
    CoreFeedbackService,
    InMemoryFeedbackBackend,
    type FeedbackCorpusProjector,
    type FeedbackFilter,
    type FeedbackRecordInput,
    type FeedbackRow,
    type FeedbackService,
} from "@typeagent/core/feedback";
import {
    replayCorpus,
    type ActionDelta,
    type ReplayActionResolver,
    type ReplayAgentResolution,
    type ReplayMissPolicy,
    type ReplaySummary,
    type VersionSpec,
} from "@typeagent/core/replay";
import { getDefaultPhaseInputs } from "./onboardingPresentation.js";

const LAST_ONBOARDING_SESSION_KEY = "studio.lastOnboardingSessionId";
const DEFAULT_SANDBOX_ID = "studio-default";

const SANDBOX_LIFECYCLE_EVENT_TYPES: StudioEventType[] = [
    "sandbox.start",
    "sandbox.stop",
    "sandbox.restart",
    "sandbox.agent.loaded",
    "sandbox.agent.unloaded",
];

export type PackagingHealthGateStatus =
    | "pass"
    | "warn"
    | "fail"
    | "unavailable";

export interface PackagingHealthGateResult {
    status: PackagingHealthGateStatus;
    summary: string;
    findings: HealthFinding[];
    artifactPath: string;
    checkedAgent?: string;
}

/** Request shape for {@link StudioRuntime.replayCorpus}. Versions and miss
 *  policy default to a deterministic working-tree self-compare. */
export interface StudioReplayRequest {
    agent: string;
    corpus?: CorpusFilter;
    versionA?: VersionSpec;
    versionB?: VersionSpec;
    missPolicy?: ReplayMissPolicy;
}

export interface StudioReplayResult {
    runId: string;
    summary: ReplaySummary;
    rows: ActionDelta[];
}

export interface StudioRuntime {
    startOnboarding(seed: {
        description: string;
        agentName?: string;
    }): Promise<OnboardingState>;
    installLastSessionToSandbox(
        sandboxId?: string,
        options?: { skipHealthGate?: boolean },
    ): Promise<{
        sessionId: string;
        artifactPath: string;
    }>;
    installArtifactToSandbox(
        artifactPath: string,
        sandboxId?: string,
    ): Promise<{
        sessionId: string;
        artifactPath: string;
    }>;
    resolveInstallArtifactPathForActiveSession(): Promise<string>;
    evaluatePackagingHealthGateForActiveSession(): Promise<PackagingHealthGateResult>;
    enforcePackagingHealthGateForActiveSession(): Promise<PackagingHealthGateResult>;
    clearActiveOnboardingSession(): Promise<void>;
    getActiveOnboardingSession(): Promise<OnboardingState>;
    runPhaseOnActiveSession(
        phase: OnboardingPhaseName,
        inputs?: unknown,
    ): Promise<OnboardingState>;
    getDefaultInputsForPhaseOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<unknown>;
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
    checkPackagingHealthGate(
        artifactPath: string,
    ): Promise<PackagingHealthGateResult>;
    listPhases(): readonly OnboardingPhaseName[];
    routeConversation(prompt: string): {
        target: "onboarding" | "schemaAuthor";
        reason: string;
    };
    listSandboxes(): Promise<SandboxStatus[]>;
    startSandbox(options?: {
        id?: string;
        agents?: string[];
    }): Promise<SandboxStatus>;
    stopSandbox(id: string): Promise<void>;
    restartSandbox(id: string): Promise<void>;
    /**
     * Load an agent into a running sandbox. `agentRef` is a path or module
     * reference; the loader derives the agent name. Returns the updated status.
     */
    loadSandboxAgent(id: string, agentRef: string): Promise<SandboxStatus>;
    /** Unload a named agent from a sandbox. Returns the updated status. */
    unloadSandboxAgent(id: string, agentName: string): Promise<SandboxStatus>;
    /**
     * Subscribe to sandbox lifecycle changes (start/stop/restart, agent
     * load/unload). The listener is invoked after each such event so a UI can
     * refresh. Returns a disposable to stop listening.
     */
    onSandboxChanged(listener: () => void): { dispose(): void };
    /**
     * Agents that currently have a federated corpus view, derived from the
     * union of agents loaded across running sandboxes.
     */
    listCorpusAgents(): Promise<string[]>;
    /** Federated corpus entries for an agent (in-repo, captures, external, feedback). */
    listCorpusEntries(agent: string): Promise<CorpusEntry[]>;
    /** Most recent events from the structured event stream, oldest-first. */
    queryRecentEvents(limit?: number): Promise<StudioEvent[]>;
    /** Subscribe to every event as it is emitted. Returns a disposable. */
    onAnyEvent(listener: (event: StudioEvent) => void): { dispose(): void };
    /**
     * Record a thumbs-up/down feedback row. Emits a `feedback.recorded` event
     * and (when an utterance is supplied) surfaces the row in the agent's
     * federated corpus under the `feedback` source.
     */
    recordFeedback(input: FeedbackRecordInput): Promise<void>;
    /** List recorded feedback rows, optionally filtered. */
    listFeedback(filter?: FeedbackFilter): Promise<FeedbackRow[]>;
    /**
     * Replay an agent's corpus through the F4.1 compare engine, evaluating each
     * utterance against versions A and B. Emits `replay.row`/`replay.summary`
     * events (visible in the Event Log) and resolves with the collected rows
     * and summary.
     */
    replayCorpus(request: StudioReplayRequest): Promise<StudioReplayResult>;
}

export interface StudioWorkspaceState {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Promise<void>;
}

export interface StudioRuntimeContext {
    workspaceState: StudioWorkspaceState;
    globalStorageFsPath: string;
    workspaceFolderFsPaths?: string[];
}

export interface CreateStudioRuntimeOptions {
    onboarding?: InMemoryOnboardingBridge;
    sandbox?: SandboxManager;
    corpus?: CorpusService;
    feedback?: FeedbackService & FeedbackCorpusProjector;
    /**
     * Resolver that evaluates one utterance against one agent version. Injected
     * so a real per-version build/dispatch can replace the default, which does a
     * deterministic identity replay over each entry's captured `expectedAction`.
     */
    replayResolver?: ReplayActionResolver;
    evaluatePackagingHealthGate?: (
        artifactPath: string,
    ) => Promise<PackagingHealthGateResult>;
}

/** Deterministic default resolver: surfaces each entry's captured
 *  `expectedAction` (and feedback) identically for both versions, so an
 *  un-parameterized replay reports an all-equal baseline. */
const identityReplayResolver: ReplayActionResolver = {
    resolve(entry): ReplayAgentResolution {
        if (entry.expectedAction !== undefined) {
            return {
                action: entry.expectedAction,
                cacheState: "hit",
                ...(entry.feedback !== undefined
                    ? { feedback: entry.feedback }
                    : {}),
            };
        }
        return {
            cacheState: "needs-explanation",
            ...(entry.feedback !== undefined
                ? { feedback: entry.feedback }
                : {}),
        };
    },
};

export function createStudioRuntimeCore(
    context: StudioRuntimeContext,
    options: CreateStudioRuntimeOptions = {},
): StudioRuntime {
    const events = new InProcessEventStream();
    const repoRoot =
        context.workspaceFolderFsPaths?.[0] ?? context.globalStorageFsPath;
    const sandbox =
        options.sandbox ??
        new InMemorySandboxManager({
            emitter: events,
            agentLoader: createRepoAgentLoader({ repoRoot }),
        });
    const onboarding = options.onboarding ?? new InMemoryOnboardingBridge();
    const evaluatePackagingHealthGate =
        options.evaluatePackagingHealthGate ??
        defaultEvaluatePackagingHealthGate;

    const profileDir = path.join(
        context.globalStorageFsPath,
        "profiles",
        DEFAULT_SANDBOX_ID,
    );

    const feedback =
        options.feedback ??
        new CoreFeedbackService({
            backend: new InMemoryFeedbackBackend(),
            emitter: events,
        });

    const corpus =
        options.corpus ??
        new FileCorpusService({
            repoRoot,
            profileDir: path.join(context.globalStorageFsPath, "corpus"),
            feedbackProvider: (agent) => feedback.toCorpusEntries(agent),
        });

    return {
        async startOnboarding(seed) {
            const state = await onboarding.start(seed);
            await context.workspaceState.update(
                LAST_ONBOARDING_SESSION_KEY,
                state.sessionId,
            );
            return state;
        },
        async installLastSessionToSandbox(
            sandboxId = DEFAULT_SANDBOX_ID,
            installOptions = {},
        ) {
            const sessionId = getRequiredSessionId(context);
            const artifactPath = await resolveArtifactPathForSession(
                onboarding,
                sessionId,
                context,
            );

            if (!installOptions.skipHealthGate) {
                const gate = await evaluatePackagingHealthGate(artifactPath);
                if (gate.status === "fail") {
                    throw new Error(`Health gate failed: ${gate.summary}`);
                }
            }

            return installResolvedArtifact(
                sandbox,
                onboarding,
                sessionId,
                sandboxId,
                profileDir,
                artifactPath,
            );
        },
        async installArtifactToSandbox(
            artifactPath,
            sandboxId = DEFAULT_SANDBOX_ID,
        ) {
            const sessionId = getRequiredSessionId(context);
            if (!(await pathExists(artifactPath))) {
                throw new Error(
                    `Artifact path does not exist: ${artifactPath}`,
                );
            }

            return installResolvedArtifact(
                sandbox,
                onboarding,
                sessionId,
                sandboxId,
                profileDir,
                artifactPath,
            );
        },
        async resolveInstallArtifactPathForActiveSession() {
            const sessionId = getRequiredSessionId(context);
            return resolveArtifactPathForSession(
                onboarding,
                sessionId,
                context,
            );
        },
        async evaluatePackagingHealthGateForActiveSession() {
            const artifactPath =
                await this.resolveInstallArtifactPathForActiveSession();
            return evaluatePackagingHealthGate(artifactPath);
        },
        async enforcePackagingHealthGateForActiveSession() {
            const gate =
                await this.evaluatePackagingHealthGateForActiveSession();
            if (gate.status === "fail") {
                throw new Error(`Health gate failed: ${gate.summary}`);
            }
            return gate;
        },
        async clearActiveOnboardingSession() {
            await context.workspaceState.update(
                LAST_ONBOARDING_SESSION_KEY,
                undefined,
            );
        },
        async getActiveOnboardingSession() {
            const sessionId = getRequiredSessionId(context);
            return onboarding.snapshot(sessionId);
        },
        async runPhaseOnActiveSession(phase, inputs = {}) {
            const sessionId = getRequiredSessionId(context);
            await onboarding.runPhase(sessionId, phase, inputs);
            return onboarding.snapshot(sessionId);
        },
        async getDefaultInputsForPhaseOnActiveSession(phase) {
            const sessionId = getRequiredSessionId(context);
            const state = await onboarding.snapshot(sessionId);
            return getDefaultPhaseInputs(state, phase);
        },
        async getPhaseStatusOnActiveSession(phase) {
            const sessionId = getRequiredSessionId(context);
            const state = await onboarding.snapshot(sessionId);
            return state.phases[phase]?.status ?? "pending";
        },
        async listStalePhasesOnActiveSession() {
            const sessionId = getRequiredSessionId(context);
            const state = await onboarding.snapshot(sessionId);
            return ONBOARDING_PHASE_ORDER.filter(
                (phase) => state.phases[phase]?.status === "stale",
            );
        },
        async runRemainingPhasesOnActiveSession() {
            const sessionId = getRequiredSessionId(context);
            let state = await onboarding.snapshot(sessionId);
            const completedPhases: OnboardingPhaseName[] = [];

            for (const phase of ONBOARDING_PHASE_ORDER) {
                const existing = state.phases[phase];
                if (existing?.status === "complete") {
                    continue;
                }

                await onboarding.runPhase(
                    sessionId,
                    phase,
                    getDefaultPhaseInputs(state, phase),
                );
                completedPhases.push(phase);
                state = await onboarding.snapshot(sessionId);
            }

            return {
                state,
                completedPhases,
            };
        },
        async rerunPhasesOnActiveSession(phases) {
            const sessionId = getRequiredSessionId(context);
            let state = await onboarding.snapshot(sessionId);
            const rerunPhases: OnboardingPhaseName[] = [];
            const normalizedPhases = ONBOARDING_PHASE_ORDER.filter((phase) =>
                phases.includes(phase),
            );

            for (const phase of normalizedPhases) {
                await onboarding.runPhase(
                    sessionId,
                    phase,
                    getDefaultPhaseInputs(state, phase),
                );
                rerunPhases.push(phase);
                state = await onboarding.snapshot(sessionId);
            }

            return {
                state,
                rerunPhases,
            };
        },
        async restorePhaseOnActiveSession(phase) {
            const sessionId = getRequiredSessionId(context);
            return onboarding.restorePhase(sessionId, phase);
        },
        async checkPackagingHealthGate(artifactPath) {
            return evaluatePackagingHealthGate(artifactPath);
        },
        listPhases() {
            return ONBOARDING_PHASE_ORDER;
        },
        routeConversation(prompt) {
            const routed = routeStudioConversation(prompt);
            return {
                target: routed.target,
                reason: routed.reason,
            };
        },
        async listSandboxes() {
            return sandbox.list();
        },
        async startSandbox(startOptions = {}) {
            const id = startOptions.id ?? DEFAULT_SANDBOX_ID;
            await sandbox.start({
                id,
                mode: "inmemory",
                profileDir: path.join(
                    context.globalStorageFsPath,
                    "profiles",
                    id,
                ),
                agents: startOptions.agents ?? [],
            });
            return sandbox.status(id);
        },
        async stopSandbox(id) {
            await sandbox.stop(id);
        },
        async restartSandbox(id) {
            await sandbox.restart(id);
        },
        async loadSandboxAgent(id, agentRef) {
            await sandbox.loadAgent(id, agentRef);
            return sandbox.status(id);
        },
        async unloadSandboxAgent(id, agentName) {
            await sandbox.unloadAgent(id, agentName);
            return sandbox.status(id);
        },
        onSandboxChanged(listener) {
            const subscription = events.subscribe(() => listener(), {
                filter: { types: SANDBOX_LIFECYCLE_EVENT_TYPES },
            });
            return { dispose: () => subscription.unsubscribe() };
        },
        async listCorpusAgents() {
            const sandboxes = await sandbox.list();
            const agents = new Set<string>();
            for (const status of sandboxes) {
                for (const agent of status.agents) {
                    agents.add(agent.name);
                }
            }
            return [...agents].sort((a, b) => a.localeCompare(b));
        },
        async listCorpusEntries(agent) {
            return corpus.list(agent);
        },
        async queryRecentEvents(limit = 200) {
            const all: StudioEvent[] = [];
            for await (const event of events.query()) {
                all.push(event);
            }
            return all.slice(-limit);
        },
        onAnyEvent(listener) {
            const subscription = events.subscribe(listener);
            return { dispose: () => subscription.unsubscribe() };
        },
        async recordFeedback(input) {
            await feedback.record(input);
        },
        async listFeedback(filter) {
            return feedback.list(filter);
        },
        async replayCorpus(request) {
            const replayOptions = {
                agent: request.agent,
                corpus: request.corpus ?? {},
                versionA: request.versionA ?? { kind: "workingTree" },
                versionB: request.versionB ?? { kind: "workingTree" },
                missPolicy: request.missPolicy ?? "needs-explanation",
            } satisfies Parameters<typeof replayCorpus>[0];

            const handle = replayCorpus(replayOptions, {
                corpus: { list: (agent, filter) => corpus.list(agent, filter) },
                resolver: options.replayResolver ?? identityReplayResolver,
                emitter: events,
            });

            const rows: ActionDelta[] = [];
            for await (const row of handle.rows) {
                rows.push(row);
            }
            const summary = await handle.summary;
            return { runId: handle.runId, summary, rows };
        },
    };
}

async function resolveArtifactPathForSession(
    onboarding: InMemoryOnboardingBridge,
    sessionId: string,
    context: StudioRuntimeContext,
): Promise<string> {
    const session = await onboarding.snapshot(sessionId);
    return resolveLocalArtifactPath(session, context);
}

async function defaultEvaluatePackagingHealthGate(
    artifactPath: string,
): Promise<PackagingHealthGateResult> {
    const resolved = path.resolve(artifactPath);
    const inferred = inferRepoRootAndAgent(resolved);
    if (!inferred) {
        return {
            status: "unavailable",
            summary:
                "Could not infer repo root + agent from artifact path; health gate check skipped.",
            findings: [],
            artifactPath: resolved,
        };
    }

    const service = new FileHealthService({ repoRoot: inferred.repoRoot });
    const findings = await service.check(inferred.agent);
    const errors = findings.filter((f) => f.severity === "error").length;
    const warnings = findings.filter((f) => f.severity === "warning").length;

    if (errors > 0) {
        return {
            status: "fail",
            summary: `${errors} error findings and ${warnings} warning findings for agent ${inferred.agent}.`,
            findings,
            artifactPath: resolved,
            checkedAgent: inferred.agent,
        };
    }
    if (warnings > 0) {
        return {
            status: "warn",
            summary: `${warnings} warning findings for agent ${inferred.agent}.`,
            findings,
            artifactPath: resolved,
            checkedAgent: inferred.agent,
        };
    }

    return {
        status: "pass",
        summary: `Health gate passed for agent ${inferred.agent}.`,
        findings,
        artifactPath: resolved,
        checkedAgent: inferred.agent,
    };
}

function inferRepoRootAndAgent(
    artifactPath: string,
): { repoRoot: string; agent: string } | undefined {
    const normalized = path.normalize(artifactPath);
    const parts = normalized.split(path.sep);
    const packagesIndex = parts.lastIndexOf("packages");
    if (packagesIndex < 0 || parts[packagesIndex + 1] !== "agents") {
        return undefined;
    }
    const agent = parts[packagesIndex + 2];
    if (!agent) {
        return undefined;
    }
    const repoRoot = parts.slice(0, packagesIndex).join(path.sep) || path.sep;
    return { repoRoot, agent };
}

async function installResolvedArtifact(
    sandbox: SandboxManager,
    onboarding: InMemoryOnboardingBridge,
    sessionId: string,
    sandboxId: string,
    profileDir: string,
    artifactPath: string,
): Promise<{ sessionId: string; artifactPath: string }> {
    try {
        await sandbox.status(sandboxId);
    } catch {
        await sandbox.start({
            id: sandboxId,
            mode: "inmemory",
            profileDir,
            agents: [],
        });
    }

    await sandbox.loadAgent(sandboxId, artifactPath);
    await onboarding.installToSandbox(sessionId, sandboxId);
    return { sessionId, artifactPath };
}
const ONBOARDING_WORKSPACE_ROOT = path.join(
    os.homedir(),
    ".typeagent",
    "onboarding",
);

async function resolveLocalArtifactPath(
    state: OnboardingState,
    context: StudioRuntimeContext,
): Promise<string> {
    const candidates = collectArtifactCandidates(state, context);
    for (const candidate of candidates) {
        const resolved = await resolveCandidatePath(candidate);
        if (resolved && (await pathExists(resolved))) {
            return resolved;
        }
    }

    throw new Error(
        `No local generated agent artifact found for ${state.agentName}. Checked ${candidates.length} candidate paths.`,
    );
}

function collectArtifactCandidates(
    state: OnboardingState,
    context: StudioRuntimeContext,
): string[] {
    const out: string[] = [];
    const push = (value: string | undefined) => {
        const trimmed = value?.trim();
        if (trimmed) {
            out.push(trimmed);
        }
    };

    for (const phase of ["Packaging", "Scaffolder"] as const) {
        const outputs = state.phases[phase]?.outputs;
        if (outputs && typeof outputs === "object") {
            const obj = outputs as Record<string, unknown>;
            for (const key of [
                "artifactPath",
                "agentPath",
                "agentDir",
                "outputDir",
                "scaffoldedTo",
                "targetDir",
            ]) {
                const raw = obj[key];
                if (typeof raw === "string") {
                    push(raw);
                }
            }
        }
    }

    const onboardingScaffoldRecord = path.join(
        ONBOARDING_WORKSPACE_ROOT,
        state.agentName,
        "scaffolder",
        "scaffolded-to.txt",
    );
    push(onboardingScaffoldRecord);

    for (const root of context.workspaceFolderFsPaths ?? []) {
        push(path.join(root, "packages", "agents", state.agentName));
        push(
            path.join(
                root,
                "packages",
                "agents",
                state.agentName.toLowerCase(),
            ),
        );
        push(
            path.join(
                root,
                "packages",
                "agents",
                stripAgentSuffix(state.agentName),
            ),
        );
    }

    return dedupe(out);
}

function stripAgentSuffix(agentName: string): string {
    return agentName.endsWith("-agent")
        ? agentName.slice(0, -"-agent".length)
        : agentName;
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.stat(filePath);
        return true;
    } catch {
        return false;
    }
}

async function resolveCandidatePath(
    candidate: string,
): Promise<string | undefined> {
    if (candidate.endsWith("scaffolded-to.txt")) {
        try {
            const txt = (await fs.readFile(candidate, "utf-8")).trim();
            return txt || undefined;
        } catch {
            return undefined;
        }
    }
    return candidate;
}

function dedupe(values: string[]): string[] {
    return [...new Set(values.map((v) => path.normalize(v)))];
}

function getRequiredSessionId(context: StudioRuntimeContext): string {
    const sessionId = context.workspaceState.get<string>(
        LAST_ONBOARDING_SESSION_KEY,
    );
    if (!sessionId) {
        throw new Error(
            "No onboarding session found. Start one first with 'TypeAgent Studio: Start onboarding session'.",
        );
    }
    return sessionId;
}
