// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { AgentServerBridge } from "./agentServerBridge";

/**
 * Provides the chat webview for the sidebar (uses primary bridge) and
 * helper for editor panels (each gets its own bridge).
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "vscode-shell.chatView";

    private _sidebarView?: vscode.WebviewView;
    private _onSidebarResolved?: (view: vscode.WebviewView) => void;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _primaryBridge: AgentServerBridge,
    ) {}

    public onSidebarResolved(cb: (view: vscode.WebviewView) => void): void {
        this._onSidebarResolved = cb;
        if (this._sidebarView) cb(this._sidebarView);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._sidebarView = webviewView;
        this.wireWebview(webviewView.webview, this._primaryBridge);

        webviewView.onDidDispose(() => {
            this._sidebarView = undefined;
        });

        this._onSidebarResolved?.(webviewView);
    }

    /**
     * Configure a webview (panel) with the chat UI and bind it to a bridge.
     * Used both by the sidebar (primary bridge) and per-panel bridges.
     */
    public wireWebview(
        webview: vscode.Webview,
        bridge: AgentServerBridge,
    ): vscode.Disposable {
        webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, "dist"),
                vscode.Uri.joinPath(this._extensionUri, "media"),
            ],
        };

        webview.html = this._getHtmlForWebview(webview);

        const bridgeDisposable = bridge.registerWebview(webview);
        // Auto-connect when webview opens
        bridge.connect();
        return bridgeDisposable;
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
            <button id="send-btn" title="Send"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 2048 2048"><path d="M2048 960q0 19-10 34t-27 24L91 1914q-12 6-27 6-28 0-46-18t-18-47v-9q0-4 2-8l251-878L2 82q-2-4-2-8t0-9q0-28 18-46T64 0q15 0 27 6l1920 896q37 17 37 58zM164 1739l1669-779L164 181l205 715h847q26 0 45 19t19 45q0 26-19 45t-45 19H369l-205 715z"/></svg></button>
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
