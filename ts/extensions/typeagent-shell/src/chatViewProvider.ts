// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { AgentServerManager } from "./agentServerManager";

/**
 * Provides the chat webview for both the sidebar panel and editor tabs.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "typeagent-shell.chatView";

    private _sidebarView?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _serverManager: AgentServerManager,
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._sidebarView = webviewView;
        this.resolveWebviewPanel(webviewView.webview);
    }

    /**
     * Configure a webview (sidebar or editor panel) with the chat UI.
     */
    public resolveWebviewPanel(webview: vscode.Webview): void {
        webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, "dist"),
                vscode.Uri.joinPath(this._extensionUri, "media"),
            ],
        };

        webview.html = this._getHtmlForWebview(webview);

        // Handle messages from the webview
        webview.onDidReceiveMessage((message) => {
            switch (message.type) {
                case "getServerUrl":
                    webview.postMessage({
                        type: "serverUrl",
                        url: this._serverManager.getServerUrl(),
                    });
                    break;
                case "openExternal":
                    if (message.url) {
                        vscode.env.openExternal(
                            vscode.Uri.parse(message.url),
                        );
                    }
                    break;
                case "log":
                    console.log("[TypeAgent Webview]", message.text);
                    break;
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "dist", "webview.js"),
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "media", "chat.css"),
        );
        const nonce = getNonce();

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   style-src ${webview.cspSource} 'unsafe-inline';
                   script-src 'nonce-${nonce}';
                   connect-src ws://localhost:* wss://localhost:*;
                   img-src ${webview.cspSource} data:;
                   font-src ${webview.cspSource};">
    <link href="${styleUri}" rel="stylesheet">
    <title>TypeAgent Chat</title>
</head>
<body>
    <div id="chat-container">
        <div id="status-bar" class="status disconnected">Disconnected</div>
        <div id="messages"></div>
        <div id="input-area">
            <textarea id="chat-input" placeholder="Ask TypeAgent..." rows="1"></textarea>
            <button id="send-btn" title="Send">&#9654;</button>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = "";
    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
