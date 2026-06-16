// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ONBOARDING_PHASE_ORDER,
    type OnboardingPhaseName,
    type PhaseStatus,
    type OnboardingState,
} from "@typeagent/core/onboardingBridge";

// getDefaultPhaseInputs moved to the headless runtime in @typeagent/core; it is
// runtime logic (seeds a phase run), not presentation. Re-exported here so
// existing importers/tests keep their import path.
export { getDefaultPhaseInputs } from "@typeagent/core/runtime";

export interface OnboardingSettingsSnapshot {
    openSummaryAfterBatchRun: boolean;
    defaultSandboxId: string;
    installHealthGatePolicy: "enforce" | "warn";
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
    const pendingCount =
        ONBOARDING_PHASE_ORDER.length - completeCount - staleCount;
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

export function formatOnboardingHealthSnapshotMarkdown(
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
    const pendingCount =
        ONBOARDING_PHASE_ORDER.length - completeCount - staleCount;
    const installedSandboxes =
        state.installedSandboxIds && state.installedSandboxIds.length > 0
            ? state.installedSandboxIds.join(", ")
            : "none";
    const packagingSummary = packagingGate
        ? `${packagingGate.status}: ${packagingGate.summary}`
        : "unavailable: No install artifact path resolved for active session.";

    return [
        "# TypeAgent Studio Onboarding Health Snapshot",
        "",
        `- Session: ${state.sessionId}`,
        `- Agent: ${state.agentName}`,
        `- Current phase: ${state.currentPhase}`,
        `- Phase counts: complete=${completeCount}, stale=${staleCount}, pending=${pendingCount}`,
        `- Installed sandboxes: ${installedSandboxes}`,
        `- Packaging gate: ${packagingSummary}`,
        "",
    ].join("\n");
}

export function formatOnboardingDiagnosticsBundle(args: {
    summary: string;
    healthSnapshot?: string;
    healthReport: string;
    artifactPath?: string;
    settings?: OnboardingSettingsSnapshot;
    generatedAt?: number;
}): string {
    const timestamp = new Date(args.generatedAt ?? Date.now()).toISOString();
    const lines: string[] = [];
    lines.push("# TypeAgent Studio Onboarding Diagnostics Bundle");
    lines.push("");
    lines.push(`- Generated at: ${timestamp}`);
    lines.push(`- Artifact path: ${args.artifactPath ?? "unresolved"}`);
    lines.push("");
    lines.push("## Onboarding Settings");
    lines.push("");
    lines.push(
        `- Open summary after batch run: ${args.settings?.openSummaryAfterBatchRun ?? true}`,
    );
    lines.push(
        `- Default sandbox id: ${args.settings?.defaultSandboxId ?? "studio-default"}`,
    );
    lines.push(
        `- Install health gate policy: ${args.settings?.installHealthGatePolicy ?? "enforce"}`,
    );
    lines.push("");
    lines.push("## Onboarding Summary");
    lines.push("");
    lines.push(args.summary);
    lines.push("");
    if (args.healthSnapshot) {
        lines.push("## Onboarding Health Snapshot");
        lines.push("");
        lines.push(args.healthSnapshot);
        lines.push("");
    }
    lines.push("## Packaging Health Report");
    lines.push("");
    lines.push(args.healthReport);
    lines.push("");
    return lines.join("\n");
}

export function formatOnboardingSettingsSnapshot(
    settings: OnboardingSettingsSnapshot,
): string {
    return [
        "TypeAgent Studio onboarding settings",
        `Open summary after batch run: ${settings.openSummaryAfterBatchRun}`,
        `Default sandbox id: ${settings.defaultSandboxId}`,
        `Install health gate policy: ${settings.installHealthGatePolicy}`,
    ].join("\n");
}

export function formatOnboardingSettingsSnapshotMarkdown(
    settings: OnboardingSettingsSnapshot,
): string {
    return [
        "# TypeAgent Studio Onboarding Settings",
        "",
        `- Open summary after batch run: ${settings.openSummaryAfterBatchRun}`,
        `- Default sandbox id: ${settings.defaultSandboxId}`,
        `- Install health gate policy: ${settings.installHealthGatePolicy}`,
        "",
    ].join("\n");
}

export function normalizeMarkdownFileName(
    configuredValue: string,
    fallback: string,
): string {
    const trimmed = configuredValue.trim();
    if (trimmed.length === 0) {
        return fallback;
    }
    return trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
}
