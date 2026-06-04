// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ONBOARDING_PHASE_ORDER,
    type OnboardingPhaseName,
    type PhaseStatus,
    type OnboardingState,
} from "@typeagent/core/onboardingBridge";

export function getDefaultPhaseInputs(
    state: OnboardingState,
    phase: OnboardingPhaseName,
): unknown {
    switch (phase) {
        case "Discovery":
            return {
                description: state.description,
                agentName: state.agentName,
            };
        case "PhraseGen":
            return {
                seed: "Generate representative utterances for the target workflow.",
                sourcePhase: "Discovery",
            };
        case "SchemaGen":
            return {
                seed: "Draft schema/action types from discovery and phrase coverage.",
                sourcePhase: "PhraseGen",
            };
        case "GrammarGen":
            return {
                seed: "Draft grammar variants from schema and phrase outputs.",
                sourcePhase: "SchemaGen",
            };
        case "Scaffolder":
            return {
                seed: "Create initial manifest/schema/handler scaffolding.",
                sourcePhase: "GrammarGen",
            };
        case "Testing":
            return {
                seed: "Run local validation and summarize failures.",
                sourcePhase: "Scaffolder",
            };
        case "Packaging":
            return {
                seed: "Prepare package artifacts and release checklist.",
                sourcePhase: "Testing",
            };
    }
}

export function formatOnboardingSummary(state: OnboardingState): string {
    const lines: string[] = [];
    lines.push("# TypeAgent Studio Onboarding Summary");
    lines.push("");
    lines.push(`- Session: ${state.sessionId}`);
    lines.push(`- Agent: ${state.agentName}`);
    lines.push(`- Current phase: ${state.currentPhase}`);
    lines.push(
        `- Installed sandboxes: ${state.installedSandboxIds?.length ? state.installedSandboxIds.join(", ") : "none"}`,
    );
    lines.push("");
    lines.push("## Description");
    lines.push("");
    lines.push(state.description);
    lines.push("");
    lines.push("## Phase status");
    lines.push("");
    lines.push("| Phase | Status | Started | Completed |");
    lines.push("| --- | --- | --- | --- |");

    for (const phase of ONBOARDING_PHASE_ORDER) {
        const snapshot = state.phases[phase];
        const started = snapshot?.startedAt
            ? new Date(snapshot.startedAt).toISOString()
            : "-";
        const completed = snapshot?.completedAt
            ? new Date(snapshot.completedAt).toISOString()
            : "-";
        lines.push(
            `| ${phase} | ${snapshot?.status ?? "pending"} | ${started} | ${completed} |`,
        );
    }

    return lines.join("\n");
}

export function getAdvanceTargetPhase(
    orderedPhases: readonly OnboardingPhaseName[],
    currentPhase: OnboardingPhaseName,
    phases: Partial<Record<OnboardingPhaseName, { status: PhaseStatus }>>,
): OnboardingPhaseName | undefined {
    const currentStatus = phases[currentPhase]?.status ?? "pending";
    if (currentStatus !== "complete") {
        return currentPhase;
    }

    return orderedPhases.find(
        (phase) => (phases[phase]?.status ?? "pending") !== "complete",
    );
}

export function formatOnboardingHealthSnapshot(
    state: OnboardingState,
    packagingGate:
        | {
              status: "pass" | "warn" | "fail" | "unavailable";
              summary: string;
          }
        | undefined,
): string {
    const completeCount = ONBOARDING_PHASE_ORDER.filter(
        (phase) => state.phases[phase]?.status === "complete",
    ).length;
    const staleCount = ONBOARDING_PHASE_ORDER.filter(
        (phase) => state.phases[phase]?.status === "stale",
    ).length;
    const pendingCount = ONBOARDING_PHASE_ORDER.length - completeCount - staleCount;
    const installedSandboxes =
        state.installedSandboxIds && state.installedSandboxIds.length > 0
            ? state.installedSandboxIds.join(", ")
            : "none";
    const packagingSummary = packagingGate
        ? `${packagingGate.status}: ${packagingGate.summary}`
        : "unavailable: No install artifact path resolved for active session.";

    return [
        `Session ${state.sessionId} (${state.agentName})`,
        `Phase ${state.currentPhase} | complete=${completeCount} stale=${staleCount} pending=${pendingCount}`,
        `Installed sandboxes: ${installedSandboxes}`,
        `Packaging gate: ${packagingSummary}`,
    ].join("\n");
}

export function formatOnboardingDiagnosticsBundle(args: {
    summary: string;
    healthReport: string;
    artifactPath?: string;
    generatedAt?: number;
}): string {
    const timestamp = new Date(args.generatedAt ?? Date.now()).toISOString();
    const lines: string[] = [];
    lines.push("# TypeAgent Studio Onboarding Diagnostics Bundle");
    lines.push("");
    lines.push(`- Generated at: ${timestamp}`);
    lines.push(`- Artifact path: ${args.artifactPath ?? "unresolved"}`);
    lines.push("");
    lines.push("## Onboarding Summary");
    lines.push("");
    lines.push(args.summary);
    lines.push("");
    lines.push("## Packaging Health Report");
    lines.push("");
    lines.push(args.healthReport);
    lines.push("");
    return lines.join("\n");
}
