// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { VERSION } from "@typeagent/core";
import { registerStudioCommands } from "./commands.js";
import { createStudioRuntime } from "./studioRuntime.js";
import { SANDBOX_VIEW_ID, SandboxTreeProvider } from "./sandboxTreeProvider.js";
import type { SandboxTreeNode } from "./sandboxTreePresentation.js";
import { CORPUS_VIEW_ID, CorpusTreeProvider } from "./corpusTreeProvider.js";
import type { CorpusTreeNode } from "./corpusTreePresentation.js";
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
    COLLISIONS_VIEW_ID,
    CollisionsTreeProvider,
} from "./collisionsTreeProvider.js";
import type { CollisionRow } from "./collisionsPresentation.js";
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

    // Warn early if we couldn't locate `packages/agents` under any open
    // folder. Without it, health/corpus/collision views are silently empty
    // because there are no agents to discover. Most often this means the user
    // opened the git root rather than the monorepo's `ts/` directory.
    const repoRootInfo = runtime.getRepoRootInfo();
    if (!repoRootInfo.agentsDirFound) {
        const hasFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
        const message = hasFolder
            ? "TypeAgent Studio couldn't find a 'packages/agents' directory in the open workspace. Open the monorepo's 'ts' folder so agents, health, and collisions can be discovered."
            : "TypeAgent Studio has no folder open. Open the monorepo's 'ts' folder so agents, health, and collisions can be discovered.";
        void vscode.window.showWarningMessage(message);
    }

    registerStudioCommands(context, runtime);

    const sandboxTree = new SandboxTreeProvider(runtime);

    // Replay the persisted sandbox set asynchronously so activation stays
    // synchronous; the sandbox tree refreshes via the lifecycle event
    // subscription as each sandbox comes back online.
    runtime.restoreSandboxes().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(
            "[typeagent-studio] Failed to restore persisted sandboxes:",
            err,
        );
    });
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
        vscode.commands.registerCommand(
            "typeagent-studio.seedInRepoCorpus",
            async (arg?: string | CorpusTreeNode) => {
                const agent =
                    typeof arg === "string" ? arg : (arg?.agent ?? undefined);
                const target = agent ?? (await pickCorpusAgent(runtime));
                if (!target) {
                    return;
                }
                try {
                    const { path: filePath, created } =
                        await runtime.seedInRepoCorpus(target);
                    corpusTree.refresh();
                    const doc = await vscode.workspace.openTextDocument(
                        vscode.Uri.file(filePath),
                    );
                    await vscode.window.showTextDocument(doc);
                    vscode.window.showInformationMessage(
                        created
                            ? `Created in-repo corpus for ${target}. Add one JSON object per line.`
                            : `In-repo corpus for ${target} already exists.`,
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to seed corpus: ${describeError(error)}`,
                    );
                }
            },
        ),
        vscode.commands.registerCommand(
            "typeagent-studio.addExternalCorpus",
            async (node?: CorpusTreeNode) => {
                const agent = node?.agent ?? (await pickCorpusAgent(runtime));
                if (!agent) {
                    return;
                }
                const name = await vscode.window.showInputBox({
                    title: "Add external corpus",
                    prompt: `Name for this external source (unique per agent)`,
                    placeHolder: "e.g. regression-set",
                    ignoreFocusOut: true,
                });
                if (name === undefined || name.trim().length === 0) {
                    return;
                }
                const picked = await vscode.window.showOpenDialog({
                    title: "Select a JSONL corpus file",
                    canSelectMany: false,
                    openLabel: "Add corpus",
                    filters: { "JSONL corpus": ["jsonl"], "All files": ["*"] },
                });
                if (!picked || picked.length === 0) {
                    return;
                }
                try {
                    await runtime.addExternalCorpusSource({
                        name: name.trim(),
                        agent,
                        kind: "jsonl-file",
                        filePath: picked[0].fsPath,
                    });
                    corpusTree.refresh();
                    vscode.window.showInformationMessage(
                        `Added external corpus '${name.trim()}' for ${agent}.`,
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to add external corpus: ${describeError(error)}`,
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

    const collisions = new CollisionsTreeProvider(runtime);

    // Shared scan flow used by both the manual command and the auto-scan
    // subscription: run the grammar collision scan, then push fresh results
    // and the skipped set into the tree.
    const runCollisionScan = async () => {
        const result = await runtime.scanGrammarCollisions();
        await collisions.reloadFromRuntime();
        collisions.setSkipped(result.skipped);
        return result;
    };

    // Auto-scan: when the loaded agent set changes, re-scan after a short
    // debounce so the Collisions view stays current without a manual click.
    // Coalesces bursts (e.g. restoring several sandboxes at activation) into a
    // single scan. Runs quietly — no progress UI or toast.
    let autoScanTimer: ReturnType<typeof setTimeout> | undefined;
    const AUTO_SCAN_DEBOUNCE_MS = 500;
    const scheduleAutoScan = () => {
        const enabled = vscode.workspace
            .getConfiguration("typeagentStudio.collisions")
            .get<boolean>("autoScanOnAgentChange", true);
        if (!enabled) {
            return;
        }
        if (autoScanTimer !== undefined) {
            clearTimeout(autoScanTimer);
        }
        autoScanTimer = setTimeout(() => {
            autoScanTimer = undefined;
            void runCollisionScan().catch((error) => {
                console.warn(
                    "[typeagent-studio] Auto collision scan failed:",
                    describeError(error),
                );
            });
        }, AUTO_SCAN_DEBOUNCE_MS);
    };
    const agentLoadSubscription = runtime.onAgentLoadChanged(scheduleAutoScan);

    context.subscriptions.push(
        collisions,
        agentLoadSubscription,
        {
            dispose: () => {
                if (autoScanTimer !== undefined) {
                    clearTimeout(autoScanTimer);
                    autoScanTimer = undefined;
                }
            },
        },
        vscode.window.registerTreeDataProvider(COLLISIONS_VIEW_ID, collisions),
        vscode.commands.registerCommand(
            "typeagent-studio.refreshCollisions",
            () => collisions.refresh(),
        ),
        vscode.commands.registerCommand(
            "typeagent-studio.clearCollisions",
            () => collisions.clear(),
        ),
        vscode.commands.registerCommand(
            "typeagent-studio.scanCollisions",
            async () => {
                try {
                    const result = await vscode.window.withProgress(
                        {
                            location: { viewId: COLLISIONS_VIEW_ID },
                            title: "Scanning grammars for collisions...",
                        },
                        () => runCollisionScan(),
                    );
                    if (result.scanned.length === 0) {
                        vscode.window.showWarningMessage(
                            "No compiled grammars found to scan. Load agents into a sandbox and build their grammars first.",
                        );
                        return;
                    }
                    const skippedSuffix =
                        result.skipped.length > 0
                            ? `, ${result.skipped.length} skipped`
                            : "";
                    vscode.window.showInformationMessage(
                        `Scanned ${result.scanned.length} grammar(s): ${result.collisionCount} collision(s) found${skippedSuffix}.`,
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Collision scan failed: ${describeError(error)}`,
                    );
                }
            },
        ),
        vscode.commands.registerCommand(
            "typeagent-studio.buildAgentGrammar",
            async (row?: CollisionRow) => {
                const agent = row?.agentName;
                if (agent === undefined || agent.length === 0) {
                    vscode.window.showErrorMessage(
                        "No agent selected to build.",
                    );
                    return;
                }
                const { repoRoot, agentsDirFound } = runtime.getRepoRootInfo();
                if (!agentsDirFound) {
                    vscode.window.showErrorMessage(
                        "Can't build grammar: no 'packages/agents' directory found. Open the monorepo's 'ts' folder.",
                    );
                    return;
                }
                const pkg = await readAgentPackageInfo(repoRoot, agent);
                const packageName = pkg?.name ?? agent;
                // Prefer a dedicated grammar-compile script; not every agent
                // folds `agc` into its `build`, so falling straight to `build`
                // can "succeed" without producing any compiled grammar.
                const script = pickGrammarBuildScript(pkg?.scripts);
                try {
                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: `Building ${agent} grammar...`,
                        },
                        () => runAgentBuildTask(packageName, script, repoRoot),
                    );
                    // Reload the agent so its (cached) health badge and hashes
                    // re-evaluate against the freshly built grammar; this also
                    // emits sandbox.agent.loaded, which refreshes the trees and
                    // triggers the collision auto-scan.
                    await runtime.refreshSandboxAgent(agent);
                    const scan = await runCollisionScan();
                    const stillUnbuilt = scan.skipped.some(
                        (s) =>
                            s.agentName === agent &&
                            s.reason === "grammar-not-built",
                    );
                    if (stillUnbuilt) {
                        vscode.window.showWarningMessage(
                            `Built ${agent}, but no compiled grammar was produced. Its build may not compile grammar (no 'agc' step) — check the agent's package.json scripts.`,
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            `Built ${agent} and re-scanned collisions.`,
                        );
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to build ${agent}: ${describeError(error)}`,
                    );
                }
            },
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

/**
 * Prompt the user to choose an agent that currently has a corpus view. Returns
 * the only agent when there's just one, or undefined if there are none / the
 * user cancels.
 */
async function pickCorpusAgent(
    runtime: ReturnType<typeof createStudioRuntime>,
): Promise<string | undefined> {
    const agents = await runtime.listCorpusAgents();
    if (agents.length === 0) {
        vscode.window.showInformationMessage(
            "No agents are loaded. Load an agent into a sandbox first.",
        );
        return undefined;
    }
    if (agents.length === 1) {
        return agents[0];
    }
    return vscode.window.showQuickPick(agents, {
        title: "Select an agent",
        placeHolder: "Agent",
    });
}

/**
 * Read an agent package's name and scripts from
 * `packages/agents/<agent>/package.json`. Returns undefined when unreadable.
 */
async function readAgentPackageInfo(
    repoRoot: string,
    agent: string,
): Promise<{ name?: string; scripts: Record<string, string> } | undefined> {
    try {
        const pkgPath = path.join(
            repoRoot,
            "packages",
            "agents",
            agent,
            "package.json",
        );
        const parsed: unknown = JSON.parse(await readFile(pkgPath, "utf8"));
        if (typeof parsed !== "object" || parsed === null) {
            return undefined;
        }
        const obj = parsed as { name?: unknown; scripts?: unknown };
        const scripts: Record<string, string> = {};
        if (typeof obj.scripts === "object" && obj.scripts !== null) {
            for (const [key, value] of Object.entries(obj.scripts)) {
                if (typeof value === "string") {
                    scripts[key] = value;
                }
            }
        }
        return {
            ...(typeof obj.name === "string" ? { name: obj.name } : {}),
            scripts,
        };
    } catch {
        return undefined;
    }
}

/**
 * Choose the npm script that compiles an agent's grammar. Prefer a dedicated
 * `agc:all` / `agc` script; fall back to `build` (some agents fold grammar
 * compilation into their build).
 */
function pickGrammarBuildScript(
    scripts: Record<string, string> | undefined,
): string {
    if (scripts?.["agc:all"] !== undefined) {
        return "agc:all";
    }
    if (scripts?.["agc"] !== undefined) {
        return "agc";
    }
    return "build";
}

/**
 * Run a single agent package script via a VS Code task (e.g. `agc:all` to
 * compile its grammars). Resolves on a clean exit and rejects on a non-zero
 * exit code or task failure.
 */
function runAgentBuildTask(
    packageName: string,
    script: string,
    cwd: string,
): Promise<void> {
    const execution = new vscode.ShellExecution(
        "pnpm",
        ["--filter", packageName, "run", script],
        { cwd },
    );
    const task = new vscode.Task(
        { type: "typeagent-studio.buildAgentGrammar" },
        vscode.TaskScope.Workspace,
        `Build ${packageName}`,
        "TypeAgent Studio",
        execution,
    );
    task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Silent,
        clear: true,
    };
    return new Promise<void>((resolve, reject) => {
        const subscription = vscode.tasks.onDidEndTaskProcess((event) => {
            if (event.execution.task !== task) {
                return;
            }
            subscription.dispose();
            if (event.exitCode === 0) {
                resolve();
            } else {
                reject(
                    new Error(
                        `build exited with code ${event.exitCode ?? "unknown"}`,
                    ),
                );
            }
        });
        vscode.tasks.executeTask(task).then(undefined, (error: unknown) => {
            subscription.dispose();
            reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
}

export function deactivate(): void {}
