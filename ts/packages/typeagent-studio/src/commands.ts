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
            async () => {
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
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.ask",
            async () => {
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
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-studio.installToSandbox",
            async () => {
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
            },
        ),
    );
}
