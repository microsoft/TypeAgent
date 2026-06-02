// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryOnboardingBridge } from "@typeagent/core/onboardingBridge";
import { createStudioRuntimeCore } from "../studioRuntimeCore.js";

function createContext() {
    const store = new Map<string, unknown>();
    return {
        context: {
            globalStorageFsPath: "C:/tmp/typeagent-studio-tests",
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
    const { context } = createContext();
    const runtime = createStudioRuntimeCore(context, {
        onboarding: new InMemoryOnboardingBridge({
            createSessionId: () => "session-install",
        }),
    });

    await runtime.startOnboarding({
        description: "Finance approvals agent",
        agentName: "finance-approvals",
    });
    const sessionId = await runtime.installLastSessionToSandbox("sandbox-a");
    const state = await runtime.getActiveOnboardingSession();

    assert.equal(sessionId, "session-install");
    assert.deepEqual(state.installedSandboxIds, ["sandbox-a"]);
});
