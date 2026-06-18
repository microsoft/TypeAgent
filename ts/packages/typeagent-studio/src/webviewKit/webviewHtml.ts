// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Pure builders for a VS Code webview's HTML shell.
 *
 * Kept free of `vscode`/DOM so the strict Content-Security-Policy can be
 * unit-tested. The host (`host.ts`) supplies the resolved `asWebviewUri`
 * strings and `cspSource`. The per-load nonce comes from the shared
 * {@link createWebviewNonce} so every webview surface uses one crypto source.
 */

import { createWebviewNonce } from "@typeagent/core/webview";

export { createWebviewNonce };

export interface WebviewHtmlOptions {
    /** Per-load nonce from {@link createWebviewNonce}. */
    nonce: string;
    /** `webview.cspSource` for the hosting webview. */
    cspSource: string;
    /** `asWebviewUri` of the client script bundle. */
    scriptUri: string;
    /** `asWebviewUri` of the stylesheet. */
    styleUri: string;
    /** Document title. */
    title: string;
}

/**
 * Build a locked-down HTML document for a webview: `default-src 'none'`, scripts
 * and styles only from the per-load nonce or the webview's own resource origin,
 * no base-uri / form-action. The body is a single mount point the client bundle
 * renders into; no inline scripts or inline `style=""` attributes are used (the
 * nonce does not cover inline style attributes).
 */
export function buildWebviewHtml(options: WebviewHtmlOptions): string {
    const { nonce, cspSource, scriptUri, styleUri, title } = options;
    const csp = [
        "default-src 'none'",
        `img-src ${cspSource} data:`,
        `font-src ${cspSource}`,
        `style-src ${cspSource} 'nonce-${nonce}'`,
        `script-src 'nonce-${nonce}'`,
        "base-uri 'none'",
        "form-action 'none'",
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${styleUri}" rel="stylesheet" nonce="${nonce}" />
<title>${escapeHtml(title)}</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
