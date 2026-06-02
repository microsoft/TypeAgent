// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InMemoryOnboardingBridge,
    OnboardingSessionNotFoundError,
    ONBOARDING_PHASE_ORDER,
} from "../src/onboardingBridge/index.js";

describe("InMemoryOnboardingBridge", () => {
    it("start initializes session with Discovery as current phase", async () => {
        const bridge = new InMemoryOnboardingBridge({
            createSessionId: () => "s1",
            now: () => 100,
        });

        const state = await bridge.start({ description: "Calendar integration" });
        expect(state.sessionId).toBe("s1");
        expect(state.currentPhase).toBe("Discovery");
        expect(state.agentName).toBe("calendar-integration");
        expect(state.phases.Discovery?.status).toBe("pending");
    });

    it("runPhase records completion and advances currentPhase", async () => {
        const bridge = new InMemoryOnboardingBridge({
            createSessionId: () => "s1",
            now: (() => {
                let t = 100;
                return () => ++t;
            })(),
            phaseRunner: async (_session, phase, inputs) => ({ phase, inputs }),
        });

        await bridge.start({ description: "Calendar integration" });
        const snap = await bridge.runPhase("s1", "Discovery", { seed: 1 });
        expect(snap.status).toBe("complete");
        expect(snap.outputs).toEqual({ phase: "Discovery", inputs: { seed: 1 } });

        const state = await bridge.snapshot("s1");
        expect(state.currentPhase).toBe("PhraseGen");
        expect(state.phases.PhraseGen?.status).toBe("pending");
    });

    it("restorePhase marks downstream complete phases stale when ancestor hashes changed", async () => {
        const bridge = new InMemoryOnboardingBridge({
            createSessionId: () => "s1",
            now: (() => {
                let t = 200;
                return () => ++t;
            })(),
            phaseRunner: async (_session, phase, inputs) => ({ phase, inputs }),
        });

        await bridge.start({ description: "Calendar integration" });
        await bridge.runPhase("s1", "Discovery", { v: 1 });
        await bridge.runPhase("s1", "PhraseGen", { p: 1 });

        // Re-running Discovery changes its output hash.
        await bridge.runPhase("s1", "Discovery", { v: 2 });

        const restored = await bridge.restorePhase("s1", "Discovery");
        expect(restored.state.currentPhase).toBe("Discovery");
        expect(restored.affectedDownstream).toContain("PhraseGen");
        expect(restored.reconciliationRequired).toBe(true);
        expect(restored.state.phases.PhraseGen?.status).toBe("stale");
    });

    it("installToSandbox records target sandbox and calls install hook", async () => {
        const calls: string[] = [];
        const bridge = new InMemoryOnboardingBridge({
            createSessionId: () => "s1",
            onInstallToSandbox: async (_session, sandboxId) => {
                calls.push(sandboxId);
            },
        });

        await bridge.start({ description: "Calendar integration" });
        await bridge.installToSandbox("s1", "sandbox-1");
        await bridge.installToSandbox("s1", "sandbox-1");

        const snap = await bridge.snapshot("s1");
        expect(snap.installedSandboxIds).toEqual(["sandbox-1"]);
        expect(calls).toEqual(["sandbox-1", "sandbox-1"]);
    });

    it("throws OnboardingSessionNotFoundError on unknown session", async () => {
        const bridge = new InMemoryOnboardingBridge();
        await expect(bridge.snapshot("missing")).rejects.toBeInstanceOf(
            OnboardingSessionNotFoundError,
        );
        await expect(
            bridge.runPhase("missing", ONBOARDING_PHASE_ORDER[0]),
        ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
    });
});
