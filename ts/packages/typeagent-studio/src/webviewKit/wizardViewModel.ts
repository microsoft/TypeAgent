// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Browser-neutral view model for the New Agent wizard.
 *
 * Maps the headless {@link OnboardingState} into the exact shape the webview
 * renders: an ordered list of the seven phases with per-phase status/runnability,
 * the reconciliation (stale) set, install-readiness, and an optional packaging
 * health verdict. Kept free of `vscode` and node built-ins — it imports only
 * *types* from `@typeagent/core` (the `onboardingBridge` barrel drags in
 * `node:crypto` via its service, which must never reach the iframe bundle) — so
 * both the extension host and the browser client can share it and it is unit
 * testable. The canonical phase order is passed in by the host (which owns the
 * runtime) rather than imported, so the client never pulls a runtime value from
 * core.
 */

import type {
    OnboardingPhaseName,
    OnboardingState,
    PhaseStatus,
} from "@typeagent/core/onboardingBridge";

/** Packaging health-gate verdict, mirrored from the runtime's gate status. */
export type WizardHealthStatus = "pass" | "warn" | "fail" | "unavailable";

/** A packaging health verdict surfaced next to the install control. */
export interface WizardHealthView {
    status: WizardHealthStatus;
    summary: string;
}

/** One phase row in the wizard stepper. */
export interface WizardPhaseView {
    name: OnboardingPhaseName;
    /** 1-based position, for "Step 3 of 7" labelling. */
    index: number;
    status: PhaseStatus;
    /** The phase the session's cursor is on. */
    isCurrent: boolean;
    /** Every earlier phase is complete, so this phase can be run now. */
    runnable: boolean;
    startedAt?: number;
    completedAt?: number;
    /** Pretty-printed JSON of the phase outputs, when the phase has run. */
    outputsJson?: string;
    /** Pretty-printed JSON of the phase inputs. */
    inputsJson?: string;
}

/** The full state the webview renders. */
export interface WizardViewModel {
    /** No active onboarding session — the client shows the start screen. */
    active: boolean;
    agentName?: string;
    sessionId?: string;
    description?: string;
    currentPhase?: OnboardingPhaseName;
    phases: WizardPhaseView[];
    /** Phases whose recorded ancestor outputs no longer match — need a re-run. */
    stalePhases: OnboardingPhaseName[];
    /** The first non-complete phase in order — the guided-mode "run next" target. */
    nextRunnablePhase?: OnboardingPhaseName;
    completeCount: number;
    totalCount: number;
    /** Packaging is complete and no failing health gate blocks installation. */
    canInstall: boolean;
    installedSandboxIds: string[];
    health?: WizardHealthView;
}

/** The terminal phase that must complete before an agent can be installed. */
const PACKAGING_PHASE: OnboardingPhaseName = "Packaging";

function prettyJson(value: unknown): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

/**
 * Build the wizard view model from a session snapshot (or `undefined` when no
 * session is active). `phaseOrder` is the canonical order from the runtime
 * (`listPhases()` / `ONBOARDING_PHASE_ORDER`) so the model never hardcodes it.
 * `health`, when supplied, is the latest packaging-gate verdict.
 */
export function toWizardViewModel(
    state: OnboardingState | undefined,
    phaseOrder: readonly OnboardingPhaseName[],
    opts: { health?: WizardHealthView } = {},
): WizardViewModel {
    const totalCount = phaseOrder.length;

    if (!state) {
        return {
            active: false,
            phases: [],
            stalePhases: [],
            completeCount: 0,
            totalCount,
            canInstall: false,
            installedSandboxIds: [],
        };
    }

    const phases: WizardPhaseView[] = [];
    const stalePhases: OnboardingPhaseName[] = [];
    let completeCount = 0;
    let nextRunnablePhase: OnboardingPhaseName | undefined;
    // A phase is runnable only when every earlier phase is already complete.
    let allEarlierComplete = true;

    phaseOrder.forEach((name, i) => {
        const snapshot = state.phases[name];
        const status: PhaseStatus = snapshot?.status ?? "pending";
        if (status === "complete") {
            completeCount += 1;
        }
        if (status === "stale") {
            stalePhases.push(name);
        }

        const runnable = allEarlierComplete && status !== "complete";
        if (runnable && nextRunnablePhase === undefined) {
            nextRunnablePhase = name;
        }

        phases.push({
            name,
            index: i + 1,
            status,
            isCurrent: state.currentPhase === name,
            runnable,
            startedAt: snapshot?.startedAt,
            completedAt: snapshot?.completedAt,
            outputsJson: prettyJson(snapshot?.outputs),
            inputsJson: prettyJson(snapshot?.inputs),
        });

        if (status !== "complete") {
            allEarlierComplete = false;
        }
    });

    const packagingComplete =
        state.phases[PACKAGING_PHASE]?.status === "complete";
    const canInstall = packagingComplete && opts.health?.status !== "fail";

    return {
        active: true,
        agentName: state.agentName,
        sessionId: state.sessionId,
        description: state.description,
        currentPhase: state.currentPhase,
        phases,
        stalePhases,
        nextRunnablePhase,
        completeCount,
        totalCount,
        canInstall,
        installedSandboxIds: state.installedSandboxIds ?? [],
        ...(opts.health ? { health: opts.health } : {}),
    };
}
