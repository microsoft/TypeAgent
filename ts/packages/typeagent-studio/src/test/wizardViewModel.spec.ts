// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import {
    ONBOARDING_PHASE_ORDER,
    type OnboardingPhaseName,
    type OnboardingState,
    type PhaseSnapshot,
    type PhaseStatus,
} from "@typeagent/core/onboardingBridge";
import { toWizardViewModel } from "../webviewKit/wizardViewModel.js";

const ORDER = ONBOARDING_PHASE_ORDER;

function snapshot(
    status: PhaseStatus,
    extra: Partial<PhaseSnapshot> = {},
): PhaseSnapshot {
    return { status, inputs: {}, ancestorPhaseHashes: [], ...extra };
}

function makeState(
    statuses: Partial<Record<OnboardingPhaseName, PhaseStatus>>,
    currentPhase: OnboardingPhaseName,
    extra: Partial<OnboardingState> = {},
): OnboardingState {
    const phases: OnboardingState["phases"] = {};
    for (const [name, status] of Object.entries(statuses)) {
        phases[name as OnboardingPhaseName] = snapshot(status);
    }
    return {
        sessionId: "s1",
        agentName: "thermostat",
        description: "control my thermostat",
        phases,
        currentPhase,
        ...extra,
    };
}

test("inactive session yields the start-screen model", () => {
    const vm = toWizardViewModel(undefined, ORDER);
    assert.equal(vm.active, false);
    assert.deepEqual(vm.phases, []);
    assert.equal(vm.totalCount, ORDER.length);
    assert.equal(vm.completeCount, 0);
    assert.equal(vm.canInstall, false);
    assert.deepEqual(vm.installedSandboxIds, []);
    assert.equal(vm.nextRunnablePhase, undefined);
});

test("fresh session marks only the first phase runnable", () => {
    const vm = toWizardViewModel(
        makeState({ Discovery: "pending" }, "Discovery"),
        ORDER,
    );
    assert.equal(vm.active, true);
    assert.equal(vm.agentName, "thermostat");
    assert.equal(vm.phases.length, ORDER.length);
    assert.equal(vm.nextRunnablePhase, "Discovery");

    const discovery = vm.phases[0];
    assert.equal(discovery.name, "Discovery");
    assert.equal(discovery.index, 1);
    assert.equal(discovery.runnable, true);
    assert.equal(discovery.isCurrent, true);

    // Nothing after the first phase is runnable until Discovery completes.
    for (const phase of vm.phases.slice(1)) {
        assert.equal(phase.runnable, false, `${phase.name} not runnable`);
    }
});

test("completed prefix advances the next runnable phase", () => {
    const vm = toWizardViewModel(
        makeState({ Discovery: "complete", PhraseGen: "pending" }, "PhraseGen"),
        ORDER,
    );
    assert.equal(vm.completeCount, 1);
    assert.equal(vm.nextRunnablePhase, "PhraseGen");

    const discovery = vm.phases.find((p) => p.name === "Discovery")!;
    assert.equal(discovery.runnable, false, "complete phase is not runnable");

    const phraseGen = vm.phases.find((p) => p.name === "PhraseGen")!;
    assert.equal(phraseGen.runnable, true);
});

test("stale phases are collected and remain runnable", () => {
    const vm = toWizardViewModel(
        makeState(
            {
                Discovery: "complete",
                PhraseGen: "complete",
                SchemaGen: "stale",
            },
            "SchemaGen",
        ),
        ORDER,
    );
    assert.deepEqual(vm.stalePhases, ["SchemaGen"]);
    assert.equal(vm.nextRunnablePhase, "SchemaGen");

    const schemaGen = vm.phases.find((p) => p.name === "SchemaGen")!;
    assert.equal(schemaGen.runnable, true);
    assert.equal(schemaGen.status, "stale");
});

test("canInstall requires a complete Packaging phase and no failing gate", () => {
    const allComplete: Partial<Record<OnboardingPhaseName, PhaseStatus>> = {};
    for (const name of ORDER) {
        allComplete[name] = "complete";
    }

    const ready = toWizardViewModel(makeState(allComplete, "Packaging"), ORDER);
    assert.equal(ready.completeCount, ORDER.length);
    assert.equal(ready.canInstall, true);
    assert.equal(ready.nextRunnablePhase, undefined);

    const failing = toWizardViewModel(
        makeState(allComplete, "Packaging"),
        ORDER,
        {
            health: { status: "fail", summary: "2 findings" },
        },
    );
    assert.equal(failing.canInstall, false);
    assert.deepEqual(failing.health, { status: "fail", summary: "2 findings" });

    const warned = toWizardViewModel(
        makeState(allComplete, "Packaging"),
        ORDER,
        {
            health: { status: "warn", summary: "1 finding" },
        },
    );
    assert.equal(warned.canInstall, true);
});

test("packaging incomplete blocks install even when the gate passes", () => {
    const vm = toWizardViewModel(
        makeState({ Discovery: "complete", Packaging: "pending" }, "PhraseGen"),
        ORDER,
        { health: { status: "pass", summary: "ok" } },
    );
    assert.equal(vm.canInstall, false);
});

test("outputs and inputs are pretty-printed and passthrough fields survive", () => {
    const state = makeState({ Discovery: "complete" }, "PhraseGen", {
        installedSandboxIds: ["studio-default"],
    });
    state.phases.Discovery = snapshot("complete", {
        inputs: { a: 1 },
        outputs: { b: 2 },
        startedAt: 100,
        completedAt: 200,
    });

    const vm = toWizardViewModel(state, ORDER);
    const discovery = vm.phases[0];
    assert.equal(discovery.inputsJson, JSON.stringify({ a: 1 }, null, 2));
    assert.equal(discovery.outputsJson, JSON.stringify({ b: 2 }, null, 2));
    assert.equal(discovery.startedAt, 100);
    assert.equal(discovery.completedAt, 200);
    assert.deepEqual(vm.installedSandboxIds, ["studio-default"]);
});
