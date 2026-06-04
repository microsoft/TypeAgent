// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import {
    ONBOARDING_PHASE_ORDER,
    type OnboardingState,
} from "@typeagent/core/onboardingBridge";
import {
    formatOnboardingDiagnosticsBundle,
    formatOnboardingHealthSnapshot,
    formatOnboardingHealthSnapshotMarkdown,
    formatOnboardingSettingsSnapshotMarkdown,
    formatOnboardingSettingsSnapshot,
    formatOnboardingSummary,
    getAdvanceTargetPhase,
    getDefaultPhaseInputs,
    normalizeMarkdownFileName,
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

test("formatOnboardingHealthSnapshot includes phase counts and gate summary", () => {
    const snapshot = formatOnboardingHealthSnapshot(createState(), {
        status: "warn",
        summary: "2 warning findings for agent calendar-enterprise.",
    });

    assert.match(snapshot, /Session session-1 \(calendar-enterprise\)/);
    assert.match(snapshot, /complete=1 stale=1 pending=5/);
    assert.match(snapshot, /Installed sandboxes: studio-default/);
    assert.match(
        snapshot,
        /Packaging gate: warn: 2 warning findings for agent calendar-enterprise\./,
    );
});

test("formatOnboardingHealthSnapshot shows unavailable gate fallback", () => {
    const snapshot = formatOnboardingHealthSnapshot(createState(), undefined);
    assert.match(snapshot, /Packaging gate: unavailable:/);
});

test("formatOnboardingHealthSnapshotMarkdown formats health as markdown", () => {
    const snapshot = formatOnboardingHealthSnapshotMarkdown(createState(), {
        status: "warn",
        summary: "2 warning findings for agent calendar-enterprise.",
    });

    assert.match(snapshot, /# TypeAgent Studio Onboarding Health Snapshot/);
    assert.match(snapshot, /Session: session-1/);
    assert.match(snapshot, /Phase counts: complete=1, stale=1, pending=5/);
    assert.match(snapshot, /Packaging gate: warn: 2 warning findings/);
});

test("formatOnboardingDiagnosticsBundle includes metadata summary and report", () => {
    const bundle = formatOnboardingDiagnosticsBundle({
        summary: "# Summary\n\nTest summary",
        healthSnapshot: "Health snapshot text",
        healthReport: "# Health\n\nNo findings.",
        artifactPath: "C:/repo/packages/agents/demo",
        settings: {
            openSummaryAfterBatchRun: false,
            defaultSandboxId: "studio-qa",
            installHealthGatePolicy: "warn",
        },
        generatedAt: 0,
    });

    assert.match(bundle, /# TypeAgent Studio Onboarding Diagnostics Bundle/);
    assert.match(bundle, /Generated at: 1970-01-01T00:00:00.000Z/);
    assert.match(bundle, /Artifact path: C:\/repo\/packages\/agents\/demo/);
    assert.match(bundle, /## Onboarding Settings/);
    assert.match(bundle, /Open summary after batch run: false/);
    assert.match(bundle, /Default sandbox id: studio-qa/);
    assert.match(bundle, /Install health gate policy: warn/);
    assert.match(bundle, /## Onboarding Summary/);
    assert.match(bundle, /## Onboarding Health Snapshot/);
    assert.match(bundle, /Health snapshot text/);
    assert.match(bundle, /## Packaging Health Report/);
});

test("formatOnboardingDiagnosticsBundle shows unresolved artifact fallback", () => {
    const bundle = formatOnboardingDiagnosticsBundle({
        summary: "summary",
        healthReport: "report",
        generatedAt: 0,
    });

    assert.match(bundle, /Artifact path: unresolved/);
    assert.match(bundle, /Open summary after batch run: true/);
    assert.match(bundle, /Default sandbox id: studio-default/);
    assert.match(bundle, /Install health gate policy: enforce/);
});

test("formatOnboardingSettingsSnapshot includes all onboarding settings", () => {
    const snapshot = formatOnboardingSettingsSnapshot({
        openSummaryAfterBatchRun: false,
        defaultSandboxId: "studio-qa",
        installHealthGatePolicy: "warn",
    });

    assert.match(snapshot, /TypeAgent Studio onboarding settings/);
    assert.match(snapshot, /Open summary after batch run: false/);
    assert.match(snapshot, /Default sandbox id: studio-qa/);
    assert.match(snapshot, /Install health gate policy: warn/);
});

test("formatOnboardingSettingsSnapshotMarkdown formats settings as markdown", () => {
    const snapshot = formatOnboardingSettingsSnapshotMarkdown({
        openSummaryAfterBatchRun: true,
        defaultSandboxId: "studio-default",
        installHealthGatePolicy: "enforce",
    });

    assert.match(snapshot, /# TypeAgent Studio Onboarding Settings/);
    assert.match(snapshot, /Open summary after batch run: true/);
    assert.match(snapshot, /Default sandbox id: studio-default/);
    assert.match(snapshot, /Install health gate policy: enforce/);
});

test("normalizeMarkdownFileName appends markdown extension when missing", () => {
    assert.equal(
        normalizeMarkdownFileName("onboarding-settings", "fallback.md"),
        "onboarding-settings.md",
    );
});

test("normalizeMarkdownFileName preserves markdown extension and trims whitespace", () => {
    assert.equal(
        normalizeMarkdownFileName("  custom-name.MD  ", "fallback.md"),
        "custom-name.MD",
    );
});

test("normalizeMarkdownFileName uses fallback when configured value is blank", () => {
    assert.equal(normalizeMarkdownFileName("   ", "fallback.md"), "fallback.md");
});
