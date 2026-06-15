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
        const codiconPath = vscode.Uri.joinPath(
            this._extensionUri,
            "media",
            "codicon.css",
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
        const codiconUri = `${webview.asWebviewUri(codiconPath)}?v=${stamp(codiconPath)}`;
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
    <link href="${codiconUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>TypeAgent Chat</title>
</head>
<body>
    <div id="chat-container">
        <div id="session-bar" class="session-name-bar">
            <span class="session-name-label">Session</span>
            <button
                id="session-name-btn"
                type="button"
                class="session-name-btn"
                title="Search conversations"
                aria-label="Search conversations"
            >
                Conversation
            </button>
            <div id="session-rename-editor" class="session-rename-editor hidden">
                <input
                    id="session-rename-input"
                    type="text"
                    title="Rename conversation"
                    aria-label="Rename conversation"
                />
                <button
                    id="session-rename-save-btn"
                    type="button"
                    class="session-action-btn"
                    title="Save conversation name"
                    aria-label="Save conversation name"
                >
                    <span class="codicon codicon-check session-action-icon" aria-hidden="true"></span>
                </button>
                <button
                    id="session-rename-cancel-btn"
                    type="button"
                    class="session-action-btn"
                    title="Cancel rename"
                    aria-label="Cancel rename"
                >
                    <span class="codicon codicon-close session-action-icon" aria-hidden="true"></span>
                </button>
            </div>
            <span id="session-status-summary" class="session-status-summary disconnected">Disconnected</span>
            <div class="session-actions" aria-label="Session actions">
                <button
                    id="session-rename-btn"
                    type="button"
                    class="session-action-btn"
                    title="Rename conversation"
                    aria-label="Rename conversation"
                >
                    <span class="codicon codicon-edit session-action-icon" aria-hidden="true"></span>
                </button>
                <button
                    id="session-delete-btn"
                    type="button"
                    class="session-action-btn"
                    title="Delete conversation"
                    aria-label="Delete conversation"
                >
                    <span class="codicon codicon-trash session-action-icon" aria-hidden="true"></span>
                </button>
            </div>
            <div id="session-create-popover" class="session-popover session-create-popover hidden">
                <div class="session-create-input-wrapper">
                    <input
                        id="session-new-name"
                        type="text"
                        placeholder="New session name"
                        title="New session name"
                    />
                    <button
                        id="session-create-btn"
                        type="button"
                        class="session-create-submit"
                        title="Create conversation"
                        aria-label="Create conversation"
                    >
                        +
                    </button>
                </div>
                <div id="session-create-hint" class="session-create-hint hidden">Session already exists</div>
            </div>
            <div id="session-search-popover" class="session-popover session-search-popover hidden">
                <input
                    id="session-search-input"
                    type="text"
                    placeholder="Search conversations"
                    title="Search conversations"
                />
                <div id="session-search-results" class="session-search-results" role="listbox"></div>
            </div>
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
