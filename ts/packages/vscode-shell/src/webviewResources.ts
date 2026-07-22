// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";

/**
 * Build a webview resource URI stamped with the file's mtime. The base URI is
 * unchanged after a rebuild, so without the stamp VS Code's webview cache
 * serves a stale bundle/stylesheet across "Reload Window". Stamping per file
 * means a CSS-only change still busts the CSS cache.
 */
export function stampedWebviewUri(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    ...parts: string[]
): string {
    const fs: typeof import("fs") = require("fs");
    const fsUri = vscode.Uri.joinPath(extensionUri, ...parts);
    let mtime: number;
    try {
        mtime = fs.statSync(fsUri.fsPath).mtimeMs | 0;
    } catch {
        mtime = Date.now();
    }
    return `${webview.asWebviewUri(fsUri)}?v=${mtime}`;
}
