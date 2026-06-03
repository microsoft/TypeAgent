// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import type { OnboardingPhaseName } from "@typeagent/core/onboardingBridge";
import type { StudioRuntime } from "./studioRuntime.js";
import {
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
                const sandboxId =
                    (await vscode.window.showInputBox({
                        title: "Install to Sandbox",
                        prompt: "Sandbox id",
                        value: "studio-default",
                        ignoreFocusOut: true,
                    })) ?? "studio-default";

                let installed: Awaited<
                    ReturnType<StudioRuntime["installLastSessionToSandbox"]>
                >;
                try {
                    installed = await runtime.installLastSessionToSandbox(
                        sandboxId,
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

