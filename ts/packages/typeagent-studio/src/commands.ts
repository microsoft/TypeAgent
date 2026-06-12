// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import type { OnboardingPhaseName } from "@typeagent/core/onboardingBridge";
import type { StudioRuntime } from "./studioRuntime.js";
import { StudioServiceClient } from "./studioServiceClient.js";
import {
    formatOnboardingDiagnosticsBundle,
    formatOnboardingHealthSnapshotMarkdown,
    formatOnboardingHealthSnapshot,
    formatOnboardingSettingsSnapshotMarkdown,
    formatOnboardingSettingsSnapshot,
    type OnboardingSettingsSnapshot,
    formatOnboardingSummary,
    getAdvanceTargetPhase,
    normalizeMarkdownFileName,
} from "./onboardingPresentation.js";

export function registerStudioCommands(
    context: vscode.ExtensionContext,
    runtime: StudioRuntime,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.startOnboardingSession",
            withErrors(async () => {
                const description = await vscode.window.showInputBox({
                    title: "Start Onboarding Session",
                    prompt: "Describe the integration to onboard",
                    placeHolder:
                        "Calendar integration for internal scheduling API",
                    ignoreFocusOut: true,
                });
                if (!description) {
                    return;
                }
                const agentName = await vscode.window.showInputBox({
                    title: "Optional Agent Name",
                    prompt: "Agent package name (optional)",
                    placeHolder: "calendar-enterprise",
                    ignoreFocusOut: true,
                });

                const state = await runtime.startOnboarding({
                    description,
                    ...(agentName ? { agentName } : {}),
                });
                void vscode.window.showInformationMessage(
                    `Started onboarding session ${state.sessionId} for ${state.agentName} (phase: ${state.currentPhase}).`,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.ask",
            withErrors(async () => {
                const prompt = await vscode.window.showInputBox({
                    title: "Ask TypeAgent About This",
                    prompt: "Enter your request",
                    placeHolder: "Create a new agent for my Jira workflow",
                    ignoreFocusOut: true,
                });
                if (!prompt) {
                    return;
                }
                const route = runtime.routeConversation(prompt);
                void vscode.window.showInformationMessage(
                    `Routed to ${route.target} (${route.reason}).`,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.installToSandbox",
            withErrors(async () => {
                const defaultSandboxId = getDefaultSandboxId();
                const sandboxId =
                    (await vscode.window.showInputBox({
                        title: "Install to Sandbox",
                        prompt: "Sandbox id",
                        value: defaultSandboxId,
                        ignoreFocusOut: true,
                    })) ?? defaultSandboxId;

                let installed: Awaited<
                    ReturnType<StudioRuntime["installLastSessionToSandbox"]>
                >;
                const installPolicy = getInstallHealthGatePolicy();
                try {
                    installed = await runtime.installLastSessionToSandbox(
                        sandboxId,
                        {
                            skipHealthGate: installPolicy === "warn",
                        },
                    );
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : "Unknown error";
                    if (message.startsWith("Health gate failed:")) {
                        const proceed = await confirmHealthGateBypass(message);
                        if (!proceed) {
                            return;
                        }
                        installed = await runtime.installLastSessionToSandbox(
                            sandboxId,
                            { skipHealthGate: true },
                        );
                    } else if (
                        !message.includes("No local generated agent artifact")
                    ) {
                        throw error;
                    } else {
                        const fallbackUri = await vscode.window.showOpenDialog({
                            title: "Select local agent artifact to install",
                            canSelectFiles: true,
                            canSelectFolders: true,
                            canSelectMany: false,
                            openLabel: "Install",
                        });
                        if (!fallbackUri || fallbackUri.length === 0) {
                            return;
                        }

                        installed = await runtime.installArtifactToSandbox(
                            fallbackUri[0].fsPath,
                            sandboxId,
                        );
                    }
                }
                void vscode.window.showInformationMessage(
                    `Installed onboarding session ${installed.sessionId} from ${installed.artifactPath} into sandbox ${sandboxId}.`,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.resolveInstallArtifactPath",
            withErrors(async () => {
                const artifactPath =
                    await runtime.resolveInstallArtifactPathForActiveSession();
                const copyPath = "Copy path";
                const reveal = "Reveal in OS";

                const choice = await vscode.window.showInformationMessage(
                    `Resolved install artifact path: ${artifactPath}`,
                    copyPath,
                    reveal,
                );

                if (choice === copyPath) {
                    await vscode.env.clipboard.writeText(artifactPath);
                    void vscode.window.showInformationMessage(
                        "Copied artifact path to clipboard.",
                    );
                    return;
                }

                if (choice === reveal) {
                    await vscode.commands.executeCommand(
                        "revealFileInOS",
                        vscode.Uri.file(artifactPath),
                    );
                }
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.checkPackagingHealthGate",
            withErrors(async () => {
                const gate =
                    await runtime.evaluatePackagingHealthGateForActiveSession();
                const findingSummary =
                    gate.findings.length > 0
                        ? `${gate.findings.length} findings`
                        : "no findings";
                void vscode.window.showInformationMessage(
                    `Health gate ${gate.status}: ${gate.summary} (${findingSummary}).`,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.enforcePackagingHealthGate",
            withErrors(async () => {
                const gate =
                    await runtime.enforcePackagingHealthGateForActiveSession();
                void vscode.window.showInformationMessage(
                    `Packaging health gate ${gate.status}: ${gate.summary}`,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.openPackagingHealthReport",
            withErrors(async () => {
                await openPackagingHealthReport(runtime);
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.copyPackagingHealthReport",
            withErrors(async () => {
                const report = await getPackagingHealthReport(runtime);
                await vscode.env.clipboard.writeText(report);
                void vscode.window.showInformationMessage(
                    "Copied packaging health report to clipboard.",
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.savePackagingHealthReport",
            withErrors(async () => {
                const report = await getPackagingHealthReport(runtime);
                const defaultFileName =
                    getPackagingHealthReportDefaultFileName();
                const targetUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(defaultFileName),
                    filters: {
                        Markdown: ["md"],
                    },
                    title: "Save Packaging Health Report",
                });
                if (!targetUri) {
                    return;
                }

                await fs.writeFile(targetUri.fsPath, report, "utf-8");
                void vscode.window.showInformationMessage(
                    `Saved packaging health report to ${targetUri.fsPath}.`,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.clearOnboardingSession",
            withErrors(async () => {
                if (!(await confirmSessionClear())) {
                    return;
                }

                await runtime.clearActiveOnboardingSession();
                void vscode.window.showInformationMessage(
                    "Cleared the active onboarding session.",
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.runOnboardingPhase",
            withErrors(async () => {
                const phase = await selectPhase(runtime);
                if (!phase) {
                    return;
                }

                const status =
                    await runtime.getPhaseStatusOnActiveSession(phase);
                if (
                    status !== "pending" &&
                    !(await confirmPhaseRerun(phase, status))
                ) {
                    return;
                }

                const defaultInputs =
                    await runtime.getDefaultInputsForPhaseOnActiveSession(
                        phase,
                    );

                const rawInputs = await vscode.window.showInputBox({
                    title: "Run Onboarding Phase",
                    prompt: "Optional JSON inputs for phase execution",
                    value: JSON.stringify(defaultInputs, null, 2),
                    placeHolder: '{"notes":"Use the existing CRM API spec"}',
                    ignoreFocusOut: true,
                });
                if (rawInputs === undefined) {
                    return;
                }

                const inputs = parseJsonInputs(rawInputs);
                const state = await runtime.runPhaseOnActiveSession(
                    phase,
                    inputs,
                );
                void vscode.window.showInformationMessage(
                    `Phase ${phase} completed. Current phase is now ${state.currentPhase}.`,
                );
                if (phase === "Packaging") {
                    await showPackagingHealthGateStatus(runtime);
                }
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.advanceOnboardingPhase",
            withErrors(async () => {
                const state = await runtime.getActiveOnboardingSession();
                const target = getAdvanceTargetPhase(
                    runtime.listPhases(),
                    state.currentPhase,
                    state.phases,
                );
                if (!target) {
                    void vscode.window.showInformationMessage(
                        "All onboarding phases are complete.",
                    );
                    return;
                }

                const targetStatus = state.phases[target]?.status ?? "pending";
                if (
                    targetStatus !== "pending" &&
                    !(await confirmPhaseRerun(target, targetStatus))
                ) {
                    return;
                }

                const defaultInputs =
                    await runtime.getDefaultInputsForPhaseOnActiveSession(
                        target,
                    );
                const nextState = await runtime.runPhaseOnActiveSession(
                    target,
                    defaultInputs,
                );
                void vscode.window.showInformationMessage(
                    `Advanced onboarding by running ${target}. Current phase is ${nextState.currentPhase}.`,
                );
                if (target === "Packaging") {
                    await showPackagingHealthGateStatus(runtime);
                }
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.runRemainingOnboardingPhases",
            withErrors(async () => {
                const state = await runtime.getActiveOnboardingSession();
                const reruns = runtime
                    .listPhases()
                    .map((phase) => ({
                        phase,
                        status: state.phases[phase]?.status ?? "pending",
                    }))
                    .filter(
                        (entry) =>
                            entry.status !== "pending" &&
                            entry.status !== "complete",
                    );

                if (
                    reruns.length > 0 &&
                    !(await confirmBatchRerun(
                        reruns.map((r) => `${r.phase}:${r.status}`),
                    ))
                ) {
                    return;
                }

                const result =
                    await runtime.runRemainingPhasesOnActiveSession();
                const completed =
                    result.completedPhases.length > 0
                        ? result.completedPhases.join(", ")
                        : "none";
                void vscode.window.showInformationMessage(
                    `Completed phases: ${completed}. Current phase: ${result.state.currentPhase}.`,
                );

                if (shouldOpenSummaryAfterBatchRun()) {
                    await openOnboardingSummary(runtime);
                }

                if (result.completedPhases.includes("Packaging")) {
                    await showPackagingHealthGateStatus(runtime);
                }
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.showOnboardingSnapshot",
            withErrors(async () => {
                const state = await runtime.getActiveOnboardingSession();
                const completeCount = Object.values(state.phases).filter(
                    (p) => p?.status === "complete",
                ).length;
                const staleCount = Object.values(state.phases).filter(
                    (p) => p?.status === "stale",
                ).length;

                void vscode.window.showInformationMessage(
                    `Session ${state.sessionId}: current=${state.currentPhase}, complete=${completeCount}, stale=${staleCount}.`,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.exportOnboardingArtifact",
            withErrors(async () => {
                const artifacts = getExportArtifacts();
                const pickedArtifact = await vscode.window.showQuickPick(
                    artifacts.map((artifact) => ({
                        label: artifact.label,
                        detail: artifact.detail,
                        id: artifact.id,
                    })),
                    {
                        title: "Export Onboarding Artifact",
                        placeHolder: "Select an artifact to export",
                        ignoreFocusOut: true,
                    },
                );
                if (!pickedArtifact) {
                    return;
                }
                const artifact = artifacts.find(
                    (entry) => entry.id === pickedArtifact.id,
                );
                if (!artifact) {
                    return;
                }

                const destination = await vscode.window.showQuickPick(
                    [
                        {
                            label: "Show",
                            detail: "Display in a modal notification",
                            id: "show" as ExportDestination,
                        },
                        {
                            label: "Open in editor",
                            detail: "Open as a Markdown document",
                            id: "open" as ExportDestination,
                        },
                        {
                            label: "Copy to clipboard",
                            detail: "Copy Markdown to the clipboard",
                            id: "copy" as ExportDestination,
                        },
                        {
                            label: "Save to file",
                            detail: "Write Markdown to a file",
                            id: "save" as ExportDestination,
                        },
                    ],
                    {
                        title: `Export ${artifact.label}`,
                        placeHolder: "Select a destination",
                        ignoreFocusOut: true,
                    },
                );
                if (!destination) {
                    return;
                }

                await exportOnboardingArtifact(
                    runtime,
                    artifact,
                    destination.id,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.toggleBatchRunSummaryAutoOpen",
            withErrors(async () => {
                const current = shouldOpenSummaryAfterBatchRun();
                await vscode.workspace
                    .getConfiguration("typeagentStudio.onboarding")
                    .update(
                        "openSummaryAfterBatchRun",
                        !current,
                        vscode.ConfigurationTarget.Global,
                    );
                void vscode.window.showInformationMessage(
                    `Open summary after batch run is now ${!current ? "enabled" : "disabled"}.`,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.cycleInstallHealthGatePolicy",
            withErrors(async () => {
                const current = getInstallHealthGatePolicy();
                const next: InstallHealthGatePolicy =
                    current === "enforce" ? "warn" : "enforce";

                await vscode.workspace
                    .getConfiguration("typeagentStudio.onboarding")
                    .update(
                        "installHealthGatePolicy",
                        next,
                        vscode.ConfigurationTarget.Global,
                    );

                void vscode.window.showInformationMessage(
                    `Install health gate policy is now ${next}.`,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.setInstallHealthGatePolicy",
            withErrors(async () => {
                const selection = await vscode.window.showQuickPick(
                    ["enforce", "warn"],
                    {
                        title: "Install health gate policy",
                        placeHolder: "Select policy",
                        ignoreFocusOut: true,
                    },
                );
                if (!selection) {
                    return;
                }

                await vscode.workspace
                    .getConfiguration("typeagentStudio.onboarding")
                    .update(
                        "installHealthGatePolicy",
                        selection,
                        vscode.ConfigurationTarget.Global,
                    );

                void vscode.window.showInformationMessage(
                    `Install health gate policy set to ${selection}.`,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.restoreOnboardingPhase",
            withErrors(async () => {
                const phase = await selectPhase(runtime);
                if (!phase) {
                    return;
                }

                const restored =
                    await runtime.restorePhaseOnActiveSession(phase);
                const affected =
                    restored.affectedDownstream.length > 0
                        ? restored.affectedDownstream.join(", ")
                        : "none";
                void vscode.window.showInformationMessage(
                    `Restored ${phase}. Stale downstream phases: ${affected}.`,
                );

                if (restored.affectedDownstream.length > 0) {
                    const rerun = await confirmReconciliationRun(
                        restored.affectedDownstream,
                    );
                    if (rerun) {
                        const rerunResult =
                            await runtime.rerunPhasesOnActiveSession(
                                restored.affectedDownstream,
                            );
                        void vscode.window.showInformationMessage(
                            `Reconciled phases: ${rerunResult.rerunPhases.join(", ")}. Current phase: ${rerunResult.state.currentPhase}.`,
                        );

                        if (rerunResult.rerunPhases.includes("Packaging")) {
                            await showPackagingHealthGateStatus(runtime);
                        }
                    }
                }
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.rerunStaleOnboardingPhases",
            withErrors(async () => {
                const stalePhases =
                    await runtime.listStalePhasesOnActiveSession();

                if (stalePhases.length === 0) {
                    void vscode.window.showInformationMessage(
                        "No stale onboarding phases to rerun.",
                    );
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    stalePhases.map((phase) => ({
                        label: phase,
                        description: "stale",
                        picked: true,
                    })),
                    {
                        title: "Rerun stale onboarding phases",
                        placeHolder: "Select phases to rerun",
                        canPickMany: true,
                        ignoreFocusOut: true,
                    },
                );

                if (!selected || selected.length === 0) {
                    return;
                }

                const rerunPhases = selected.map(
                    (item) => item.label as OnboardingPhaseName,
                );
                const rerunResult =
                    await runtime.rerunPhasesOnActiveSession(rerunPhases);

                void vscode.window.showInformationMessage(
                    `Reran phases: ${rerunResult.rerunPhases.join(", ")}. Current phase: ${rerunResult.state.currentPhase}.`,
                );

                if (rerunResult.rerunPhases.includes("Packaging")) {
                    await showPackagingHealthGateStatus(runtime);
                }
            }),
        ),
    );

    // Connect to the `studio` agent's service channel and show its info + a
    // live event stream. This drives the agent's runtime over the agent-server
    // (the Option B path) rather than the extension's in-process runtime — a
    // proof of the typed channel end-to-end. Degrades gracefully when no
    // agent-server is running.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.connectStudioService",
            withErrors(async () => {
                const channel = vscode.window.createOutputChannel(
                    "TypeAgent Studio Service",
                );
                context.subscriptions.push(channel);
                channel.show(true);
                channel.appendLine("Discovering the studio agent service…");

                const repoRoot = runtime.getRepoRootInfo().repoRoot;
                const client = await StudioServiceClient.connect({
                    repoRoot,
                    onEvent: (event) =>
                        channel.appendLine(
                            `event · ${event.type} @ ${new Date(event.ts).toISOString()}`,
                        ),
                });
                if (client === undefined) {
                    channel.appendLine(
                        "Not connected: no studio service found. Start an agent-server with the studio agent enabled, then retry.",
                    );
                    void vscode.window.showWarningMessage(
                        "TypeAgent Studio service not found — start an agent-server with the studio agent enabled.",
                    );
                    return;
                }
                // Keep the connection open to stream events; close on deactivate.
                context.subscriptions.push({ dispose: () => client.close() });

                const info = await client.getStudioInfo();
                const total = info.agentLocations.reduce(
                    (n, l) => n + l.agentCount,
                    0,
                );
                channel.appendLine(
                    `Connected. Repo root: ${info.repoRootInfo.repoRoot}`,
                );
                for (const loc of info.agentLocations) {
                    channel.appendLine(
                        `  ${loc.exists ? "✓" : "✗"} ${loc.root} — ${loc.agentCount} agent(s)`,
                    );
                }
                await client.subscribeEvents();
                channel.appendLine("Subscribed to live studio events.");
                void vscode.window.showInformationMessage(
                    `Connected to the studio service (${total} agents discovered).`,
                );
            }),
        ),
    );
}

async function confirmHealthGateBypass(message: string): Promise<boolean> {
    const installAnyway = "Install anyway";
    const choice = await vscode.window.showWarningMessage(
        `${message} Install into sandbox anyway?`,
        { modal: true },
        installAnyway,
    );
    return choice === installAnyway;
}

async function confirmReconciliationRun(
    stalePhases: readonly OnboardingPhaseName[],
): Promise<boolean> {
    const rerun = "Rerun stale phases";
    const choice = await vscode.window.showWarningMessage(
        `Downstream phases are stale (${stalePhases.join(", ")}). Re-run them now to reconcile?`,
        { modal: true },
        rerun,
    );
    return choice === rerun;
}

function withErrors<TArgs extends unknown[]>(
    action: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => Promise<void> {
    return async (...args: TArgs) => {
        try {
            await action(...args);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Unknown error";
            void vscode.window.showErrorMessage(message);
        }
    };
}

async function selectPhase(
    runtime: StudioRuntime,
): Promise<OnboardingPhaseName | undefined> {
    return vscode.window.showQuickPick(runtime.listPhases(), {
        title: "Onboarding Phase",
        placeHolder: "Select a phase",
        ignoreFocusOut: true,
    });
}

function parseJsonInputs(rawInputs: string): unknown {
    const trimmed = rawInputs.trim();
    if (!trimmed) {
        return {};
    }
    try {
        return JSON.parse(trimmed) as unknown;
    } catch {
        throw new Error("Phase inputs must be valid JSON.");
    }
}

async function confirmPhaseRerun(
    phase: string,
    status: string,
): Promise<boolean> {
    const runAnyway = "Run anyway";
    const choice = await vscode.window.showWarningMessage(
        `Phase ${phase} is currently ${status}. Running it again may replace prior outputs.`,
        { modal: true },
        runAnyway,
    );
    return choice === runAnyway;
}

async function confirmBatchRerun(phases: string[]): Promise<boolean> {
    const runAnyway = "Run anyway";
    const choice = await vscode.window.showWarningMessage(
        `Some phases are not pending and will be rerun: ${phases.join(", ")}.`,
        { modal: true },
        runAnyway,
    );
    return choice === runAnyway;
}

async function confirmSessionClear(): Promise<boolean> {
    const clearSession = "Clear session";
    const choice = await vscode.window.showWarningMessage(
        "Clear the active onboarding session reference? Existing session data will no longer be attached to Studio commands until you start a new session.",
        { modal: true },
        clearSession,
    );
    return choice === clearSession;
}

function shouldOpenSummaryAfterBatchRun(): boolean {
    return vscode.workspace
        .getConfiguration("typeagentStudio.onboarding")
        .get<boolean>("openSummaryAfterBatchRun", true);
}

function getDefaultSandboxId(): string {
    const configured = vscode.workspace
        .getConfiguration("typeagentStudio.onboarding")
        .get<string>("defaultSandboxId", "studio-default")
        .trim();
    return configured.length > 0 ? configured : "studio-default";
}

function getDiagnosticsDefaultFileName(): string {
    const configured = vscode.workspace
        .getConfiguration("typeagentStudio.onboarding")
        .get<string>("diagnosticsDefaultFileName", "onboarding-diagnostics.md");
    return normalizeMarkdownFileName(configured, "onboarding-diagnostics.md");
}

function getSettingsSnapshotDefaultFileName(): string {
    const configured = vscode.workspace
        .getConfiguration("typeagentStudio.onboarding")
        .get<string>(
            "settingsSnapshotDefaultFileName",
            "onboarding-settings.md",
        );
    return normalizeMarkdownFileName(configured, "onboarding-settings.md");
}

function getPackagingHealthReportDefaultFileName(): string {
    const configured = vscode.workspace
        .getConfiguration("typeagentStudio.onboarding")
        .get<string>(
            "packagingHealthReportDefaultFileName",
            "packaging-health-report.md",
        );
    return normalizeMarkdownFileName(configured, "packaging-health-report.md");
}

function getOnboardingSummaryDefaultFileName(): string {
    const configured = vscode.workspace
        .getConfiguration("typeagentStudio.onboarding")
        .get<string>(
            "onboardingSummaryDefaultFileName",
            "onboarding-summary.md",
        );
    return normalizeMarkdownFileName(configured, "onboarding-summary.md");
}

function getOnboardingHealthSnapshotDefaultFileName(): string {
    const configured = vscode.workspace
        .getConfiguration("typeagentStudio.onboarding")
        .get<string>(
            "onboardingHealthSnapshotDefaultFileName",
            "onboarding-health-snapshot.md",
        );
    return normalizeMarkdownFileName(
        configured,
        "onboarding-health-snapshot.md",
    );
}

type InstallHealthGatePolicy = "enforce" | "warn";

function getInstallHealthGatePolicy(): InstallHealthGatePolicy {
    return vscode.workspace
        .getConfiguration("typeagentStudio.onboarding")
        .get<InstallHealthGatePolicy>("installHealthGatePolicy", "enforce");
}

type ExportDestination = "show" | "open" | "copy" | "save";

interface ExportArtifact {
    id: string;
    label: string;
    detail: string;
    saveTitle: string;
    defaultFileName: () => string;
    getContent: (
        runtime: StudioRuntime,
        format: "plain" | "markdown",
    ) => Promise<string>;
}

function getExportArtifacts(): ExportArtifact[] {
    return [
        {
            id: "summary",
            label: "Onboarding Summary",
            detail: "Phase-by-phase onboarding status",
            saveTitle: "Save Onboarding Summary",
            defaultFileName: getOnboardingSummaryDefaultFileName,
            getContent: (runtime) => getOnboardingSummary(runtime),
        },
        {
            id: "health",
            label: "Health Snapshot",
            detail: "Session health and packaging gate status",
            saveTitle: "Save Onboarding Health Snapshot",
            defaultFileName: getOnboardingHealthSnapshotDefaultFileName,
            getContent: (runtime, format) =>
                format === "markdown"
                    ? getOnboardingHealthSnapshotMarkdown(runtime)
                    : getOnboardingHealthSnapshot(runtime),
        },
        {
            id: "settings",
            label: "Settings Snapshot",
            detail: "Current Studio onboarding settings",
            saveTitle: "Save Onboarding Settings Snapshot",
            defaultFileName: getSettingsSnapshotDefaultFileName,
            getContent: (_runtime, format) =>
                Promise.resolve(
                    format === "markdown"
                        ? getOnboardingSettingsSnapshotMarkdown()
                        : formatOnboardingSettingsSnapshot(
                              getOnboardingSettingsSnapshot(),
                          ),
                ),
        },
        {
            id: "packaging",
            label: "Packaging Health Report",
            detail: "Detailed packaging gate findings",
            saveTitle: "Save Packaging Health Report",
            defaultFileName: getPackagingHealthReportDefaultFileName,
            getContent: (runtime) => getPackagingHealthReport(runtime),
        },
        {
            id: "diagnostics",
            label: "Diagnostics Bundle",
            detail: "Combined summary, health, settings, and artifact info",
            saveTitle: "Save Onboarding Diagnostics Bundle",
            defaultFileName: getDiagnosticsDefaultFileName,
            getContent: (runtime) => getOnboardingDiagnosticsBundle(runtime),
        },
    ];
}

async function exportOnboardingArtifact(
    runtime: StudioRuntime,
    artifact: ExportArtifact,
    destination: ExportDestination,
): Promise<void> {
    if (destination === "show") {
        const content = await artifact.getContent(runtime, "plain");
        void vscode.window.showInformationMessage(content, { modal: true });
        return;
    }

    const content = await artifact.getContent(runtime, "markdown");

    if (destination === "open") {
        const doc = await vscode.workspace.openTextDocument({
            language: "markdown",
            content,
        });
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
    }

    if (destination === "copy") {
        await vscode.env.clipboard.writeText(content);
        void vscode.window.showInformationMessage(
            `Copied ${artifact.label} to clipboard.`,
        );
        return;
    }

    const targetUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(artifact.defaultFileName()),
        filters: {
            Markdown: ["md"],
        },
        title: artifact.saveTitle,
    });
    if (!targetUri) {
        return;
    }

    await fs.writeFile(targetUri.fsPath, content, "utf-8");
    void vscode.window.showInformationMessage(
        `Saved ${artifact.label} to ${targetUri.fsPath}.`,
    );
}

async function openOnboardingSummary(runtime: StudioRuntime): Promise<void> {
    const summary = await getOnboardingSummary(runtime);
    const doc = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: summary,
    });
    await vscode.window.showTextDocument(doc, {
        preview: false,
    });
}

async function getOnboardingSummary(runtime: StudioRuntime): Promise<string> {
    const state = await runtime.getActiveOnboardingSession();
    return formatOnboardingSummary(state);
}

async function getOnboardingHealthSnapshot(
    runtime: StudioRuntime,
): Promise<string> {
    const state = await runtime.getActiveOnboardingSession();
    let gate:
        | Awaited<
              ReturnType<
                  StudioRuntime["evaluatePackagingHealthGateForActiveSession"]
              >
          >
        | undefined;
    try {
        gate = await runtime.evaluatePackagingHealthGateForActiveSession();
    } catch {
        gate = undefined;
    }

    return formatOnboardingHealthSnapshot(state, gate);
}

async function getOnboardingHealthSnapshotMarkdown(
    runtime: StudioRuntime,
): Promise<string> {
    const state = await runtime.getActiveOnboardingSession();
    let gate:
        | Awaited<
              ReturnType<
                  StudioRuntime["evaluatePackagingHealthGateForActiveSession"]
              >
          >
        | undefined;
    try {
        gate = await runtime.evaluatePackagingHealthGateForActiveSession();
    } catch {
        gate = undefined;
    }

    return formatOnboardingHealthSnapshotMarkdown(state, gate);
}

async function getOnboardingDiagnosticsBundle(
    runtime: StudioRuntime,
): Promise<string> {
    const summary = await getOnboardingSummary(runtime);
    const healthSnapshot = await getOnboardingHealthSnapshot(runtime);
    const healthReport = await getPackagingHealthReport(runtime);

    let artifactPath: string | undefined;
    try {
        artifactPath =
            await runtime.resolveInstallArtifactPathForActiveSession();
    } catch {
        artifactPath = undefined;
    }

    return formatOnboardingDiagnosticsBundle({
        summary,
        healthSnapshot,
        healthReport,
        artifactPath,
        settings: getOnboardingSettingsSnapshot(),
    });
}

function getOnboardingSettingsSnapshot(): OnboardingSettingsSnapshot {
    return {
        openSummaryAfterBatchRun: shouldOpenSummaryAfterBatchRun(),
        defaultSandboxId: getDefaultSandboxId(),
        installHealthGatePolicy: getInstallHealthGatePolicy(),
    };
}

function getOnboardingSettingsSnapshotMarkdown(): string {
    return formatOnboardingSettingsSnapshotMarkdown(
        getOnboardingSettingsSnapshot(),
    );
}

async function showPackagingHealthGateStatus(
    runtime: StudioRuntime,
): Promise<void> {
    const gate = await runtime.evaluatePackagingHealthGateForActiveSession();
    const message = `Packaging health gate ${gate.status}: ${gate.summary}`;

    if (gate.status === "fail") {
        const openReport = "Open report";
        const restoreTesting = "Restore to Testing";
        const choice = await vscode.window.showWarningMessage(
            message,
            openReport,
            restoreTesting,
        );
        if (choice === openReport) {
            await openPackagingHealthReport(runtime);
        }
        if (choice === restoreTesting) {
            await runtime.restorePhaseOnActiveSession("Testing");
            void vscode.window.showInformationMessage(
                "Restored onboarding to Testing. Packaging is now stale and can be re-run.",
            );
        }
        return;
    }

    void vscode.window.showInformationMessage(message);
}

async function openPackagingHealthReport(
    runtime: StudioRuntime,
): Promise<void> {
    const content = await getPackagingHealthReport(runtime);
    const doc = await vscode.workspace.openTextDocument({
        language: "markdown",
        content,
    });
    await vscode.window.showTextDocument(doc, {
        preview: false,
    });
}

async function getPackagingHealthReport(
    runtime: StudioRuntime,
): Promise<string> {
    const gate = await runtime.evaluatePackagingHealthGateForActiveSession();
    return formatPackagingHealthReport(gate);
}

function formatPackagingHealthReport(
    gate: Awaited<ReturnType<StudioRuntime["checkPackagingHealthGate"]>>,
): string {
    const lines: string[] = [];
    lines.push("# TypeAgent Studio Packaging Health Report");
    lines.push("");
    lines.push(`- Status: ${gate.status}`);
    lines.push(`- Summary: ${gate.summary}`);
    lines.push(`- Artifact path: ${gate.artifactPath}`);
    if (gate.checkedAgent) {
        lines.push(`- Agent: ${gate.checkedAgent}`);
    }
    lines.push("");
    lines.push("## Findings");
    lines.push("");

    if (gate.findings.length === 0) {
        lines.push("No findings.");
        return lines.join("\n");
    }

    for (const finding of gate.findings) {
        lines.push(
            `- [${finding.severity}] ${finding.ruleId}: ${finding.evidence.message}`,
        );
    }

    return lines.join("\n");
}
