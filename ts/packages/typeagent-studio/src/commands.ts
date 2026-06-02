// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { StudioRuntime } from "./studioRuntime.js";

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

                const sessionId = await runtime.installLastSessionToSandbox(
                    sandboxId,
                );
                void vscode.window.showInformationMessage(
                    `Installed onboarding session ${sessionId} into sandbox ${sandboxId}.`,
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

                const rawInputs = await vscode.window.showInputBox({
                    title: "Run Onboarding Phase",
                    prompt: "Optional JSON inputs for phase execution",
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
            "typeagent-studio.runRemainingOnboardingPhases",
            withErrors(async () => {
                const result = await runtime.runRemainingPhasesOnActiveSession();
                const completed =
                    result.completedPhases.length > 0
                        ? result.completedPhases.join(", ")
                        : "none";
                void vscode.window.showInformationMessage(
                    `Completed phases: ${completed}. Current phase: ${result.state.currentPhase}.`,
                );
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
                const state = await runtime.getActiveOnboardingSession();
                const doc = await vscode.workspace.openTextDocument({
                    language: "markdown",
                    content: formatOnboardingSummary(state),
                });
                await vscode.window.showTextDocument(doc, {
                    preview: false,
                });
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
): Promise<string | undefined> {
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

function formatOnboardingSummary(state: {
    sessionId: string;
    agentName: string;
    description: string;
    currentPhase: string;
    phases: Partial<
        Record<
            string,
            {
                status: string;
                startedAt?: number;
                completedAt?: number;
            }
        >
    >;
    installedSandboxIds?: string[];
}): string {
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

    for (const [phase, snapshot] of Object.entries(state.phases)) {
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
