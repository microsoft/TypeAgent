// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { createWebviewNonce } from "@typeagent/core/webview";
import { AgentServerBridge } from "./agentServerBridge.js";
import { stampedWebviewUri } from "./webviewResources.js";

/**
 * Provides the chat webview for the sidebar (uses primary bridge) and
 * helper for editor panels (each gets its own bridge).
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "vscode-shell.chatView";

    private _sidebarView?: vscode.WebviewView;
    private _onSidebarResolved?: (view: vscode.WebviewView) => void;
    private _activateNewSessionInputWhenReady = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _primaryBridge: AgentServerBridge,
    ) {}

    public onSidebarResolved(cb: (view: vscode.WebviewView) => void): void {
        this._onSidebarResolved = cb;
        if (this._sidebarView) cb(this._sidebarView);
    }

    public activateNewSessionInput(): void {
        if (!this._sidebarView) {
            this._activateNewSessionInputWhenReady = true;
            return;
        }
        this._activateNewSessionInputWhenReady = false;
        this._primaryBridge.activateNewSessionInput(this._sidebarView.webview);
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
        if (this._activateNewSessionInputWhenReady) {
            this.activateNewSessionInput();
        }
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
        const scriptUri = stampedWebviewUri(
            webview,
            this._extensionUri,
            "dist",
            "webview.js",
        );
        const styleUri = stampedWebviewUri(
            webview,
            this._extensionUri,
            "media",
            "chat.css",
        );
        const codiconUri = stampedWebviewUri(
            webview,
            this._extensionUri,
            "media",
            "codicon.css",
        );
        const nonce = createWebviewNonce();

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
                   media-src blob: mediastream: data:;
                   font-src ${webview.cspSource};">
    <link href="${codiconUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>TypeAgent Chat</title>
</head>
<body>
    <div id="chat-container">
        <div id="conversation-bar-root"></div>
        <div id="chat-root"></div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
