// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { registerStudioCommands } from "./commands.js";
import { createStudioRuntime } from "./studioRuntime.js";
import { ensureStudioService } from "./studioServiceLauncher.js";
import {
    StudioServiceRuntimeFacade,
    type CorpusSource,
} from "./serviceRuntimeFacade.js";
import type { AvailableAgent } from "@typeagent/core/runtime";
import { SANDBOX_VIEW_ID, SandboxTreeProvider } from "./sandboxTreeProvider.js";
import type { SandboxTreeNode } from "./sandboxTreePresentation.js";
import { StudioServiceSandboxSource } from "./sandboxSource.js";
import type { SandboxSource } from "./sandboxSource.js";
import { CORPUS_VIEW_ID, CorpusTreeProvider } from "./corpusTreeProvider.js";
import type { CorpusTreeNode } from "./corpusTreePresentation.js";
import {
    buildReplayRowViews,
    formatReplaySummaryLine,
    replayHasDifferences,
} from "./replayPresentation.js";
import {
    COLLISIONS_VIEW_ID,
    CollisionsTreeProvider,
} from "./collisionsTreeProvider.js";
import {
    StudioServiceCollisionsSource,
    type CollisionsSource,
} from "./collisionsSource.js";
import type { CollisionRow } from "./collisionsPresentation.js";
import {
    STUDIO_STATUS_BAR_COMMAND,
    StudioStatusBar,
} from "./studioStatusBar.js";
import {
    EVENT_LOG_VIEW_ID,
    EventLogTreeProvider,
} from "./eventLogTreeProvider.js";
import { StudioServiceEventSource } from "./eventLogSource.js";
import {
    StudioServiceConnection,
    type StudioConnectionState,
} from "./studioServiceConnection.js";
import {
    openImpactReport,
    refreshOpenImpactReport,
} from "./impactReportView.js";
import { savePersistedRun } from "./impactReportStore.js";
import { defaultGitExec, resolveVersionProvenance } from "./gitRefProvider.js";
import type {
    ResolvedVersion,
    RunProvenance,
} from "./webviewKit/replayViewModel.js";

export function activate(context: vscode.ExtensionContext): void {
    // In-process runtime — retained ONLY for the onboarding command surface
    // (see studioRuntime.ts). The shared live surfaces below read from the
    // standalone Studio service over the channel, not from this runtime.
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

    // One shared connection to the standalone Studio service for all
    // channel-backed views. Created early because the Sandbox view reads only
    // through it (the service is the single source of truth for sandboxes). The
    // launcher (below) points it at the launched/attached service.
    const connection = new StudioServiceConnection(repoRootInfo.repoRoot);
    const sandboxSource = new StudioServiceSandboxSource(connection);
    // Service-backed corpus / health / feedback / replay surfaces (repo info is
    // resolved locally; everything else routes to the service).
    const serviceRuntime = new StudioServiceRuntimeFacade(
        connection,
        repoRootInfo,
    );

    const sandboxTree = new SandboxTreeProvider(sandboxSource);

    // Sandboxes are restored from the agent runtime's persisted snapshot on the
    // first successful connect (wired in the connection state handler below),
    // not at activation — the agent-server may not be up yet.
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
                    let options: { id?: string } | undefined;
                    if (node?.sandboxId) {
                        // Restarting a specific (stopped) sandbox row.
                        options = { id: node.sandboxId };
                    } else {
                        // Title-bar action: let the user name it, or leave it
                        // blank to auto-generate a unique id.
                        const name = await vscode.window.showInputBox({
                            title: "Start sandbox",
                            prompt: "Sandbox name (optional — leave blank to auto-generate)",
                            placeHolder: "e.g. experiment-1",
                            ignoreFocusOut: true,
                            validateInput: (value) =>
                                value.length === 0 ||
                                /^[A-Za-z0-9._-]+$/.test(value.trim())
                                    ? undefined
                                    : "Use only letters, digits, dot, dash, or underscore.",
                        });
                        if (name === undefined) {
                            return; // cancelled
                        }
                        const trimmed = name.trim();
                        options =
                            trimmed.length > 0 ? { id: trimmed } : undefined;
                    }
                    const status = await sandboxSource.startSandbox(options);
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
                const id = await resolveSandboxId(sandboxSource, node);
                if (!id) {
                    return;
                }
                try {
                    await sandboxSource.stopSandbox(id);
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
                const id = await resolveSandboxId(sandboxSource, node);
                if (!id) {
                    return;
                }
                try {
                    await sandboxSource.restartSandbox(id);
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
                const id = await resolveSandboxId(sandboxSource, node);
                if (!id) {
                    return;
                }
                // Exclude agents already loaded in this sandbox from the
                // suggestions (loading a duplicate is a no-op / confusing).
                const loaded = new Set(
                    (await sandboxSource.listSandboxes())
                        .find((s) => s.id === id)
                        ?.agents.map((a) => a.name) ?? [],
                );
                const available = (
                    await sandboxSource.listAvailableAgents()
                ).filter((a) => !loaded.has(a.name));
                const agentRef =
                    available.length > 0
                        ? await pickAgentRef(available, id)
                        : await vscode.window.showInputBox({
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
                if (agentRef === ADD_AGENTS_DIR_SENTINEL) {
                    await vscode.commands.executeCommand(
                        "typeagent-studio.addAgentsDirectory",
                    );
                    return;
                }
                try {
                    const status = await sandboxSource.loadSandboxAgent(
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
            "typeagent-studio.addAgentsDirectory",
            async () => {
                const picked = await vscode.window.showOpenDialog({
                    title: "Add agents directory",
                    openLabel: "Add",
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                });
                if (!picked || picked.length === 0) {
                    return;
                }
                const dir = picked[0].fsPath;
                const config =
                    vscode.workspace.getConfiguration("typeagentStudio");
                // Read the effective value, but persist to USER (global)
                // settings: agent search paths are machine-specific absolute
                // paths and must not land in a tracked workspace settings file
                // (e.g. ts/.vscode/settings.json) or get committed.
                const current =
                    config.inspect<string[]>("agentSearchPaths")?.globalValue ??
                    [];
                if (current.includes(dir)) {
                    vscode.window.showInformationMessage(
                        `'${dir}' is already an agent search path.`,
                    );
                    return;
                }
                await config.update(
                    "agentSearchPaths",
                    [...current, dir],
                    vscode.ConfigurationTarget.Global,
                );
                vscode.window.showInformationMessage(
                    `Added '${dir}' to your agent search paths. Its agents are now available in Load agent.`,
                );
            },
        ),
        vscode.commands.registerCommand(
            "typeagent-studio.removeAgentsDirectory",
            async () => {
                const config =
                    vscode.workspace.getConfiguration("typeagentStudio");
                const current =
                    config.inspect<string[]>("agentSearchPaths")?.globalValue ??
                    [];
                if (current.length === 0) {
                    vscode.window.showInformationMessage(
                        "No agent search paths are configured.",
                    );
                    return;
                }
                const dir = await vscode.window.showQuickPick(current, {
                    title: "Remove agents directory",
                    placeHolder: "Select a search path to remove",
                });
                if (!dir) {
                    return;
                }
                await config.update(
                    "agentSearchPaths",
                    current.filter((p) => p !== dir),
                    vscode.ConfigurationTarget.Global,
                );
                vscode.window.showInformationMessage(
                    `Removed '${dir}' from your agent search paths.`,
                );
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
                    await sandboxSource.unloadSandboxAgent(id, agentName);
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

    const corpusTree = new CorpusTreeProvider(serviceRuntime);
    // The Corpora tree refreshes on explicit in-extension actions (seeding an
    // in-repo file, adding an external source, recording feedback) and the
    // manual Refresh command. It also refreshes when a `*.utterances.jsonl`
    // file under the in-repo corpus folder is saved in the editor, so newly
    // typed entries show up without a manual refresh. A single save listener is
    // used rather than a filesystem watcher to keep activation light.
    const corpusDir = repoRootInfo.repoRoot
        ? path.join(repoRootInfo.repoRoot, "corpus")
        : undefined;
    // VS Code can report paths with an inconsistent drive-letter case on
    // Windows, so compare the saved file's folder case-insensitively there.
    const samePath = (a: string, b: string): boolean =>
        process.platform === "win32"
            ? a.toLowerCase() === b.toLowerCase()
            : a === b;
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (
                corpusDir &&
                doc.fileName.endsWith(".utterances.jsonl") &&
                samePath(path.dirname(doc.fileName), corpusDir)
            ) {
                corpusTree.refresh();
            }
        }),
    );
    context.subscriptions.push(
        corpusTree,
        vscode.window.registerTreeDataProvider(CORPUS_VIEW_ID, corpusTree),
        vscode.commands.registerCommand("typeagent-studio.refreshCorpora", () =>
            corpusTree.refresh(),
        ),
        vscode.commands.registerCommand(
            "typeagent-studio.seedInRepoCorpus",
            async (arg?: string | CorpusTreeNode) => {
                const agent =
                    typeof arg === "string" ? arg : (arg?.agent ?? undefined);
                const target = agent ?? (await pickCorpusAgent(serviceRuntime));
                if (!target) {
                    return;
                }
                // Explicit confirmation so a corpus file is never written
                // without the user asking for it.
                const confirm = await vscode.window.showInformationMessage(
                    `Create an in-repo corpus file for '${target}'?`,
                    {
                        modal: true,
                        detail: `This creates corpus/${target}.utterances.jsonl and opens it so you can add one labelled utterance (JSON) per line.`,
                    },
                    "Create",
                );
                if (confirm !== "Create") {
                    return;
                }
                try {
                    const { path: filePath, created } =
                        await serviceRuntime.seedInRepoCorpus(target);
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
            "typeagent-studio.openCorpusFile",
            async (node?: CorpusTreeNode) => {
                const filePath = node?.filePath;
                if (!filePath) {
                    return;
                }
                try {
                    const doc = await vscode.workspace.openTextDocument(
                        vscode.Uri.file(filePath),
                    );
                    await vscode.window.showTextDocument(doc);
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to open corpus file: ${describeError(error)}`,
                    );
                }
            },
        ),
        vscode.commands.registerCommand(
            "typeagent-studio.addExternalCorpus",
            async (node?: CorpusTreeNode) => {
                const agent =
                    node?.agent ?? (await pickCorpusAgent(serviceRuntime));
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
                    await serviceRuntime.addExternalCorpusSource({
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
        vscode.commands.registerCommand(
            "typeagent-studio.importCorpusFromLogs",
            async () => {
                const picked = await vscode.window.showOpenDialog({
                    title: "Import corpus from interaction logs",
                    canSelectMany: true,
                    canSelectFiles: true,
                    canSelectFolders: true,
                    openLabel: "Import",
                    filters: { "Display log": ["json"], "All files": ["*"] },
                });
                if (!picked || picked.length === 0) {
                    return;
                }
                // A folder selection resolves to its displayLog.json.
                const paths: string[] = [];
                for (const uri of picked) {
                    try {
                        const stat = await vscode.workspace.fs.stat(uri);
                        if (stat.type === vscode.FileType.Directory) {
                            paths.push(
                                vscode.Uri.joinPath(uri, "displayLog.json")
                                    .fsPath,
                            );
                        } else {
                            paths.push(uri.fsPath);
                        }
                    } catch {
                        paths.push(uri.fsPath);
                    }
                }
                const filter = await vscode.window.showInputBox({
                    title: "Restrict to agents (optional)",
                    prompt: "Comma-separated agent names to capture; leave blank for all.",
                    placeHolder: "e.g. player, list",
                    ignoreFocusOut: true,
                });
                if (filter === undefined) {
                    return;
                }
                const agents = filter
                    .split(",")
                    .map((a) => a.trim())
                    .filter((a) => a.length > 0);
                try {
                    const result = await serviceRuntime.importCorpusFromLogs({
                        paths,
                        ...(agents.length > 0 ? { agents } : {}),
                    });
                    corpusTree.refresh();
                    const skippedTotal = Object.values(result.skipped).reduce(
                        (sum, n) => sum + n,
                        0,
                    );
                    const agentNames = Object.keys(result.perAgent);
                    const where =
                        agentNames.length > 0
                            ? ` across ${agentNames.join(", ")}`
                            : "";
                    vscode.window.showInformationMessage(
                        `Imported ${result.total} corpus ${
                            result.total === 1 ? "entry" : "entries"
                        }${where} into the shared in-repo corpus from ${
                            result.files.length
                        } ${
                            result.files.length === 1 ? "file" : "files"
                        }; skipped ${skippedTotal} ${
                            skippedTotal === 1 ? "duplicate" : "duplicates"
                        }.`,
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to import corpus: ${describeError(error)}`,
                    );
                }
            },
        ),
    );

    const statusBar = new StudioStatusBar(serviceRuntime);
    context.subscriptions.push(
        statusBar,
        vscode.commands.registerCommand(STUDIO_STATUS_BAR_COMMAND, () =>
            vscode.commands.executeCommand(`${SANDBOX_VIEW_ID}.focus`),
        ),
    );

    // Service connection status bar (clicking re-attempts the connection). The
    // shared `connection` is created earlier (the Sandbox view depends on it).
    const SERVICE_CONNECT_COMMAND = "typeagent-studio.connectStudioService";
    const serviceStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        99,
    );
    serviceStatusBar.command = SERVICE_CONNECT_COMMAND;
    // While disconnected the connection auto-retries on a backoff; a 1s ticker
    // refreshes the countdown ("reconnecting in Ns…"). It's the single, global
    // place that surfaces connection state — the views render nothing until
    // connected rather than repeating a per-view "connecting" message.
    let countdownTimer: ReturnType<typeof setInterval> | undefined;
    const stopCountdown = () => {
        if (countdownTimer !== undefined) {
            clearInterval(countdownTimer);
            countdownTimer = undefined;
        }
    };
    const renderReconnecting = () => {
        const at = connection.nextRetryAt;
        const secs =
            at !== undefined
                ? Math.max(0, Math.ceil((at - Date.now()) / 1000))
                : 0;
        serviceStatusBar.text =
            secs > 0
                ? `$(sync~spin) Studio: reconnecting in ${secs}s…`
                : "$(sync~spin) Studio: reconnecting…";
        serviceStatusBar.tooltip =
            "Studio service unavailable — reconnecting automatically. Click to retry now (or run `typeagent-studio serve`).";
        serviceStatusBar.show();
    };
    const renderServiceStatus = (state: StudioConnectionState) => {
        stopCountdown();
        if (state === "connected") {
            serviceStatusBar.text = "$(plug) Studio: connected";
            serviceStatusBar.tooltip =
                "Connected to the standalone Studio service for this workspace.";
        } else if (state === "connecting") {
            serviceStatusBar.text = "$(sync~spin) Studio: connecting…";
            serviceStatusBar.tooltip = "Connecting to the Studio service…";
        } else {
            // Disconnected always schedules an auto-retry (backoff), so frame it
            // as reconnecting (with a live countdown) rather than a dead end.
            renderReconnecting();
            countdownTimer = setInterval(renderReconnecting, 1000);
        }
        serviceStatusBar.show();
    };

    // The Event Log reads from the standalone Studio service over the shared
    // connection (no in-process fallback). It shows recent activity once
    // connected; empty while connecting.
    const eventChannelSource = new StudioServiceEventSource(connection);
    const eventLog = new EventLogTreeProvider(eventChannelSource);
    const eventLogView = vscode.window.createTreeView(EVENT_LOG_VIEW_ID, {
        treeDataProvider: eventLog,
    });

    context.subscriptions.push(
        eventLog,
        eventLogView,
        serviceStatusBar,
        { dispose: stopCountdown },
        { dispose: () => connection.dispose() },
        vscode.commands.registerCommand("typeagent-studio.refreshEvents", () =>
            eventLog.refresh(),
        ),
        vscode.commands.registerCommand("typeagent-studio.clearEvents", () =>
            eventLog.clear(),
        ),
        // Open a per-agent Impact Report. Launched from the graph icon on a
        // Corpora agent row (the node carries the agent); when invoked without a
        // row, fall back to a quick pick so a keybinding still works.
        vscode.commands.registerCommand(
            "typeagent-studio.openImpactReport",
            async (node?: { agent?: string }) => {
                let agent = node?.agent;
                if (!agent) {
                    const agents = await serviceRuntime.listCorpusAgents();
                    if (agents.length === 0) {
                        vscode.window.showInformationMessage(
                            "No agents have a corpus to replay. Load an agent into a sandbox first.",
                        );
                        return;
                    }
                    agent =
                        agents.length === 1
                            ? agents[0]
                            : await vscode.window.showQuickPick(agents, {
                                  title: "Open Impact Report",
                                  placeHolder:
                                      "Select an agent to open a report for",
                              });
                    if (!agent) {
                        return;
                    }
                }
                openImpactReport(
                    context,
                    repoRootInfo.repoRoot,
                    connection,
                    agent,
                );
            },
        ),
    );

    // The Collisions view reads from the standalone Studio service over the
    // shared connection (scan + list are read-only analysis); no in-process
    // fallback.
    const collisionsChannelSource = new StudioServiceCollisionsSource(
        connection,
    );
    const collisions = new CollisionsTreeProvider(collisionsChannelSource);
    const collisionsView = vscode.window.createTreeView(COLLISIONS_VIEW_ID, {
        treeDataProvider: collisions,
    });

    const currentCollisionsSource: CollisionsSource = collisionsChannelSource;

    // Shared scan flow used by both the manual command and the auto-scan
    // Auto-scan debounce state, declared before the shared scan helper so an
    // explicit scan can supersede a pending debounced one.
    let autoScanTimer: ReturnType<typeof setTimeout> | undefined;
    const AUTO_SCAN_DEBOUNCE_MS = 500;
    const cancelPendingAutoScan = () => {
        if (autoScanTimer !== undefined) {
            clearTimeout(autoScanTimer);
            autoScanTimer = undefined;
        }
    };

    // subscription: run the grammar collision scan against the active source,
    // then push fresh results and the skipped set into the tree.
    const runCollisionScan = async () => {
        // An explicit scan makes any queued debounced auto-scan redundant
        // (e.g. the one refreshSandboxAgent triggers after Build grammar).
        cancelPendingAutoScan();
        const result = await currentCollisionsSource.scanGrammarCollisions();
        await collisions.reload();
        collisions.setSkipped(result.skipped);
        return result;
    };

    // Auto-scan: when the loaded agent set changes, re-scan after a short
    // debounce so the Collisions view stays current without a manual click.
    // Coalesces bursts (e.g. restoring several sandboxes at activation) into a
    // single scan. Runs quietly — no progress UI or toast.
    const scheduleAutoScan = () => {
        const enabled = vscode.workspace
            .getConfiguration("typeagentStudio.collisions")
            .get<boolean>("autoScanOnAgentChange", true);
        if (!enabled) {
            return;
        }
        cancelPendingAutoScan();
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

    // The collision source is fixed (the service channel), so the agent-load
    // subscription is bound once.
    const agentLoadSubscription =
        currentCollisionsSource.onAgentLoadChanged(scheduleAutoScan);

    context.subscriptions.push(
        collisions,
        collisionsView,
        { dispose: () => agentLoadSubscription.dispose() },
        { dispose: cancelPendingAutoScan },
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
                const { repoRoot, agentsDirFound } = repoRootInfo;
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
                    await sandboxSource.refreshSandboxAgent(agent);
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
            async (node?: { agent?: string }) => {
                let agent = node?.agent;
                if (!agent) {
                    const agents = await serviceRuntime.listCorpusAgents();
                    if (agents.length === 0) {
                        vscode.window.showInformationMessage(
                            "No agents have a corpus to replay. Load an agent into a sandbox first.",
                        );
                        return;
                    }
                    agent =
                        agents.length === 1
                            ? agents[0]
                            : await vscode.window.showQuickPick(agents, {
                                  title: "Replay corpus",
                                  placeHolder: "Select an agent to replay",
                              });
                    if (!agent) {
                        return;
                    }
                }
                try {
                    // Compare the last commit against the working tree — the same
                    // "did my edits change anything" check the Impact Report runs
                    // by default (a working-tree self-compare would always be
                    // all-equal). Pin each side to its concrete commit so the
                    // report's provenance line stays truthful after a branch move.
                    const versionA = { kind: "git", ref: "HEAD" } as const;
                    const versionB = { kind: "workingTree" } as const;
                    const exec =
                        repoRootInfo.repoRoot !== undefined
                            ? defaultGitExec(repoRootInfo.repoRoot)
                            : undefined;
                    const resolvedSides = exec
                        ? await Promise.all([
                              resolveVersionProvenance(versionA, exec),
                              resolveVersionProvenance(versionB, exec),
                          ])
                        : undefined;
                    const result = await serviceRuntime.replayCorpus({
                        agent,
                        versionA,
                        versionB,
                    });
                    // Stamp the run at completion so the report's "Last run" time
                    // (and provenance) reflects when the replay finished, not when
                    // it was launched.
                    const runAt = Date.now();
                    const provenance: RunProvenance | undefined = resolvedSides
                        ? { a: resolvedSides[0], b: resolvedSides[1], runAt }
                        : undefined;
                    // The report's launch controls this run maps to: HEAD (A) vs
                    // the working tree (B) — matching the report's own defaults so
                    // a report opened after this run restores the same dropdowns.
                    const resolvedA: ResolvedVersion = {
                        spec: { kind: "git", ref: "HEAD" },
                        label: "HEAD",
                        tooltip: "Last commit (HEAD).",
                    };
                    const resolvedB: ResolvedVersion = {
                        spec: { kind: "workingTree" },
                        label: "working tree",
                        tooltip: "Your uncommitted edits in the working tree.",
                    };
                    // Persist as the agent's last run so opening the Impact Report
                    // re-renders this run instead of a blank report.
                    await savePersistedRun(
                        context.workspaceState,
                        agent,
                        result,
                        runAt,
                        provenance,
                        resolvedA,
                        resolvedB,
                    );
                    // If a report for this agent is already open, refresh it in
                    // place so the user sees this run without reopening.
                    refreshOpenImpactReport(agent, {
                        payload: result,
                        runAt,
                        versionA: resolvedA,
                        versionB: resolvedB,
                        ...(provenance ? { provenance } : {}),
                    });
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

    // React to the shared connection's state. All views read from the service
    // (no in-process fallback); the Sandbox view shows a disconnected row.
    // Restores the service's persisted sandboxes on the first connect. Fires
    // immediately with the current ("disconnected") state.
    let sandboxesRestored = false;
    context.subscriptions.push(
        connection.onStateChanged((state) => {
            renderServiceStatus(state);
            const connected = state === "connected";

            // Each tree provider gates its own loading bar / empty state on the
            // connection (see BaseStudioTreeProvider.whenConnected); the global
            // status bar item carries the user-facing connection state.
            corpusTree.setConnected(connected);
            eventLog.setConnected(connected);
            collisions.setConnected(connected);

            sandboxTree.setConnected(connected);
            if (connected && !sandboxesRestored) {
                sandboxesRestored = true;
                // Replay the service's persisted sandboxes once connected, then
                // refresh so the view renders the restored rows.
                void sandboxSource
                    .restoreSandboxes()
                    .then(() => sandboxTree.refresh())
                    .catch((err) =>
                        console.warn(
                            "[typeagent-studio] Failed to restore sandboxes:",
                            describeError(err),
                        ),
                    );
            }
        }),
        vscode.commands.registerCommand(SERVICE_CONNECT_COMMAND, async () => {
            // Re-run the launcher (attach or relaunch), then connect.
            const target = await ensureStudioService(repoRootInfo.repoRoot);
            if (target !== undefined) {
                connection.setTarget(target);
            }
            const ok = await connection.connect();
            if (!ok) {
                void vscode.window.showWarningMessage(
                    "TypeAgent Studio service not reachable — open the workspace, or run `typeagent-studio serve`. Studio will keep retrying.",
                );
                return;
            }
            let detail = "";
            try {
                const info = await connection.getClient()?.getStudioInfo();
                if (info) {
                    const total = info.agentLocations.reduce(
                        (n, l) => n + l.agentCount,
                        0,
                    );
                    detail = ` — repo ${info.repoRootInfo.repoRoot ?? "(unknown)"}, ${total} agent(s)`;
                }
            } catch {
                // Service info is best-effort decoration on the toast.
            }
            void vscode.window.showInformationMessage(
                `Connected to the Studio service${detail}.`,
            );
        }),
    );

    // Launch (or attach to) the standalone Studio service for this workspace,
    // then begin auto-connecting. Non-blocking: a not-yet-running agent-server
    // or slow spawn doesn't hold up activation; the connection retries and the
    // service announces itself when ready.
    void (async () => {
        try {
            const target = await ensureStudioService(repoRootInfo.repoRoot);
            if (target !== undefined) {
                connection.setTarget(target);
            }
        } catch (err) {
            console.warn(
                "[typeagent-studio] Failed to launch Studio service:",
                describeError(err),
            );
        } finally {
            connection.startAutoConnect();
        }
    })();
}

async function resolveSandboxId(
    source: SandboxSource,
    node: SandboxTreeNode | undefined,
): Promise<string | undefined> {
    if (node?.sandboxId) {
        return node.sandboxId;
    }
    const sandboxes = await source.listSandboxes();
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

/** Fallback emoji for agents whose manifest declares none. */
const DEFAULT_AGENT_EMOJI = "🔌";

/** Sentinel returned by the agent picker to request adding a search directory. */
const ADD_AGENTS_DIR_SENTINEL = "\u0000add-agents-dir";

/**
 * Filterable agent picker: type-to-filter over the discovered agents (shown
 * with their manifest emoji), while still allowing a free-text reference (a
 * module specifier or path) that isn't in the list. Returns the chosen agent
 * name/reference, or undefined if cancelled.
 */
function pickAgentRef(
    available: readonly AvailableAgent[],
    sandboxId: string,
): Promise<string | undefined> {
    type AgentItem = vscode.QuickPickItem & { agentName?: string };
    return new Promise((resolve) => {
        const qp = vscode.window.createQuickPick<AgentItem>();
        qp.title = `Load agent into '${sandboxId}'`;
        qp.placeholder =
            "Pick an agent, or type a name / module specifier / path";
        qp.items = [
            {
                label: "$(add) Add agents directory…",
                description: "Discover agents from another folder",
                agentName: ADD_AGENTS_DIR_SENTINEL,
            },
            ...available.map((agent) => ({
                label: `${agent.emoji ?? DEFAULT_AGENT_EMOJI} ${agent.name}`,
                agentName: agent.name,
            })),
        ];
        qp.ignoreFocusOut = true;
        let accepted = false;
        qp.onDidAccept(() => {
            // Selected item → its agent name; otherwise the typed free text.
            const picked = qp.selectedItems[0]?.agentName ?? qp.value.trim();
            accepted = true;
            qp.hide();
            resolve(picked.length > 0 ? picked : undefined);
        });
        qp.onDidHide(() => {
            qp.dispose();
            if (!accepted) {
                resolve(undefined);
            }
        });
        qp.show();
    });
}

/**
 * Prompt the user to choose an agent that currently has a corpus view. Returns
 * the only agent when there's just one, or undefined if there are none / the
 * user cancels.
 */
async function pickCorpusAgent(
    source: CorpusSource,
): Promise<string | undefined> {
    const agents = await source.listCorpusAgents();
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
