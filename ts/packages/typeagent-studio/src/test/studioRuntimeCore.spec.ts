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
import type {
    CorpusEntry,
    CorpusFilter,
    CorpusService,
} from "@typeagent/core/corpus";
import type { ReplayActionResolver } from "@typeagent/core/replay";
import type { CollisionDetectedEvent } from "@typeagent/core/events";
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

test("persists sandbox set across runtime instances and replays it on restore", async () => {
    const { context, store } = createContext();

    // The base RecordingSandboxManager doesn't propagate cfg.agents into
    // status, so we extend it to mirror the real manager's semantics: agents
    // listed in cfg or added via loadAgent show up in status.agents.
    class CapturingSandboxManager extends RecordingSandboxManager {
        readonly started: SandboxConfig[] = [];
        async start(cfg: SandboxConfig): Promise<SandboxHandle> {
            this.started.push(cfg);
            const handle = await super.start(cfg);
            for (const ref of cfg.agents) {
                await this.loadAgent(cfg.id, ref);
            }
            return handle;
        }
        async loadAgent(id: string, agentRef: string): Promise<void> {
            await super.loadAgent(id, agentRef);
            const status = await super.status(id);
            status.agents.push({
                name: agentRef,
                sourcePath: agentRef,
                schemaHash: "stub",
                grammarHash: "stub",
                health: "unknown",
            });
        }
    }

    const first = createStudioRuntimeCore(context, {
        sandbox: new CapturingSandboxManager(),
    });
    await first.startSandbox({ id: "alpha", agents: ["agentA"] });
    await first.startSandbox({ id: "beta" });
    await first.loadSandboxAgent("beta", "agentB");

    const persisted = store.get("studio.persistedSandboxes") as Array<{
        id: string;
        agents: string[];
    }>;
    assert.deepEqual(persisted.map((p) => p.id).sort(), ["alpha", "beta"]);
    assert.deepEqual(persisted.find((p) => p.id === "alpha")?.agents, [
        "agentA",
    ]);
    assert.deepEqual(persisted.find((p) => p.id === "beta")?.agents, [
        "agentB",
    ]);

    const recorder = new CapturingSandboxManager();
    const second = createStudioRuntimeCore(context, { sandbox: recorder });
    assert.deepEqual(await second.listSandboxes(), []);

    await second.restoreSandboxes();

    const restored = (await second.listSandboxes()).map((s) => s.id).sort();
    assert.deepEqual(restored, ["alpha", "beta"]);
    const startedById = new Map(recorder.started.map((c) => [c.id, c.agents]));
    assert.deepEqual(startedById.get("alpha"), ["agentA"]);
    assert.deepEqual(startedById.get("beta"), ["agentB"]);
});

test("restoreSandboxes survives a per-sandbox failure and persists the surviving set", async () => {
    const { context, store } = createContext();
    await context.workspaceState.update("studio.persistedSandboxes", [
        { id: "good", agents: [] },
        { id: "bad", agents: [] },
    ]);

    class HostileSandboxManager extends RecordingSandboxManager {
        async start(cfg: SandboxConfig): Promise<SandboxHandle> {
            if (cfg.id === "bad") {
                throw new Error("nope");
            }
            return super.start(cfg);
        }
    }

    const runtime = createStudioRuntimeCore(context, {
        sandbox: new HostileSandboxManager(),
    });
    await runtime.restoreSandboxes();

    const live = (await runtime.listSandboxes()).map((s) => s.id);
    assert.deepEqual(live, ["good"]);

    const persisted = store.get("studio.persistedSandboxes") as Array<{
        id: string;
    }>;
    assert.deepEqual(
        persisted.map((p) => p.id),
        ["good"],
    );
});

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
    assert.deepEqual(
        await runtime.getPhaseStatusOnActiveSession("Testing"),
        "complete",
    );
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

test("rerunPhasesOnActiveSession normalizes phase order and de-duplicates", async () => {
    let now = 320;
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context, {
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-rerun-ordered",
            now: () => ++now,
        }),
    });

    await runtime.startOnboarding({
        description: "Ticket routing agent",
    });
    await runtime.runRemainingPhasesOnActiveSession();
    await runtime.runPhaseOnActiveSession("Discovery", {
        description: "Ticket routing agent v3",
    });
    await runtime.restorePhaseOnActiveSession("Discovery");

    const rerun = await runtime.rerunPhasesOnActiveSession([
        "SchemaGen",
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

test("resolveInstallArtifactPathForActiveSession prefers packaging artifact output", async () => {
    const artifactPath = await fs.mkdtemp(
        path.join(os.tmpdir(), "typeagent-studio-resolve-artifact-"),
    );
    const workspaceRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "typeagent-studio-resolve-workspace-"),
    );
    await fs.mkdir(
        path.join(workspaceRoot, "packages", "agents", "service-desk"),
        {
            recursive: true,
        },
    );

    const { context } = createContext([workspaceRoot]);
    const runtime = createStudioRuntimeCore(context, {
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-resolve-artifact",
            phaseRunner: async (_session, phase, _inputs) => {
                if (phase === "Packaging") {
                    return { artifactPath };
                }
                return { phase };
            },
        }),
    });

    await runtime.startOnboarding({
        description: "Resolve artifact path",
        agentName: "service-desk",
    });
    await runtime.runPhaseOnActiveSession("Packaging", {});

    const resolved = await runtime.resolveInstallArtifactPathForActiveSession();
    assert.equal(resolved, artifactPath);
});

test("resolveInstallArtifactPathForActiveSession throws when no local artifact can be found", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context, {
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-resolve-missing",
        }),
    });

    await runtime.startOnboarding({
        description: "Missing artifact path",
        agentName: "missing-agent",
    });

    await assert.rejects(
        () => runtime.resolveInstallArtifactPathForActiveSession(),
        /No local generated agent artifact/,
    );
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

    const activeGate =
        await runtime.evaluatePackagingHealthGateForActiveSession();
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

test("loadSandboxAgent loads an agent and emits a lifecycle event", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context);

    let changes = 0;
    const changeSub = runtime.onSandboxChanged(() => {
        changes++;
    });
    const loadedAgents: string[] = [];
    const anySub = runtime.onAnyEvent((event) => {
        if (event.type === "sandbox.agent.loaded" && event.affectedAgent) {
            loadedAgents.push(event.affectedAgent);
        }
    });

    const started = await runtime.startSandbox();
    const status = await runtime.loadSandboxAgent(started.id, "player");

    assert.ok(status.agents.some((agent) => agent.name === "player"));
    assert.ok(loadedAgents.includes("player"));
    assert.ok(changes >= 2);

    changeSub.dispose();
    anySub.dispose();
});

test("startSandbox mints unique ids so multiple sandboxes can coexist", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context);

    const first = await runtime.startSandbox();
    const second = await runtime.startSandbox();
    const third = await runtime.startSandbox();

    // First reuses the default id; subsequent ones get unique suffixes.
    assert.equal(first.id, "studio-default");
    assert.notEqual(second.id, first.id);
    assert.notEqual(third.id, second.id);

    const ids = (await runtime.listSandboxes()).map((s) => s.id).sort();
    assert.deepEqual(ids, [
        "studio-default",
        "studio-default-2",
        "studio-default-3",
    ]);

    // An explicit id is still honored.
    const named = await runtime.startSandbox({ id: "experiment-1" });
    assert.equal(named.id, "experiment-1");
});

test("listAvailableAgents discovers packages that declare the ./agent/manifest export", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio-agents-"));
    try {
        const agentsDir = path.join(repoRoot, "packages", "agents");
        const mkAgent = async (name: string, withExport: boolean) => {
            await fs.mkdir(path.join(agentsDir, name), { recursive: true });
            await fs.writeFile(
                path.join(agentsDir, name, "package.json"),
                JSON.stringify({
                    name,
                    ...(withExport
                        ? { exports: { "./agent/manifest": "./dist/m.js" } }
                        : {}),
                }),
            );
        };
        await mkAgent("player", true);
        await mkAgent("calendar", true);
        await mkAgent("agentUtils", false); // a lib, not an agent
        await fs.mkdir(path.join(agentsDir, "dist"), { recursive: true });

        const { context } = createContext([repoRoot]);
        const runtime = createStudioRuntimeCore(context);

        assert.deepEqual(await runtime.listAvailableAgents(), [
            "calendar",
            "player",
        ]);
    } finally {
        await fs.rm(repoRoot, { recursive: true, force: true });
    }
});

test("unloadSandboxAgent removes a loaded agent", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context);

    const started = await runtime.startSandbox();
    await runtime.loadSandboxAgent(started.id, "calendar");
    const afterLoad = await runtime.listSandboxes();
    assert.ok(afterLoad[0].agents.some((agent) => agent.name === "calendar"));

    const status = await runtime.unloadSandboxAgent(started.id, "calendar");
    assert.ok(!status.agents.some((agent) => agent.name === "calendar"));
});

test("refreshSandboxAgent reloads the agent in each sandbox where it is loaded", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context);

    await runtime.startSandbox({ id: "a", agents: ["player"] });
    await runtime.startSandbox({ id: "b", agents: ["player", "calendar"] });

    let playerReloads = 0;
    const sub = runtime.onAnyEvent((event) => {
        if (
            event.type === "sandbox.agent.loaded" &&
            event.affectedAgent === "player"
        ) {
            playerReloads++;
        }
    });

    const refreshed = await runtime.refreshSandboxAgent("player");
    sub.dispose();

    // player is loaded in both sandboxes → both reloaded, one event each.
    assert.equal(refreshed, 2);
    assert.equal(playerReloads, 2);

    // An agent not loaded anywhere refreshes nothing.
    assert.equal(await runtime.refreshSandboxAgent("nonexistent"), 0);
});

test("recordFeedback emits an event and federates into the agent corpus", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context);

    let recordedCount = 0;
    const sub = runtime.onAnyEvent((event) => {
        if (event.type === "feedback.recorded") {
            recordedCount += 1;
        }
    });

    await runtime.recordFeedback({
        requestId: "req-1",
        rating: "down",
        agent: "player",
        utterance: "play some jazz",
        category: "bad-response",
    });
    sub.dispose();

    assert.equal(recordedCount, 1);

    const rows = await runtime.listFeedback({ agent: "player" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rating, "down");

    const entries = await runtime.listCorpusEntries("player");
    const feedbackEntries = entries.filter(
        (entry) => entry.source === "feedback",
    );
    assert.equal(feedbackEntries.length, 1);
    assert.equal(feedbackEntries[0].utterance, "play some jazz");
});

class StubCorpusService implements CorpusService {
    constructor(private readonly entries: CorpusEntry[]) {}
    async list(_agent: string, _filter?: CorpusFilter): Promise<CorpusEntry[]> {
        return this.entries;
    }
    async *load(): AsyncIterable<CorpusEntry> {
        for (const entry of this.entries) {
            yield entry;
        }
    }
    async append(): Promise<string> {
        throw new Error("not implemented");
    }
    async promote(): Promise<number> {
        throw new Error("not implemented");
    }
    async exportJsonl(): Promise<number> {
        throw new Error("not implemented");
    }
    async addExternalSource(): Promise<void> {}
    async removeExternalSource(): Promise<void> {}
    async listExternalSources() {
        return [];
    }
    async seedInRepoCorpus(agent: string) {
        return {
            path: `mem://corpus/${agent}.utterances.jsonl`,
            created: true,
        };
    }
}

function corpusEntry(id: string, expectedAction?: unknown): CorpusEntry {
    return {
        id,
        utterance: `utterance ${id}`,
        agent: "player",
        source: "in-repo",
        provenance: { sourceUri: `mem://${id}` },
        ...(expectedAction !== undefined ? { expectedAction } : {}),
    };
}

test("replayCorpus returns an all-equal baseline with the identity resolver", async () => {
    const { context } = createContext();
    const corpus = new StubCorpusService([
        corpusEntry("a", { action: "play" }),
        corpusEntry("b"),
    ]);
    const runtime = createStudioRuntimeCore(context, { corpus });

    const result = await runtime.replayCorpus({ agent: "player" });
    assert.equal(result.rows.length, 2);
    assert.equal(result.summary.corpusSize, 2);
    assert.equal(result.summary.rowCount, 2);
    assert.equal(result.summary.equalCount, 2);
    assert.equal(result.summary.changedCount, 0);
});

test("replayCorpus uses an injected resolver and emits replay events", async () => {
    const { context } = createContext();
    const corpus = new StubCorpusService([corpusEntry("a"), corpusEntry("b")]);
    const resolver: ReplayActionResolver = {
        resolve(entry, _version, side) {
            return {
                action: { value: side === "A" ? entry.id : `${entry.id}!` },
                cacheState: "hit",
            };
        },
    };
    const runtime = createStudioRuntimeCore(context, {
        corpus,
        replayResolver: resolver,
    });

    let rowEvents = 0;
    let summaryEvents = 0;
    const sub = runtime.onAnyEvent((event) => {
        if (event.type === "replay.row") {
            rowEvents += 1;
        } else if (event.type === "replay.summary") {
            summaryEvents += 1;
        }
    });

    const result = await runtime.replayCorpus({ agent: "player" });
    sub.dispose();

    assert.equal(result.summary.changedCount, 2);
    assert.equal(result.summary.equalCount, 0);
    assert.equal(rowEvents, 2);
    assert.equal(summaryEvents, 1);
});

function makeCollision(
    overrides: Partial<CollisionDetectedEvent> = {},
): CollisionDetectedEvent {
    return {
        schemaVersion: 1,
        type: "collision.detected",
        ts: 1,
        sandboxId: "studio-default",
        kind: "overlap",
        detectionPoint: "grammar-edit",
        participants: [],
        ...overrides,
    };
}

test("reportCollision stores, emits an event, and lists newest-first", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context);

    let detections = 0;
    const sub = runtime.onCollisionDetected(() => {
        detections += 1;
    });

    runtime.reportCollision(makeCollision({ ts: 10, kind: "overlap" }));
    runtime.reportCollision(makeCollision({ ts: 20, kind: "shadow" }));
    sub.dispose();

    assert.equal(detections, 2);
    const list = await runtime.listCollisions();
    assert.equal(list.length, 2);
    assert.equal(list[0].kind, "shadow");
    assert.equal(list[1].kind, "overlap");

    const collisionEvents = (await runtime.queryRecentEvents()).filter(
        (event) => event.type === "collision.detected",
    );
    assert.equal(collisionEvents.length, 2);
});

test("listCollisions honors filters and clearCollisions empties the store", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context);

    runtime.reportCollision(makeCollision({ kind: "overlap" }));
    runtime.reportCollision(makeCollision({ kind: "ambiguity" }));

    const ambiguities = await runtime.listCollisions({ kind: "ambiguity" });
    assert.equal(ambiguities.length, 1);
    assert.equal(ambiguities[0].kind, "ambiguity");

    const removed = await runtime.clearCollisions();
    assert.equal(removed, 2);
    assert.equal((await runtime.listCollisions()).length, 0);
});

test("scanGrammarCollisions reports detected overlaps as grammar-edit collisions", async () => {
    const { context } = createContext();
    let received: string[] | undefined;
    const runtime = createStudioRuntimeCore(context, {
        collisionScanner: async ({ agents }) => {
            received = agents;
            return {
                scanned: ["music", "player"],
                skipped: [{ schemaName: "list", reason: "no-grammar" }],
                collisions: [
                    {
                        schemaA: "music",
                        schemaB: "player",
                        witnessText: "play it",
                        rulePatternA: "play $(x)",
                        rulePatternB: "play $(y)",
                    },
                ],
            };
        },
    });

    const result = await runtime.scanGrammarCollisions({
        agents: ["player", "music"],
    });

    assert.deepEqual(received, ["player", "music"]);
    assert.equal(result.collisionCount, 1);
    assert.deepEqual(result.scanned, ["music", "player"]);
    assert.equal(result.skipped.length, 1);

    const list = await runtime.listCollisions();
    assert.equal(list.length, 1);
    assert.equal(list[0].kind, "overlap");
    assert.equal(list[0].detectionPoint, "grammar-edit");
    assert.deepEqual(list[0].exemplarUtterances, ["play it"]);
    assert.equal(list[0].participants.length, 2);
});

test("scanGrammarCollisions replaces prior grammar-edit collisions by default", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context, {
        collisionScanner: async () => ({
            scanned: ["a"],
            skipped: [],
            collisions: [{ schemaA: "a", schemaB: "b", witnessText: "w" }],
        }),
    });

    await runtime.scanGrammarCollisions({ agents: ["a", "b"] });
    await runtime.scanGrammarCollisions({ agents: ["a", "b"] });

    assert.equal((await runtime.listCollisions()).length, 1);
});

test("scanGrammarCollisions with replace=false accumulates collisions", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context, {
        collisionScanner: async () => ({
            scanned: ["a"],
            skipped: [],
            collisions: [{ schemaA: "a", schemaB: "b", witnessText: "w" }],
        }),
    });

    await runtime.scanGrammarCollisions({ agents: ["a", "b"], replace: false });
    await runtime.scanGrammarCollisions({ agents: ["a", "b"], replace: false });

    assert.equal((await runtime.listCollisions()).length, 2);
});

test("onAgentLoadChanged fires on agent load and unload but not other lifecycle", async () => {
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context);

    let fires = 0;
    const sub = runtime.onAgentLoadChanged(() => {
        fires++;
    });

    const started = await runtime.startSandbox();
    // startSandbox alone (no agents) must not trigger the agent-load listener.
    assert.equal(fires, 0);

    await runtime.loadSandboxAgent(started.id, "player");
    assert.equal(fires, 1);

    await runtime.unloadSandboxAgent(started.id, "player");
    assert.equal(fires, 2);

    sub.dispose();

    // After disposal, further changes must not be observed.
    await runtime.loadSandboxAgent(started.id, "calendar");
    assert.equal(fires, 2);
});

test("scanGrammarCollisions defaults to agents loaded across sandboxes", async () => {
    const { context } = createContext();
    let received: string[] | undefined;
    const runtime = createStudioRuntimeCore(context, {
        collisionScanner: async ({ agents }) => {
            received = agents;
            return { scanned: [], skipped: [], collisions: [] };
        },
    });

    await runtime.scanGrammarCollisions();

    assert.deepEqual(received, []);
});
