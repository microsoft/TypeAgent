// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import {
    ONBOARDING_PHASE_ORDER,
    type OnboardingState,
} from "@typeagent/core/onboardingBridge";
import {
    formatOnboardingSummary,
    getAdvanceTargetPhase,
    getDefaultPhaseInputs,
} from "../onboardingPresentation.js";

function createState(): OnboardingState {
    return {
        sessionId: "session-1",
        agentName: "calendar-enterprise",
        description: "Calendar integration for internal scheduling API",
        currentPhase: "SchemaGen",
        installedSandboxIds: ["studio-default"],
        phases: {
            Discovery: {
                status: "complete",
                inputs: { description: "x" },
                outputs: { notes: "done" },
                startedAt: 1,
                completedAt: 2,
                ancestorPhaseHashes: [],
            },
            PhraseGen: {
                status: "stale",
                inputs: {},
                ancestorPhaseHashes: ["abc"],
            },
        },
    };
}

test("getDefaultPhaseInputs seeds discovery from onboarding state", () => {
    const state = createState();

    assert.deepEqual(getDefaultPhaseInputs(state, "Discovery"), {
        description: "Calendar integration for internal scheduling API",
        agentName: "calendar-enterprise",
    });
});

test("getDefaultPhaseInputs advances source phase by pipeline stage", () => {
    const state = createState();

    assert.deepEqual(getDefaultPhaseInputs(state, "GrammarGen"), {
        seed: "Draft grammar variants from schema and phrase outputs.",
        sourcePhase: "SchemaGen",
    });
    assert.deepEqual(getDefaultPhaseInputs(state, "Packaging"), {
        seed: "Prepare package artifacts and release checklist.",
        sourcePhase: "Testing",
    });
});

test("formatOnboardingSummary includes all phases and sandbox metadata", () => {
    const summary = formatOnboardingSummary(createState());

    assert.match(summary, /# TypeAgent Studio Onboarding Summary/);
    assert.match(summary, /Installed sandboxes: studio-default/);
    assert.match(summary, /\| Discovery \| complete \|/);
    assert.match(summary, /\| PhraseGen \| stale \|/);
    assert.match(summary, /\| SchemaGen \| pending \|/);
    assert.match(summary, /\| Packaging \| pending \|/);
});

test("getAdvanceTargetPhase returns current phase when not complete", () => {
    const state = createState();
    const target = getAdvanceTargetPhase(
        ONBOARDING_PHASE_ORDER,
        "SchemaGen",
        state.phases,
    );
    assert.equal(target, "SchemaGen");
});

test("getAdvanceTargetPhase advances to next incomplete phase", () => {
    const state = createState();
    state.currentPhase = "Discovery";
    state.phases.Discovery = {
        status: "complete",
        inputs: {},
        ancestorPhaseHashes: [],
    };
    state.phases.PhraseGen = {
        status: "complete",
        inputs: {},
        ancestorPhaseHashes: [],
    };

    const target = getAdvanceTargetPhase(
        ONBOARDING_PHASE_ORDER,
        "Discovery",
        state.phases,
    );
    assert.equal(target, "SchemaGen");
});

test("getAdvanceTargetPhase returns undefined when all phases complete", () => {
    const state = createState();
    for (const phase of ONBOARDING_PHASE_ORDER) {
        state.phases[phase] = {
            status: "complete",
            inputs: {},
            ancestorPhaseHashes: [],
        };
    }

    const target = getAdvanceTargetPhase(
        ONBOARDING_PHASE_ORDER,
        "Packaging",
        state.phases,
    );
    assert.equal(target, undefined);
});
