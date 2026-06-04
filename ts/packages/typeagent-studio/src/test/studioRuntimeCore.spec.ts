// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { InMemoryOnboardingBridge } from "@typeagent/core/onboardingBridge";
import type { HealthFinding } from "@typeagent/core/health";
import type {
    SandboxConfig,
    SandboxHandle,
    SandboxManager,
    SandboxStatus,
} from "@typeagent/core/sandbox";
import { createStudioRuntimeCore } from "../studioRuntimeCore.js";

function createContext(workspaceFolderFsPaths: string[] = []) {
    const store = new Map<string, unknown>();
    return {
        context: {
            globalStorageFsPath: "C:/tmp/typeagent-studio-tests",
            workspaceFolderFsPaths,
            workspaceState: {
                get<T>(key: string): T | undefined {
                    return store.get(key) as T | undefined;
                },
                async update(key: string, value: unknown): Promise<void> {
                    store.set(key, value);
                },
            },
        },
        store,
    };
}

class RecordingSandboxManager implements SandboxManager {
    private readonly running = new Map<string, SandboxStatus>();
    readonly loaded: { sandboxId: string; agentRef: string }[] = [];

    async start(cfg: SandboxConfig): Promise<SandboxHandle> {
        this.running.set(cfg.id, {
            id: cfg.id,
            mode: cfg.mode,
            state: "running",
            agents: [],
        });
        return { id: cfg.id, mode: cfg.mode };
    }

    async restart(_id: string): Promise<void> {}

    async stop(id: string): Promise<void> {
        this.running.delete(id);
    }

    async loadAgent(id: string, agentRef: string): Promise<void> {
        this.loaded.push({ sandboxId: id, agentRef });
    }

    async unloadAgent(_id: string, _agentName: string): Promise<void> {}

    async status(id: string): Promise<SandboxStatus> {
        const status = this.running.get(id);
        if (!status) {
            throw new Error("sandbox missing");
        }
        return status;
    }

    async list(): Promise<SandboxStatus[]> {
        return [...this.running.values()];
    }
}

test("runRemainingPhasesOnActiveSession completes pipeline in order", async () => {
    let now = 100;
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context, {
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-ordered",
            now: () => ++now,
        }),
    });

    await runtime.startOnboarding({
        description: "Calendar integration for internal scheduling API",
    });

    const result = await runtime.runRemainingPhasesOnActiveSession();

    assert.deepEqual(result.completedPhases, runtime.listPhases());
    assert.equal(result.state.currentPhase, "Packaging");
    for (const phase of runtime.listPhases()) {
        assert.equal(result.state.phases[phase]?.status, "complete");
    }
    assert.deepEqual(await runtime.getPhaseStatusOnActiveSession("Testing"), "complete");
});

test("restorePhaseOnActiveSession marks downstream phases stale after ancestor rerun", async () => {
    let now = 200;
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context, {
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-stale",
            now: () => ++now,
        }),
    });

    await runtime.startOnboarding({
        description: "CRM intake workflow agent",
    });
    await runtime.runRemainingPhasesOnActiveSession();
    await runtime.runPhaseOnActiveSession("Discovery", {
        description: "CRM intake workflow agent v2",
    });

    const restored = await runtime.restorePhaseOnActiveSession("Discovery");

    assert.equal(restored.reconciliationRequired, true);
    assert.deepEqual(restored.affectedDownstream, [
        "PhraseGen",
        "SchemaGen",
        "GrammarGen",
        "Scaffolder",
        "Testing",
        "Packaging",
    ]);
    assert.equal(restored.state.currentPhase, "Discovery");
    assert.equal(restored.state.phases.PhraseGen?.status, "stale");
    assert.equal(restored.state.phases.Packaging?.status, "stale");
});

test("rerunPhasesOnActiveSession reruns selected stale phases in order", async () => {
    let now = 300;
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context, {
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-rerun",
            now: () => ++now,
        }),
    });

    await runtime.startOnboarding({
        description: "Ticket routing agent",
    });
    await runtime.runRemainingPhasesOnActiveSession();
    await runtime.runPhaseOnActiveSession("Discovery", {
        description: "Ticket routing agent v2",
    });
    const restored = await runtime.restorePhaseOnActiveSession("Discovery");
    assert.equal(restored.state.phases.PhraseGen?.status, "stale");
    assert.equal(restored.state.phases.SchemaGen?.status, "stale");

    const rerun = await runtime.rerunPhasesOnActiveSession([
        "PhraseGen",
        "SchemaGen",
    ]);

    assert.deepEqual(rerun.rerunPhases, ["PhraseGen", "SchemaGen"]);
    assert.equal(rerun.state.phases.PhraseGen?.status, "complete");
    assert.equal(rerun.state.phases.SchemaGen?.status, "complete");
});

test("listStalePhasesOnActiveSession returns stale phases in pipeline order", async () => {
    let now = 350;
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context, {
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-list-stale",
            now: () => ++now,
        }),
    });

    await runtime.startOnboarding({
        description: "Policy sync workflow",
    });
    await runtime.runRemainingPhasesOnActiveSession();
    await runtime.runPhaseOnActiveSession("Discovery", {
        description: "Policy sync workflow v2",
    });
    await runtime.restorePhaseOnActiveSession("Discovery");

    const stale = await runtime.listStalePhasesOnActiveSession();
    assert.deepEqual(stale, [
        "PhraseGen",
        "SchemaGen",
        "GrammarGen",
        "Scaffolder",
        "Testing",
        "Packaging",
    ]);
});

test("listStalePhasesOnActiveSession returns empty when no phase is stale", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context, {
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-list-stale-empty",
        }),
    });

    await runtime.startOnboarding({
        description: "No stale phases yet",
    });

    const stale = await runtime.listStalePhasesOnActiveSession();
    assert.deepEqual(stale, []);
});

test("installLastSessionToSandbox records sandbox assignment on active session", async () => {
    const workspaceRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "typeagent-studio-workspace-"),
    );
    const artifactPath = path.join(
        workspaceRoot,
        "packages",
        "agents",
        "finance-approvals",
    );
    await fs.mkdir(artifactPath, { recursive: true });

    const { context } = createContext([workspaceRoot]);
    const sandbox = new RecordingSandboxManager();
    const runtime = createStudioRuntimeCore(context, {
        sandbox,
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-install",
        }),
        evaluatePackagingHealthGate: async (candidatePath) => ({
            status: "pass",
            summary: "Health gate passed.",
            findings: [],
            artifactPath: candidatePath,
            checkedAgent: "finance-approvals",
        }),
    });

    await runtime.startOnboarding({
        description: "Finance approvals agent",
        agentName: "finance-approvals",
    });
    const installed = await runtime.installLastSessionToSandbox("sandbox-a");
    const state = await runtime.getActiveOnboardingSession();

    assert.equal(installed.sessionId, "session-install");
    assert.equal(installed.artifactPath, artifactPath);
    assert.deepEqual(sandbox.loaded, [
        { sandboxId: "sandbox-a", agentRef: artifactPath },
    ]);
    assert.deepEqual(state.installedSandboxIds, ["sandbox-a"]);
});

test("installLastSessionToSandbox uses packaging artifact output when provided", async () => {
    const artifactPath = await fs.mkdtemp(
        path.join(os.tmpdir(), "typeagent-studio-artifact-"),
    );
    const { context } = createContext();
    const sandbox = new RecordingSandboxManager();
    const runtime = createStudioRuntimeCore(context, {
        sandbox,
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-output-path",
            phaseRunner: async (_session, phase, _inputs) => {
                if (phase === "Packaging") {
                    return { artifactPath };
                }
                return { phase };
            },
        }),
    });

    await runtime.startOnboarding({
        description: "Service desk workflow agent",
        agentName: "service-desk",
    });
    await runtime.runPhaseOnActiveSession("Packaging", {});

    const installed = await runtime.installLastSessionToSandbox("sandbox-b");
    assert.equal(installed.artifactPath, artifactPath);
    assert.deepEqual(sandbox.loaded, [
        { sandboxId: "sandbox-b", agentRef: artifactPath },
    ]);
});

test("installArtifactToSandbox installs explicit local path", async () => {
    const artifactPath = await fs.mkdtemp(
        path.join(os.tmpdir(), "typeagent-studio-manual-"),
    );
    const { context } = createContext();
    const sandbox = new RecordingSandboxManager();
    const runtime = createStudioRuntimeCore(context, {
        sandbox,
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-manual",
        }),
    });

    await runtime.startOnboarding({
        description: "Manual install path",
        agentName: "manual-install",
    });

    const installed = await runtime.installArtifactToSandbox(
        artifactPath,
        "sandbox-c",
    );
    assert.equal(installed.artifactPath, artifactPath);
    assert.deepEqual(sandbox.loaded, [
        { sandboxId: "sandbox-c", agentRef: artifactPath },
    ]);
});

test("installLastSessionToSandbox enforces health gate failures", async () => {
    const workspaceRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "typeagent-studio-health-"),
    );
    const artifactPath = path.join(
        workspaceRoot,
        "packages",
        "agents",
        "health-gated",
    );
    await fs.mkdir(artifactPath, { recursive: true });

    const findings: HealthFinding[] = [
        {
            ruleId: "manifest.parses",
            severity: "error",
            agent: "health-gated",
            evidence: {
                message: "broken manifest",
            },
        },
    ];

    const { context } = createContext([workspaceRoot]);
    const sandbox = new RecordingSandboxManager();
    const runtime = createStudioRuntimeCore(context, {
        sandbox,
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-health",
        }),
        evaluatePackagingHealthGate: async (candidatePath) => ({
            status: "fail",
            summary: "1 error findings and 0 warning findings.",
            findings,
            artifactPath: candidatePath,
            checkedAgent: "health-gated",
        }),
    });

    await runtime.startOnboarding({
        description: "Health gate enforcement",
        agentName: "health-gated",
    });

    await assert.rejects(
        () => runtime.installLastSessionToSandbox("sandbox-health"),
        /Health gate failed:/,
    );
    assert.deepEqual(sandbox.loaded, []);

    const installed = await runtime.installLastSessionToSandbox(
        "sandbox-health",
        { skipHealthGate: true },
    );
    assert.equal(installed.artifactPath, artifactPath);
    assert.deepEqual(sandbox.loaded, [
        { sandboxId: "sandbox-health", agentRef: artifactPath },
    ]);
});

test("resolveInstallArtifactPathForActiveSession and checkPackagingHealthGate", async () => {
    const workspaceRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "typeagent-studio-health-check-"),
    );
    const artifactPath = path.join(
        workspaceRoot,
        "packages",
        "agents",
        "health-check",
    );
    await fs.mkdir(artifactPath, { recursive: true });

    const { context } = createContext([workspaceRoot]);
    const runtime = createStudioRuntimeCore(context, {
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-health-check",
        }),
        evaluatePackagingHealthGate: async (candidatePath) => ({
            status: "warn",
            summary: "1 warning findings for agent health-check.",
            findings: [
                {
                    ruleId: "schema.actions.haveGrammar",
                    severity: "warning",
                    agent: "health-check",
                    evidence: { message: "missing grammar" },
                },
            ],
            artifactPath: candidatePath,
            checkedAgent: "health-check",
        }),
    });

    await runtime.startOnboarding({
        description: "Health check command",
        agentName: "health-check",
    });

    const resolved = await runtime.resolveInstallArtifactPathForActiveSession();
    assert.equal(resolved, artifactPath);

    const gate = await runtime.checkPackagingHealthGate(resolved);
    assert.equal(gate.status, "warn");
    assert.equal(gate.findings.length, 1);

    const activeGate = await runtime.evaluatePackagingHealthGateForActiveSession();
    assert.equal(activeGate.status, "warn");
    assert.equal(activeGate.findings.length, 1);
});

test("enforcePackagingHealthGateForActiveSession throws on fail", async () => {
    const workspaceRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "typeagent-studio-health-enforce-"),
    );
    const artifactPath = path.join(
        workspaceRoot,
        "packages",
        "agents",
        "health-enforce",
    );
    await fs.mkdir(artifactPath, { recursive: true });

    const { context } = createContext([workspaceRoot]);
    const runtime = createStudioRuntimeCore(context, {
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-health-enforce",
        }),
        evaluatePackagingHealthGate: async (candidatePath) => ({
            status: "fail",
            summary: "2 error findings and 0 warning findings.",
            findings: [
                {
                    ruleId: "manifest.parses",
                    severity: "error",
                    agent: "health-enforce",
                    evidence: { message: "invalid manifest" },
                },
            ],
            artifactPath: candidatePath,
            checkedAgent: "health-enforce",
        }),
    });

    await runtime.startOnboarding({
        description: "Health enforcement command",
        agentName: "health-enforce",
    });

    await assert.rejects(
        () => runtime.enforcePackagingHealthGateForActiveSession(),
        /Health gate failed:/,
    );
});

test("clearActiveOnboardingSession removes the current session binding", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context, {
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-clear",
        }),
    });

    await runtime.startOnboarding({
        description: "Legal review workflow agent",
    });
    await runtime.clearActiveOnboardingSession();

    await assert.rejects(
        () => runtime.getActiveOnboardingSession(),
        /No onboarding session found/,
    );
});
