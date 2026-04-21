// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider";
import { AgentServerBridge } from "./agentServerBridge";

let bridge: AgentServerBridge | undefined;

export function activate(context: vscode.ExtensionContext): void {
    bridge = new AgentServerBridge();

    const provider = new ChatViewProvider(context.extensionUri, bridge);

    // Sidebar webview provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            provider,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
    );

    // Command: open chat as an editor tab
    context.subscriptions.push(
        vscode.commands.registerCommand("typeagent-shell.openChat", () => {
            const panel = vscode.window.createWebviewPanel(
                "typeagent-shell.chatPanel",
                "TypeAgent Chat",
                vscode.ViewColumn.Beside,
                getWebviewOptions(context.extensionUri),
            );
            panel.iconPath = vscode.Uri.joinPath(
                context.extensionUri,
                "media",
                "typeagent-icon.svg",
            );
            provider.resolveWebviewPanel(panel.webview);
        }),
    );

    // Command: focus the sidebar chat
    context.subscriptions.push(
        vscode.commands.registerCommand("typeagent-shell.focusChat", () => {
            vscode.commands.executeCommand(
                "typeagent-shell.chatView.focus",
            );
        }),
    );
}

export function deactivate(): void {
    bridge?.dispose();
}

function getWebviewOptions(
    extensionUri: vscode.Uri,
): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
            vscode.Uri.joinPath(extensionUri, "dist"),
            vscode.Uri.joinPath(extensionUri, "media"),
        ],
    };
}
