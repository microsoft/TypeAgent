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
        const bridgeDisposable = this.wireWebview(
            webviewView.webview,
            this._primaryBridge,
        );

        webviewView.onDidDispose(() => {
            // Drop the bridge's reference to this webview so it stops
            // broadcasting to it (otherwise the bridge leaks listeners
            // and dead webview handles across recreate cycles).
            try {
                bridgeDisposable.dispose();
            } catch {
                // best effort
            }
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
        const scriptPath = vscode.Uri.joinPath(
            this._extensionUri,
            "dist",
            "webview.js",
        );
        const stylePath = vscode.Uri.joinPath(
            this._extensionUri,
            "media",
            "chat.css",
        );
        // Append each bundle's mtime as a query string so VS Code's
        // webview cache doesn't serve a stale resource after a deploy.
        // The base URI is the same after a rebuild, so without this the
        // browser re-uses the cached copy across "Reload Window". Use a
        // separate stamp per file so a CSS-only change still invalidates
        // the CSS cache (deriving both from the JS mtime would mask
        // CSS-only deploys).
        const fs: typeof import("fs") = require("fs");
        const stamp = (uri: vscode.Uri): number => {
            try {
                return fs.statSync(uri.fsPath).mtimeMs | 0;
            } catch {
                return Date.now();
            }
        };
        const scriptUri = `${webview.asWebviewUri(scriptPath)}?v=${stamp(scriptPath)}`;
        const styleUri = `${webview.asWebviewUri(stylePath)}?v=${stamp(stylePath)}`;
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
        <div id="session-bar" class="session-bar">
            <label for="session-select">Conversation</label>
            <select id="session-select" title="Select conversation"></select>
            <button
                id="session-refresh-btn"
                type="button"
                title="Refresh conversations"
                aria-label="Refresh conversations"
            >
                ↻
            </button>
            <input
                id="session-new-name"
                type="text"
                placeholder="New conversation name"
                title="New conversation name"
            />
            <button
                id="session-create-btn"
                type="button"
                title="Create conversation"
                aria-label="Create conversation"
            >
                +
            </button>
        </div>
        <div id="chat-root"></div>
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
