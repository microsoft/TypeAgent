// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider.js";
import { AgentServerBridge } from "./agentServerBridge.js";

interface ChatEntry {
    bridge: AgentServerBridge;
    /** UI handle for promoting to active. undefined means sidebar. */
    panel?: vscode.WebviewPanel;
    sidebarView?: vscode.WebviewView;
    statusDisposable: vscode.Disposable;
    focusDisposable: vscode.Disposable;
    focused: boolean;
}

let sidebarBridge: AgentServerBridge | undefined;
const chats = new Set<ChatEntry>();
let activeChat: ChatEntry | undefined;
let panelCounter = 0;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100,
    );
    statusBarItem.command = "vscode-shell.focusChat";
    context.subscriptions.push(statusBarItem);

    const SIDEBAR_LAST_SESSION_KEY = "sidebar.lastSessionId";
    const sidebarRestoreId = context.globalState.get<string>(
        SIDEBAR_LAST_SESSION_KEY,
    );
    sidebarBridge = new AgentServerBridge({
        ownsStatusBar: false,
        displayName: "Sidebar",
        restoreSessionId: sidebarRestoreId,
        // Sidebar-only default; tab panels stay ephemeral.
        defaultSessionName: "VS Code",
    });

    // Persist the sidebar's current session so reopening VS Code rejoins it
    // instead of dropping back to the default. Registered eagerly (before
    // connect()) so the very first successful join is captured too.
    // NOTE: onStatusChange supports a single subscriber per bridge, and
    // refreshStatusBar must also run from this same callback.
    const sidebarStatusDisposable = sidebarBridge.onStatusChange(() => {
        refreshStatusBar();
        const id = sidebarBridge!.getSessionId();
        if (id) {
            context.globalState.update(SIDEBAR_LAST_SESSION_KEY, id);
        }
    });
    context.subscriptions.push(sidebarStatusDisposable);

    const provider = new ChatViewProvider(context.extensionUri, sidebarBridge);

    // Sidebar webview provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            provider,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
    );

    // Track sidebar as a chat entry once it resolves
    provider.onSidebarResolved((view) => {
        const entry: ChatEntry = {
            bridge: sidebarBridge!,
            sidebarView: view,
            statusDisposable: { dispose: () => {} },
            focusDisposable: sidebarBridge!.onWebviewFocus((f) => {
                setEntryFocused(entry, f);
            }),
            focused: false,
        };
        chats.add(entry);
        setActive(entry);
        view.onDidChangeVisibility(() => {
            if (view.visible) setActive(entry);
            else setEntryFocused(entry, false);
        });
        view.onDidDispose(() => {
            chats.delete(entry);
            entry.statusDisposable.dispose();
            entry.focusDisposable.dispose();
            if (activeChat === entry) {
                activeChat = undefined;
                const next = chats.values().next().value;
                if (next) setActive(next);
                else refreshStatusBar();
            }
            refreshFocusContext();
        });
        refreshStatusBar();
    });

    // Command: open NEW chat in editor tab beside
    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-shell.openChat", () => {
            openNewChatPanel(context, provider);
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-shell.newChatPanel", () =>
            openNewChatPanel(context, provider),
        ),
    );

    // Serializer: restore previously-open chat panels on window reopen.
    context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer("vscode-shell.chatPanel", {
            async deserializeWebviewPanel(
                panel: vscode.WebviewPanel,
                state: any,
            ): Promise<void> {
                panelCounter += 1;
                const n = panelCounter;
                const sessionId =
                    state && typeof state === "object"
                        ? (state.sessionId as string | undefined)
                        : undefined;
                const sessionName =
                    state && typeof state === "object"
                        ? (state.sessionName as string | undefined)
                        : undefined;
                const friendly = sessionName ?? `Chat ${n}`;
                panel.title = `TypeAgent ${friendly}`;
                attachChatPanel(context, provider, panel, {
                    displayName: friendly,
                    // Always provide a fresh ephemeral name so that if the
                    // saved session is gone (e.g. it was an ephemeral that
                    // got swept on server start), we create a new ephemeral
                    // for this tab instead of joining the default session.
                    ephemeralSessionName: `cli-ephemeral-vscode-${n}-${Date.now()}`,
                    restoreSessionId: sessionId,
                });
            },
        }),
    );

    // Command: focus the sidebar chat
    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-shell.focusChat", () => {
            // If active chat is a panel, reveal it; otherwise focus sidebar
            if (activeChat?.panel) {
                activeChat.panel.reveal();
            } else {
                vscode.commands.executeCommand("vscode-shell.chatView.focus");
            }
        }),
    );

    // Conversation management commands — operate on the ACTIVE chat
    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-shell.switchSession", () =>
            activeChat?.bridge.switchSession(),
        ),
        vscode.commands.registerCommand("vscode-shell.newSession", () =>
            activeChat?.bridge.newSession(),
        ),
        vscode.commands.registerCommand(
            "vscode-shell.newSidebarSession",
            async () => {
                await vscode.commands.executeCommand(
                    "vscode-shell.chatView.focus",
                );
                provider.activateNewSessionInput();
            },
        ),
        vscode.commands.registerCommand("vscode-shell.renameSession", () =>
            activeChat?.bridge.renameCurrentSession(),
        ),
        vscode.commands.registerCommand("vscode-shell.deleteSession", () =>
            activeChat?.bridge.deleteSession(),
        ),
        vscode.commands.registerCommand("vscode-shell.clearChat", () =>
            activeChat?.bridge.clearChatUI(),
        ),
        vscode.commands.registerCommand("vscode-shell.runDemo", () =>
            runDemoScript(),
        ),
        vscode.commands.registerCommand("vscode-shell.demoContinue", () =>
            demoResolve?.("continue"),
        ),
        vscode.commands.registerCommand("vscode-shell.demoCancel", () =>
            requestDemoCancel(),
        ),
    );
}

// Demo runner state. demoResolve is set while a script is paused on
// @pauseForInput; calling it advances or cancels the pause.
// demoCancelRequested is a sticky flag so cancellation works even
// outside an @pauseForInput pause (e.g., user hits Esc / cancel
// during a long line execution).
let demoResolve: ((action: "continue" | "cancel") => void) | undefined;
let demoStatusItem: vscode.StatusBarItem | undefined;
let demoRunning = false;
let demoCancelRequested = false;
// Sync flag set BEFORE any await in runDemoScript() so two quick
// invocations (e.g. user spamming the right-click action while the
// file picker is open) can't both pass the `if (demoRunning)` check
// and end up interleaving lines.  Mirrors the demoStarting fix in
// PR #2277's @shell run.
let demoStarting = false;
// The bridge that owns the currently-running demo. Demo state
// notifications and Esc cancellation must target this bridge — NOT
// `activeChat?.bridge`, which can shift mid-demo if focus moves.
let activeDemoBridge: AgentServerBridge | undefined;

function setDemoState(
    running: boolean,
    paused: boolean,
    message?: string,
): void {
    demoRunning = running;
    vscode.commands.executeCommand(
        "setContext",
        "vscode-shell.demoPaused",
        paused,
    );
    activeChat?.bridge.notifyDemoState(running, paused, message);
    // Also notify the demo's own bridge if it's a different chat (the
    // active chat can shift mid-demo if the user focuses another panel,
    // and the demo state must always reach the panel that owns the
    // running script).
    if (activeDemoBridge && activeDemoBridge !== activeChat?.bridge) {
        try {
            activeDemoBridge.notifyDemoState(running, paused, message);
        } catch {
            // best effort
        }
    }
    if (paused) {
        if (!demoStatusItem) {
            demoStatusItem = vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Right,
                1000,
            );
            demoStatusItem.backgroundColor = new vscode.ThemeColor(
                "statusBarItem.warningBackground",
            );
        }
        demoStatusItem.text = `$(debug-pause) Demo paused — Alt+→ continue, Esc cancel${
            message ? ` (${message})` : ""
        }`;
        demoStatusItem.show();
    } else {
        demoStatusItem?.hide();
    }
}

// Back-compat alias used by other modules.
function setDemoPaused(paused: boolean, message?: string): void {
    setDemoState(demoRunning, paused, message);
}

function requestDemoCancel(): void {
    demoCancelRequested = true;
    // Tell every chat webview to abort any in-flight typing animation
    // so the current demo line stops typing immediately. The webview
    // posts back `demoLineCancelled` which releases the matching
    // bridge.runCommand await so the loop's top-of-iteration check can
    // see `demoCancelRequested` and break.
    for (const entry of chats.values()) {
        try {
            entry.bridge.broadcastCancelTyping();
        } catch {
            // best effort
        }
    }
    // Also cancel any in-flight dispatcher request the demo line has
    // already submitted (typing finished, command running on the
    // server). Without this Esc only stops mid-typing — once a line has
    // been sent, the server runs to completion before the demo loop
    // wakes up and sees the cancel flag.
    if (activeDemoBridge) {
        try {
            activeDemoBridge.cancelAllInFlight();
        } catch {
            // best effort
        }
    }
    // If we're currently waiting at an @pauseForInput, resolve it as
    // cancel so the loop wakes up and breaks. Otherwise the loop's
    // top-of-iteration check will handle it on the next line.
    demoResolve?.("cancel");
}

/**
 * Open a .txt demo script and replay it through the active chat,
 * mirroring the Electron shell's @shell run command. Lines starting
 * with '#' are comments. '@pauseForInput' pauses until the presenter
 * presses Alt+Right to continue (or Alt+Left to cancel) — same as the
 * Electron shell.
 */
async function runDemoScript(): Promise<void> {
    if (!activeChat) {
        vscode.window.showWarningMessage(
            "TypeAgent: no active chat to run the demo in.",
        );
        return;
    }
    if (demoStarting || demoRunning) {
        vscode.window.showWarningMessage(
            "TypeAgent: a demo is already running. Wait for it to finish, press Esc to cancel it, or reload the window before starting another.",
        );
        return;
    }
    demoStarting = true;
    try {
        await runDemoScriptInner();
    } finally {
        demoStarting = false;
    }
}

async function runDemoScriptInner(): Promise<void> {
    if (!activeChat) return;
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { "Demo scripts": ["txt"] },
        openLabel: "Run Demo",
    });
    if (!picked || picked.length === 0) return;

    const fileUri = picked[0];
    let content: string;
    try {
        const buf = await vscode.workspace.fs.readFile(fileUri);
        content = Buffer.from(buf).toString("utf8");
    } catch (e: any) {
        vscode.window.showErrorMessage(
            `Failed to read demo script: ${e?.message ?? String(e)}`,
        );
        return;
    }

    const bridge = activeChat.bridge;
    activeDemoBridge = bridge;
    const lines = content.split(/\r?\n/);
    const fileName = fileUri.path.split(/[\\/]/).pop() ?? "demo";
    let cancelled = false;
    demoCancelRequested = false;
    setDemoState(true, false);

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Running demo: ${fileName}`,
                cancellable: true,
            },
            async (progress, token) => {
                token.onCancellationRequested(() => {
                    requestDemoCancel();
                });
                for (let i = 0; i < lines.length; i++) {
                    if (demoCancelRequested) {
                        cancelled = true;
                        break;
                    }
                    const raw = lines[i];
                    const line = raw.trim();
                    if (line.length === 0) continue;
                    if (line.startsWith("#")) continue;

                    if (line.startsWith("@pauseForInput")) {
                        // Steal focus back to the chat webview so VS Code's
                        // editor binding for Ctrl+Right doesn't shadow our
                        // demoContinue keybinding (the previous line often
                        // focused an editor, e.g. newFile / showTextDocument).
                        try {
                            await vscode.commands.executeCommand(
                                "vscode-shell.focusChat",
                            );
                        } catch {
                            // Best-effort; don't break the demo if focus fails.
                        }
                        setDemoState(
                            true,
                            true,
                            `line ${i + 1}/${lines.length}`,
                        );
                        const action = await new Promise<"continue" | "cancel">(
                            (resolve) => {
                                demoResolve = resolve;
                            },
                        );
                        demoResolve = undefined;
                        setDemoState(true, false);
                        if (action === "cancel" || demoCancelRequested) {
                            cancelled = true;
                            break;
                        }
                        continue;
                    }

                    progress.report({
                        message: `[${i + 1}/${lines.length}] ${line.slice(0, 60)}`,
                    });
                    try {
                        // Hard timeout so a hung command (e.g. reasoning that
                        // never returns) doesn't freeze the script — the user
                        // can still hit Ctrl+Right at the next @pauseForInput
                        // and recover the rest of the demo.
                        const DEMO_LINE_TIMEOUT_MS = 60_000;
                        let timeoutHandle: NodeJS.Timeout | undefined;
                        try {
                            await Promise.race([
                                bridge.runCommand(line),
                                new Promise<void>((_, reject) => {
                                    timeoutHandle = setTimeout(
                                        () =>
                                            reject(
                                                new Error(
                                                    `Demo line timed out after ${DEMO_LINE_TIMEOUT_MS / 1000}s: ${line.slice(0, 80)}`,
                                                ),
                                            ),
                                        DEMO_LINE_TIMEOUT_MS,
                                    );
                                }),
                            ]);
                        } finally {
                            // Always clear the timeout when the race
                            // resolves (winning side or runCommand
                            // throwing) so the timer doesn't tick down
                            // pointlessly. Over a long demo this would
                            // otherwise leak one timer per executed line.
                            if (timeoutHandle) clearTimeout(timeoutHandle);
                        }
                    } catch {
                        // runCommand surfaces errors through the webview;
                        // keep going so the demo isn't derailed by one bad line.
                    }
                }
                void cancelled;
            },
        );
    } finally {
        demoResolve = undefined;
        demoCancelRequested = false;
        setDemoState(false, false);
        activeDemoBridge = undefined;
    }
}

function setActive(entry: ChatEntry): void {
    if (activeChat === entry) {
        // Even if no change, ensure webview state matches (handles initial)
        entry.bridge.setActive(true);
        refreshStatusBar();
        return;
    }
    const prev = activeChat;
    activeChat = entry;
    prev?.bridge.setActive(false);
    entry.bridge.setActive(true);
    refreshStatusBar();
}

function setEntryFocused(entry: ChatEntry, focused: boolean): void {
    if (entry.focused === focused) return;
    entry.focused = focused;
    if (focused) setActive(entry);
    refreshFocusContext();
}

function refreshFocusContext(): void {
    const anyFocused = [...chats].some((c) => c.focused);
    vscode.commands.executeCommand(
        "setContext",
        "vscode-shell.chatFocused",
        anyFocused,
    );
}

function refreshStatusBar(): void {
    // Keep panel titles in sync with their bridge's display name
    for (const e of chats) {
        if (e.panel) {
            const desired = `TypeAgent ${e.bridge.getDisplayName()}`;
            if (e.panel.title !== desired) {
                e.panel.title = desired;
            }
        }
    }
    if (!activeChat) {
        statusBarItem.text = "$(debug-disconnect) TypeAgent";
        statusBarItem.tooltip = "TypeAgent — no active chat";
        statusBarItem.show();
        return;
    }
    const bridge = activeChat.bridge;
    const name = bridge.getDisplayName();
    if (bridge.isConnectedNow()) {
        statusBarItem.text = `$(plug) TypeAgent: ${name}`;
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = `$(debug-disconnect) TypeAgent: ${name}`;
        statusBarItem.backgroundColor = new vscode.ThemeColor(
            "statusBarItem.warningBackground",
        );
    }
    statusBarItem.tooltip = `Active chat: ${name}\nClick to focus`;
    statusBarItem.show();
}

function openNewChatPanel(
    context: vscode.ExtensionContext,
    provider: ChatViewProvider,
): void {
    panelCounter += 1;
    const n = panelCounter;
    const friendly = `Chat ${n}`;
    const title = `TypeAgent ${friendly}`;

    // Open in the column right of the right-most existing chat panel so
    // multiple panels lay out side-by-side instead of stacking as tabs.
    let targetColumn: vscode.ViewColumn = vscode.ViewColumn.Beside;
    let max = 0;
    for (const c of chats) {
        const col = c.panel?.viewColumn;
        if (typeof col === "number" && col > max) max = col;
    }
    if (max > 0) {
        // ViewColumn.One = 1, Two = 2, Three = 3, ... up to Nine = 9.
        targetColumn = Math.min(max + 1, 9) as vscode.ViewColumn;
    }

    const panel = vscode.window.createWebviewPanel(
        "vscode-shell.chatPanel",
        title,
        targetColumn,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, "dist"),
                vscode.Uri.joinPath(context.extensionUri, "media"),
            ],
        },
    );
    attachChatPanel(context, provider, panel, {
        displayName: friendly,
        ephemeralSessionName: `cli-ephemeral-vscode-${n}-${Date.now()}`,
    });
}

function attachChatPanel(
    context: vscode.ExtensionContext,
    provider: ChatViewProvider,
    panel: vscode.WebviewPanel,
    opts: {
        displayName: string;
        ephemeralSessionName?: string;
        restoreSessionId?: string;
    },
): void {
    panel.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        "media",
        "icons",
        "typeagent.svg",
    );

    const bridge = new AgentServerBridge({
        ownsStatusBar: false,
        ephemeralSessionName: opts.ephemeralSessionName,
        displayName: opts.displayName,
        restoreSessionId: opts.restoreSessionId,
    });

    const entry: ChatEntry = {
        bridge,
        panel,
        statusDisposable: bridge.onStatusChange(() => refreshStatusBar()),
        focusDisposable: bridge.onWebviewFocus((f) => {
            setEntryFocused(entry, f);
        }),
        focused: false,
    };
    chats.add(entry);
    setActive(entry);

    const bridgeDisposable = provider.wireWebview(panel.webview, bridge);

    panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) {
            setActive(entry);
        } else {
            setEntryFocused(entry, false);
        }
    });

    panel.onDidDispose(() => {
        bridgeDisposable.dispose();
        bridge.dispose();
        entry.statusDisposable.dispose();
        entry.focusDisposable.dispose();
        chats.delete(entry);
        if (activeChat === entry) {
            activeChat = undefined;
            const next = chats.values().next().value;
            if (next) setActive(next);
            else refreshStatusBar();
        }
        refreshFocusContext();
    });
}

export function deactivate(): void {
    sidebarBridge?.dispose();
    for (const e of chats) {
        e.bridge.dispose();
    }
    chats.clear();
    statusBarItem?.dispose();
}
