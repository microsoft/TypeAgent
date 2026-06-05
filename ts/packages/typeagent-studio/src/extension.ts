// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { VERSION } from "@typeagent/core";
import { registerStudioCommands } from "./commands.js";
import { createStudioRuntime } from "./studioRuntime.js";
import { SANDBOX_VIEW_ID, SandboxTreeProvider } from "./sandboxTreeProvider.js";
import type { SandboxTreeNode } from "./sandboxTreePresentation.js";
import { CORPUS_VIEW_ID, CorpusTreeProvider } from "./corpusTreeProvider.js";
import {
    STUDIO_STATUS_BAR_COMMAND,
    StudioStatusBar,
} from "./studioStatusBar.js";
import {
    EVENT_LOG_VIEW_ID,
    EventLogTreeProvider,
} from "./eventLogTreeProvider.js";

export function activate(context: vscode.ExtensionContext): void {
    const runtime = createStudioRuntime(context);

    registerStudioCommands(context, runtime);

    const sandboxTree = new SandboxTreeProvider(runtime);
    context.subscriptions.push(
        sandboxTree,
        vscode.window.registerTreeDataProvider(SANDBOX_VIEW_ID, sandboxTree),
        vscode.commands.registerCommand(
            "typeagent-studio.refreshSandboxes",
            () => sandboxTree.refresh(),
        ),
        vscode.commands.registerCommand(
            "typeagent-studio.startSandbox",
            async (node?: SandboxTreeNode) => {
                try {
                    const status = await runtime.startSandbox(
                        node?.sandboxId ? { id: node.sandboxId } : undefined,
                    );
                    vscode.window.showInformationMessage(
                        `Sandbox '${status.id}' started.`,
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to start sandbox: ${describeError(error)}`,
                    );
                }
            },
        ),
        vscode.commands.registerCommand(
            "typeagent-studio.stopSandbox",
            async (node?: SandboxTreeNode) => {
                const id = await resolveSandboxId(runtime, node);
                if (!id) {
                    return;
                }
                try {
                    await runtime.stopSandbox(id);
                    vscode.window.showInformationMessage(
                        `Sandbox '${id}' stopped.`,
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to stop sandbox: ${describeError(error)}`,
                    );
                }
            },
        ),
        vscode.commands.registerCommand(
            "typeagent-studio.restartSandbox",
            async (node?: SandboxTreeNode) => {
                const id = await resolveSandboxId(runtime, node);
                if (!id) {
                    return;
                }
                try {
                    await runtime.restartSandbox(id);
                    vscode.window.showInformationMessage(
                        `Sandbox '${id}' restarted.`,
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to restart sandbox: ${describeError(error)}`,
                    );
                }
            },
        ),
        vscode.commands.registerCommand(
            "typeagent-studio.loadAgent",
            async (node?: SandboxTreeNode) => {
                const id = await resolveSandboxId(runtime, node);
                if (!id) {
                    return;
                }
                const agentRef = await vscode.window.showInputBox({
                    title: `Load agent into '${id}'`,
                    prompt: "Agent reference (name, module specifier, or path)",
                    placeHolder: "e.g. player",
                    ignoreFocusOut: true,
                    validateInput: (value) =>
                        value.trim().length === 0
                            ? "Enter an agent reference."
                            : undefined,
                });
                if (!agentRef) {
                    return;
                }
                try {
                    const status = await runtime.loadSandboxAgent(
                        id,
                        agentRef.trim(),
                    );
                    vscode.window.showInformationMessage(
                        `Loaded agent into '${status.id}' (${status.agents.length} loaded).`,
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to load agent: ${describeError(error)}`,
                    );
                }
            },
        ),
        vscode.commands.registerCommand(
            "typeagent-studio.unloadAgent",
            async (node?: SandboxTreeNode) => {
                const id = node?.sandboxId;
                const agentName = node?.agentName;
                if (!id || !agentName) {
                    vscode.window.showInformationMessage(
                        "Select an agent in the Sandboxes view to unload it.",
                    );
                    return;
                }
                try {
                    await runtime.unloadSandboxAgent(id, agentName);
                    vscode.window.showInformationMessage(
                        `Unloaded agent '${agentName}' from '${id}'.`,
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to unload agent: ${describeError(error)}`,
                    );
                }
            },
        ),
    );

    const corpusTree = new CorpusTreeProvider(runtime);
    context.subscriptions.push(
        corpusTree,
        vscode.window.registerTreeDataProvider(CORPUS_VIEW_ID, corpusTree),
        vscode.commands.registerCommand("typeagent-studio.refreshCorpora", () =>
            corpusTree.refresh(),
        ),
    );

    const statusBar = new StudioStatusBar(runtime);
    context.subscriptions.push(
        statusBar,
        vscode.commands.registerCommand(STUDIO_STATUS_BAR_COMMAND, () =>
            vscode.commands.executeCommand(`${SANDBOX_VIEW_ID}.focus`),
        ),
    );

    const eventLog = new EventLogTreeProvider(runtime);
    context.subscriptions.push(
        eventLog,
        vscode.window.registerTreeDataProvider(EVENT_LOG_VIEW_ID, eventLog),
        vscode.commands.registerCommand("typeagent-studio.refreshEvents", () =>
            eventLog.refresh(),
        ),
        vscode.commands.registerCommand("typeagent-studio.clearEvents", () =>
            eventLog.clear(),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("typeagent-studio.hello", () => {
            vscode.window.showInformationMessage(
                `TypeAgent Studio skeleton (typeagent-core ${VERSION}).`,
            );
        }),
    );
}

async function resolveSandboxId(
    runtime: ReturnType<typeof createStudioRuntime>,
    node: SandboxTreeNode | undefined,
): Promise<string | undefined> {
    if (node?.sandboxId) {
        return node.sandboxId;
    }
    const sandboxes = await runtime.listSandboxes();
    if (sandboxes.length === 0) {
        vscode.window.showInformationMessage("No sandboxes are running.");
        return undefined;
    }
    if (sandboxes.length === 1) {
        return sandboxes[0].id;
    }
    return vscode.window.showQuickPick(
        sandboxes.map((s) => s.id),
        { placeHolder: "Select a sandbox" },
    );
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function deactivate(): void {}
