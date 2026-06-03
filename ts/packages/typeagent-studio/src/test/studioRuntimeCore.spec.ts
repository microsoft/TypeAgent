// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { InMemoryOnboardingBridge } from "@typeagent/core/onboardingBridge";
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
