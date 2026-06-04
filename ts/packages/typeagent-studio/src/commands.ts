// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import type { OnboardingPhaseName } from "@typeagent/core/onboardingBridge";
import type { StudioRuntime } from "./studioRuntime.js";
import {
    formatOnboardingDiagnosticsBundle,
    formatOnboardingHealthSnapshot,
    formatOnboardingSummary,
    getAdvanceTargetPhase,
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
                    placeHolder: "Calendar integration for internal scheduling API",
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
                        error instanceof Error ? error.message : "Unknown error";
                    if (message.startsWith("Health gate failed:")) {
                        const proceed = await confirmHealthGateBypass(message);
                        if (!proceed) {
                            return;
                        }
                        installed = await runtime.installLastSessionToSandbox(
                            sandboxId,
                            { skipHealthGate: true },
                        );
                    } else if (!message.includes("No local generated agent artifact")) {
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
            "typeagent-studio.copyInstallArtifactPath",
            withErrors(async () => {
                const artifactPath =
                    await runtime.resolveInstallArtifactPathForActiveSession();
                await vscode.env.clipboard.writeText(artifactPath);
                void vscode.window.showInformationMessage(
                    "Copied resolved install artifact path to clipboard.",
                );
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

                const status = await runtime.getPhaseStatusOnActiveSession(phase);
                if (
                    status !== "pending" &&
                    !(await confirmPhaseRerun(phase, status))
                ) {
                    return;
                }

                const defaultInputs =
                    await runtime.getDefaultInputsForPhaseOnActiveSession(phase);

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
                const state = await runtime.runPhaseOnActiveSession(phase, inputs);
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
                    await runtime.getDefaultInputsForPhaseOnActiveSession(target);
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

                const result = await runtime.runRemainingPhasesOnActiveSession();
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
            "typeagent-studio.showOnboardingHealthSnapshot",
            withErrors(async () => {
                const snapshot = await getOnboardingHealthSnapshot(runtime);
                void vscode.window.showInformationMessage(
                    snapshot,
                    { modal: true },
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.copyOnboardingHealthSnapshot",
            withErrors(async () => {
                const snapshot = await getOnboardingHealthSnapshot(runtime);
                await vscode.env.clipboard.writeText(snapshot);
                void vscode.window.showInformationMessage(
                    "Copied onboarding health snapshot to clipboard.",
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.openOnboardingSummary",
            withErrors(async () => {
                await openOnboardingSummary(runtime);
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.copyOnboardingSummary",
            withErrors(async () => {
                const summary = await getOnboardingSummary(runtime);
                await vscode.env.clipboard.writeText(summary);
                void vscode.window.showInformationMessage(
                    "Copied onboarding summary to clipboard.",
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.saveOnboardingSummary",
            withErrors(async () => {
                const summary = await getOnboardingSummary(runtime);
                const targetUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file("onboarding-summary.md"),
                    filters: {
                        Markdown: ["md"],
                    },
                    title: "Save Onboarding Summary",
                });
                if (!targetUri) {
                    return;
                }

                await fs.writeFile(targetUri.fsPath, summary, "utf-8");
                void vscode.window.showInformationMessage(
                    `Saved onboarding summary to ${targetUri.fsPath}.`,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.saveOnboardingDiagnosticsBundle",
            withErrors(async () => {
                const content = await getOnboardingDiagnosticsBundle(runtime);
                const defaultFileName = getDiagnosticsDefaultFileName();

                const targetUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(defaultFileName),
                    filters: {
                        Markdown: ["md"],
                    },
                    title: "Save Onboarding Diagnostics Bundle",
                });
                if (!targetUri) {
                    return;
                }

                await fs.writeFile(targetUri.fsPath, content, "utf-8");
                void vscode.window.showInformationMessage(
                    `Saved onboarding diagnostics bundle to ${targetUri.fsPath}.`,
                );
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.openOnboardingDiagnosticsBundle",
            withErrors(async () => {
                const content = await getOnboardingDiagnosticsBundle(runtime);
                const doc = await vscode.workspace.openTextDocument({
                    language: "markdown",
                    content,
                });
                await vscode.window.showTextDocument(doc, {
                    preview: false,
                });
            }),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.copyOnboardingDiagnosticsBundle",
            withErrors(async () => {
                const content = await getOnboardingDiagnosticsBundle(runtime);
                await vscode.env.clipboard.writeText(content);
                void vscode.window.showInformationMessage(
                    "Copied onboarding diagnostics bundle to clipboard.",
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

                const restored = await runtime.restorePhaseOnActiveSession(phase);
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
                        const rerunResult = await runtime.rerunPhasesOnActiveSession(
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
                const stalePhases = await runtime.listStalePhasesOnActiveSession();

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
                const rerunResult = await runtime.rerunPhasesOnActiveSession(
                    rerunPhases,
                );

                void vscode.window.showInformationMessage(
                    `Reran phases: ${rerunResult.rerunPhases.join(", ")}. Current phase: ${rerunResult.state.currentPhase}.`,
                );

                if (rerunResult.rerunPhases.includes("Packaging")) {
                    await showPackagingHealthGateStatus(runtime);
                }
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
        .get<string>(
            "diagnosticsDefaultFileName",
            "onboarding-diagnostics.md",
        )
        .trim();
    if (configured.length === 0) {
        return "onboarding-diagnostics.md";
    }
    return configured.toLowerCase().endsWith(".md")
        ? configured
        : `${configured}.md`;
}

type InstallHealthGatePolicy = "enforce" | "warn";

function getInstallHealthGatePolicy(): InstallHealthGatePolicy {
    return vscode.workspace
        .getConfiguration("typeagentStudio.onboarding")
        .get<InstallHealthGatePolicy>("installHealthGatePolicy", "enforce");
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

async function getOnboardingDiagnosticsBundle(
    runtime: StudioRuntime,
): Promise<string> {
    const summary = await getOnboardingSummary(runtime);
    const healthReport = await getPackagingHealthReport(runtime);

    let artifactPath: string | undefined;
    try {
        artifactPath = await runtime.resolveInstallArtifactPathForActiveSession();
    } catch {
        artifactPath = undefined;
    }

    return formatOnboardingDiagnosticsBundle({
        summary,
        healthReport,
        artifactPath,
        settings: {
            openSummaryAfterBatchRun: shouldOpenSummaryAfterBatchRun(),
            defaultSandboxId: getDefaultSandboxId(),
            installHealthGatePolicy: getInstallHealthGatePolicy(),
        },
    });
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

async function openPackagingHealthReport(runtime: StudioRuntime): Promise<void> {
    const content = await getPackagingHealthReport(runtime);
    const doc = await vscode.workspace.openTextDocument({
        language: "markdown",
        content,
    });
    await vscode.window.showTextDocument(doc, {
        preview: false,
    });
}

async function getPackagingHealthReport(runtime: StudioRuntime): Promise<string> {
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
        lines.push(`- [${finding.severity}] ${finding.ruleId}: ${finding.evidence.message}`);
    }

    return lines.join("\n");
}

