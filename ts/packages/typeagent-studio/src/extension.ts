// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { VERSION } from "@typeagent/core";
import { registerStudioCommands } from "./commands.js";
import { createStudioRuntime } from "./studioRuntime.js";
import { SANDBOX_VIEW_ID, SandboxTreeProvider } from "./sandboxTreeProvider.js";
import type { SandboxTreeNode } from "./sandboxTreePresentation.js";
import { CORPUS_VIEW_ID, CorpusTreeProvider } from "./corpusTreeProvider.js";
import {
    FEEDBACK_CATEGORY_CHOICES,
    FEEDBACK_RATING_CHOICES,
    buildFeedbackRecordInput,
} from "./feedbackInputPresentation.js";
import {
    buildReplayRowViews,
    formatReplaySummaryLine,
    replayHasDifferences,
} from "./replayPresentation.js";
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
        vscode.commands.registerCommand(
            "typeagent-studio.recordFeedback",
            async () => {
                const rating = await vscode.window.showQuickPick(
                    FEEDBACK_RATING_CHOICES.map((choice) => ({
                        label: choice.label,
                        value: choice.value,
                    })),
                    {
                        title: "Record feedback",
                        placeHolder: "How was the response?",
                    },
                );
                if (!rating) {
                    return;
                }
                const utterance = await vscode.window.showInputBox({
                    title: "Record feedback",
                    prompt: "Utterance this feedback is about",
                    placeHolder: "e.g. play some jazz",
                    ignoreFocusOut: true,
                });
                if (utterance === undefined) {
                    return;
                }
                const agent = await vscode.window.showInputBox({
                    title: "Record feedback",
                    prompt: "Agent (optional)",
                    placeHolder: "e.g. player",
                    ignoreFocusOut: true,
                });
                if (agent === undefined) {
                    return;
                }
                let category;
                if (rating.value === "down") {
                    const categoryPick = await vscode.window.showQuickPick(
                        FEEDBACK_CATEGORY_CHOICES.map((choice) => ({
                            label: choice.label,
                            value: choice.value,
                        })),
                        {
                            title: "Record feedback",
                            placeHolder: "What went wrong? (optional)",
                        },
                    );
                    category = categoryPick?.value;
                }
                const comment = await vscode.window.showInputBox({
                    title: "Record feedback",
                    prompt: "Comment (optional)",
                    ignoreFocusOut: true,
                });
                if (comment === undefined) {
                    return;
                }
                try {
                    await runtime.recordFeedback(
                        buildFeedbackRecordInput({
                            requestId: randomUUID(),
                            rating: rating.value,
                            agent,
                            utterance,
                            comment,
                            category,
                        }),
                    );
                    corpusTree.refresh();
                    vscode.window.showInformationMessage(
                        rating.value === "up"
                            ? "Recorded positive feedback."
                            : "Recorded negative feedback.",
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to record feedback: ${describeError(error)}`,
                    );
                }
            },
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
        vscode.commands.registerCommand(
            "typeagent-studio.replayCorpus",
            async () => {
                const agents = await runtime.listCorpusAgents();
                if (agents.length === 0) {
                    vscode.window.showInformationMessage(
                        "No agents have a corpus to replay. Load an agent into a sandbox first.",
                    );
                    return;
                }
                const agent =
                    agents.length === 1
                        ? agents[0]
                        : await vscode.window.showQuickPick(agents, {
                              title: "Replay corpus",
                              placeHolder: "Select an agent to replay",
                          });
                if (!agent) {
                    return;
                }
                try {
                    const result = await runtime.replayCorpus({ agent });
                    const line = formatReplaySummaryLine(result.summary);
                    if (result.rows.length === 0) {
                        vscode.window.showInformationMessage(
                            `Replay complete — ${line}`,
                        );
                        return;
                    }
                    const action = replayHasDifferences(result.summary)
                        ? "View differences"
                        : "View rows";
                    const choice = await vscode.window.showInformationMessage(
                        `Replay complete — ${line}`,
                        action,
                    );
                    if (choice === action) {
                        await vscode.window.showQuickPick(
                            buildReplayRowViews(result.rows),
                            {
                                title: `Replay rows — ${agent}`,
                                matchOnDetail: true,
                            },
                        );
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to replay corpus: ${describeError(error)}`,
                    );
                }
            },
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
