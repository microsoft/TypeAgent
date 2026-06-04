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
import {
    InMemorySandboxManager,
    type SandboxManager,
} from "@typeagent/core/sandbox";
import { getDefaultPhaseInputs } from "./onboardingPresentation.js";

const LAST_ONBOARDING_SESSION_KEY = "studio.lastOnboardingSessionId";
const DEFAULT_SANDBOX_ID = "studio-default";

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
    checkPackagingHealthGate(artifactPath: string): Promise<PackagingHealthGateResult>;
    listPhases(): readonly OnboardingPhaseName[];
    routeConversation(prompt: string): {
        target: "onboarding" | "schemaAuthor";
        reason: string;
    };
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
    evaluatePackagingHealthGate?: (
        artifactPath: string,
    ) => Promise<PackagingHealthGateResult>;
}

export function createStudioRuntimeCore(
    context: StudioRuntimeContext,
    options: CreateStudioRuntimeOptions = {},
): StudioRuntime {
    const events = new InProcessEventStream();
    const sandbox =
        options.sandbox ?? new InMemorySandboxManager({ emitter: events });
    const onboarding = options.onboarding ?? new InMemoryOnboardingBridge();
    const evaluatePackagingHealthGate =
        options.evaluatePackagingHealthGate ?? defaultEvaluatePackagingHealthGate;

    const profileDir = path.join(
        context.globalStorageFsPath,
        "profiles",
        DEFAULT_SANDBOX_ID,
    );

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
                throw new Error(`Artifact path does not exist: ${artifactPath}`);
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
            return resolveArtifactPathForSession(onboarding, sessionId, context);
        },
        async evaluatePackagingHealthGateForActiveSession() {
            const artifactPath = await this.resolveInstallArtifactPathForActiveSession();
            return evaluatePackagingHealthGate(artifactPath);
        },
        async enforcePackagingHealthGateForActiveSession() {
            const gate = await this.evaluatePackagingHealthGateForActiveSession();
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

            for (const phase of phases) {
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
        push(path.join(root, "packages", "agents", state.agentName.toLowerCase()));
        push(path.join(root, "packages", "agents", stripAgentSuffix(state.agentName)));
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

async function resolveCandidatePath(candidate: string): Promise<string | undefined> {
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
