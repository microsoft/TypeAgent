// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider";
import { AgentServerBridge } from "./agentServerBridge";

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
    statusBarItem.command = "typeagent-shell.focusChat";
    context.subscriptions.push(statusBarItem);

    sidebarBridge = new AgentServerBridge({
        ownsStatusBar: false,
        displayName: "Sidebar",
    });

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
            statusDisposable: sidebarBridge!.onStatusChange(() =>
                refreshStatusBar(),
            ),
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
        vscode.commands.registerCommand("typeagent-shell.openChat", () => {
            openNewChatPanel(context, provider);
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-shell.newChatPanel",
            () => openNewChatPanel(context, provider),
        ),
    );

    // Serializer: restore previously-open chat panels on window reopen.
    context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer(
            "typeagent-shell.chatPanel",
            {
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
                        ephemeralSessionName: sessionId
                            ? undefined
                            : `cli-ephemeral-vscode-${n}-${Date.now()}`,
                        restoreSessionId: sessionId,
                    });
                },
            },
        ),
    );

    // Command: focus the sidebar chat
    context.subscriptions.push(
        vscode.commands.registerCommand("typeagent-shell.focusChat", () => {
            // If active chat is a panel, reveal it; otherwise focus sidebar
            if (activeChat?.panel) {
                activeChat.panel.reveal();
            } else {
                vscode.commands.executeCommand(
                    "typeagent-shell.chatView.focus",
                );
            }
        }),
    );

    // Conversation management commands — operate on the ACTIVE chat
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-shell.switchSession",
            () => activeChat?.bridge.switchSession(),
        ),
        vscode.commands.registerCommand(
            "typeagent-shell.newSession",
            () => activeChat?.bridge.newSession(),
        ),
        vscode.commands.registerCommand(
            "typeagent-shell.renameSession",
            () => activeChat?.bridge.renameCurrentSession(),
        ),
        vscode.commands.registerCommand(
            "typeagent-shell.deleteSession",
            () => activeChat?.bridge.deleteSession(),
        ),
        vscode.commands.registerCommand(
            "typeagent-shell.clearChat",
            () => activeChat?.bridge.clearChatUI(),
        ),
    );
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
        "typeagent-shell.chatFocused",
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
    const panel = vscode.window.createWebviewPanel(
        "typeagent-shell.chatPanel",
        title,
        vscode.ViewColumn.Beside,
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
        "typeagent-icon.svg",
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
