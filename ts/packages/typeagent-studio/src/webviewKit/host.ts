// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { buildWebviewHtml, createWebviewNonce } from "./webviewHtml.js";

export interface WebviewKitPanelOptions {
    /** Stable view type; one live panel per type (reveal-existing behavior). */
    viewType: string;
    /**
     * Optional sub-key that lets several panels of the same `viewType` coexist
     * (e.g. one Impact Report per agent). Reveal-existing keys on
     * `viewType` + `instanceKey`, so distinct keys open distinct tabs the user
     * can place side-by-side; omit it for the singleton behavior.
     */
    instanceKey?: string;
    title: string;
    /**
     * Keep the webview's context (DOM + script state + live messaging channel)
     * alive while the panel is hidden instead of tearing it down and reloading
     * on reveal. Defaults to `false`. Set `true` for panels that hold live
     * state (an open connection, a rendered result) so navigating away and back
     * doesn't drop the agent/connection context and strand a one-shot reveal
     * handshake. Costs memory while hidden.
     */
    retainContextWhenHidden?: boolean;
    /**
     * Which editor column to open the panel in. Defaults to
     * {@link vscode.ViewColumn.Active}. A drill-in panel opened from another
     * webview passes {@link vscode.ViewColumn.Beside} so it sits next to its
     * originator instead of stealing its column.
     */
    viewColumn?: vscode.ViewColumn;
    /** Path segments (from the extension root) to the client script bundle. */
    scriptPath: string[];
    /** Path segments (from the extension root) to the stylesheet. */
    stylePath: string[];
    /** Called for every message the webview posts (already JSON-parsed). */
    onMessage: (message: unknown) => void;
    /** Called when the panel is disposed (user close or programmatic). */
    onDispose?: () => void;
}

/**
 * Thin, reusable wrapper over a `vscode.WebviewPanel`: enforces one live panel
 * per `viewType` (or per `viewType`+`instanceKey` when set) — revealing the
 * existing one instead of opening a second — builds a locked-down CSP'd HTML
 * shell with a per-load nonce, restricts `localResourceRoots` to the bundle +
 * media dirs, and exposes typed `post`/`dispose`. State restore is left to the
 * webview via `setState`; panels that hold live state can opt into
 * `retainContextWhenHidden` so a reveal doesn't tear down and reload them.
 */
export class WebviewKitPanel {
    private static readonly live = new Map<string, WebviewKitPanel>();

    private disposed = false;
    private readonly disposables: vscode.Disposable[] = [];

    private constructor(
        public readonly panel: vscode.WebviewPanel,
        private readonly options: WebviewKitPanelOptions,
    ) {
        this.panel.webview.onDidReceiveMessage(
            (m) => this.options.onMessage(m),
            undefined,
            this.disposables,
        );
        this.panel.onDidDispose(
            () => this.handleDispose(),
            undefined,
            this.disposables,
        );
    }

    /** Create the panel, or reveal the existing one for this `viewType`. */
    static createOrReveal(
        context: vscode.ExtensionContext,
        options: WebviewKitPanelOptions,
    ): WebviewKitPanel {
        const key = WebviewKitPanel.registryKey(options);
        const existing = WebviewKitPanel.live.get(key);
        if (existing) {
            existing.panel.reveal();
            return existing;
        }
        const scriptRoot = vscode.Uri.joinPath(
            context.extensionUri,
            ...options.scriptPath.slice(0, -1),
        );
        const styleRoot = vscode.Uri.joinPath(
            context.extensionUri,
            ...options.stylePath.slice(0, -1),
        );
        const panel = vscode.window.createWebviewPanel(
            options.viewType,
            options.title,
            options.viewColumn ?? vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden:
                    options.retainContextWhenHidden ?? false,
                localResourceRoots: [scriptRoot, styleRoot],
            },
        );
        const wrapper = new WebviewKitPanel(panel, options);
        WebviewKitPanel.live.set(key, wrapper);
        wrapper.render(context);
        return wrapper;
    }

    /** Registry key: distinct per (viewType, instanceKey) so per-instance panels
     *  (e.g. one Impact Report per agent) don't collapse onto one another. */
    private static registryKey(options: WebviewKitPanelOptions): string {
        return options.instanceKey !== undefined
            ? `${options.viewType}::${options.instanceKey}`
            : options.viewType;
    }

    private render(context: vscode.ExtensionContext): void {
        const nonce = createWebviewNonce();
        const scriptUri = this.panel.webview
            .asWebviewUri(
                vscode.Uri.joinPath(
                    context.extensionUri,
                    ...this.options.scriptPath,
                ),
            )
            .toString();
        const styleUri = this.panel.webview
            .asWebviewUri(
                vscode.Uri.joinPath(
                    context.extensionUri,
                    ...this.options.stylePath,
                ),
            )
            .toString();
        this.panel.webview.html = buildWebviewHtml({
            nonce,
            cspSource: this.panel.webview.cspSource,
            scriptUri,
            styleUri,
            title: this.options.title,
        });
    }

    /** Post a message to the webview (no-op once disposed). */
    post(message: unknown): void {
        if (this.disposed) {
            return;
        }
        void this.panel.webview.postMessage(message);
    }

    dispose(): void {
        this.panel.dispose();
    }

    private handleDispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        WebviewKitPanel.live.delete(WebviewKitPanel.registryKey(this.options));
        for (const d of this.disposables.splice(0)) {
            d.dispose();
        }
        this.options.onDispose?.();
    }
}
