// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider";
import { AgentServerBridge } from "./agentServerBridge";

let primaryBridge: AgentServerBridge | undefined;
// Track per-panel bridges so we can dispose them on extension deactivate
const panelBridges = new Set<AgentServerBridge>();
let panelCounter = 0;

export function activate(context: vscode.ExtensionContext): void {
    primaryBridge = new AgentServerBridge({ ownsStatusBar: true });

    const provider = new ChatViewProvider(context.extensionUri, primaryBridge);

    // Sidebar webview provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            provider,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
    );

    // Command: open a NEW chat in an editor tab beside the current view.
    // Each invocation creates a fresh ephemeral session + bridge so panels
    // are independent of each other and of the sidebar.
    context.subscriptions.push(
        vscode.commands.registerCommand("typeagent-shell.openChat", () => {
            openNewChatPanel(context, provider);
        }),
    );

    // Alias for clarity
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-shell.newChatPanel",
            () => openNewChatPanel(context, provider),
        ),
    );

    // Command: focus the sidebar chat
    context.subscriptions.push(
        vscode.commands.registerCommand("typeagent-shell.focusChat", () => {
            vscode.commands.executeCommand(
                "typeagent-shell.chatView.focus",
            );
        }),
    );

    // Conversation management commands — operate on the primary (sidebar)
    // bridge. Per-panel chats are intentionally ephemeral.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "typeagent-shell.switchSession",
            () => primaryBridge?.switchSession(),
        ),
        vscode.commands.registerCommand(
            "typeagent-shell.newSession",
            () => primaryBridge?.newSession(),
        ),
        vscode.commands.registerCommand(
            "typeagent-shell.renameSession",
            () => primaryBridge?.renameCurrentSession(),
        ),
        vscode.commands.registerCommand(
            "typeagent-shell.deleteSession",
            () => primaryBridge?.deleteSession(),
        ),
    );
}

function openNewChatPanel(
    context: vscode.ExtensionContext,
    provider: ChatViewProvider,
): void {
    panelCounter += 1;
    const title = `TypeAgent Chat ${panelCounter}`;
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
    panel.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        "media",
        "typeagent-icon.svg",
    );

    // Each panel gets its own bridge, its own connection, and its own
    // ephemeral session that's deleted when the panel closes.
    const bridge = new AgentServerBridge({
        ownsStatusBar: false,
        autoCreateSessionPrefix: "cli-ephemeral-vscode-",
    });
    panelBridges.add(bridge);

    const bridgeDisposable = provider.wireWebview(panel.webview, bridge);

    panel.onDidDispose(() => {
        bridgeDisposable.dispose();
        bridge.dispose();
        panelBridges.delete(bridge);
    });
}

export function deactivate(): void {
    primaryBridge?.dispose();
    for (const b of panelBridges) {
        b.dispose();
    }
    panelBridges.clear();
}
