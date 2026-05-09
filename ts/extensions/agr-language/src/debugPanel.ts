// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import {
    Disposable,
    Uri,
    ViewColumn,
    WebviewPanel,
    window,
    workspace,
} from "vscode";
import type { ExtensionContext } from "vscode";
import {
    loadGrammarFromBuffer,
    loadGrammarFromFile,
    previewCompletion,
    traceMatch,
    computeCoverage,
    diffGrammars,
    format,
    type LoadedGrammar,
    type LoadResult,
} from "grammar-tools-core";

/**
 * Messages from the webview to the extension host.
 */
interface WebviewRequest {
    id: number;
    method: string;
    params: unknown[];
}

/**
 * Response from the extension host to the webview.
 */
interface WebviewResponse {
    id: number;
    result?: unknown;
    error?: string | undefined;
}

/**
 * Manages the Grammar Debug Panel webview.
 */
export class DebugPanelManager implements Disposable {
    private panel: WebviewPanel | undefined;
    private disposables: Disposable[] = [];
    private grammars = new Map<string, LoadedGrammar>();
    private grammarSeq = 0;

    constructor(private readonly context: ExtensionContext) {}

    show(): void {
        if (this.panel) {
            this.panel.reveal(ViewColumn.Beside);
            return;
        }

        this.panel = window.createWebviewPanel(
            "agrDebugPanel",
            "Grammar Debug",
            ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    Uri.joinPath(this.context.extensionUri, "webview-dist"),
                ],
            },
        );

        this.panel.webview.html = this.getHtml();

        this.panel.webview.onDidReceiveMessage(
            (msg: WebviewRequest) => this.handleMessage(msg),
            undefined,
            this.disposables,
        );

        this.panel.onDidDispose(
            () => {
                this.panel = undefined;
                this.grammars.clear();
            },
            undefined,
            this.disposables,
        );
    }

    dispose(): void {
        this.panel?.dispose();
        for (const d of this.disposables) d.dispose();
        this.disposables = [];
    }

    private getHtml(): string {
        const webview = this.panel!.webview;
        const scriptUri = webview.asWebviewUri(
            Uri.joinPath(
                this.context.extensionUri,
                "webview-dist",
                "debugPanel.js",
            ),
        );
        const nonce = getNonce();

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   script-src 'nonce-${nonce}';
                   style-src 'unsafe-inline';
                   font-src ${webview.cspSource};">
    <title>Grammar Debug</title>
    <style>
        body {
            margin: 0;
            padding: 8px;
            font-family: var(--vscode-font-family, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
    </style>
</head>
<body>
    <gt-debug-panel id="panel"></gt-debug-panel>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private async handleMessage(msg: WebviewRequest): Promise<void> {
        const respond = (result?: unknown, error?: string) => {
            const response: WebviewResponse = { id: msg.id, result, error };
            this.panel?.webview.postMessage(response);
        };

        try {
            const result = await this.dispatch(msg.method, msg.params);
            respond(result);
        } catch (e: unknown) {
            respond(undefined, e instanceof Error ? e.message : String(e));
        }
    }

    private async dispatch(
        method: string,
        params: unknown[],
    ): Promise<unknown> {
        switch (method) {
            case "loadGrammarFromFile": {
                const [filePath] = params as [string];
                const result = await loadGrammarFromFile(filePath);
                return this.storeGrammar(result);
            }
            case "loadGrammarFromBuffer": {
                const [id, text] = params as [string, string];
                const result = loadGrammarFromBuffer(id, text);
                return this.storeGrammar(result);
            }
            case "loadGrammarFromActiveEditor": {
                const editor = window.activeTextEditor;
                if (!editor || editor.document.languageId !== "agr") {
                    return { ok: false, diagnostics: [], files: [] };
                }
                const text = editor.document.getText();
                const fileId = path.basename(editor.document.fileName);
                const result = loadGrammarFromBuffer(fileId, text);
                return this.storeGrammar(result);
            }
            case "previewCompletion": {
                const [handle, input] = params as [string, string];
                const grammar = this.getGrammar(handle);
                return previewCompletion(grammar, input);
            }
            case "traceMatch": {
                const [handle, input] = params as [string, string];
                const grammar = this.getGrammar(handle);
                return traceMatch(grammar, input);
            }
            case "computeCoverage": {
                const [handle, inputs] = params as [string, string[]];
                const grammar = this.getGrammar(handle);
                return computeCoverage(grammar, inputs);
            }
            case "diffGrammars": {
                const [handleA, handleB] = params as [string, string];
                const grammarA = this.getGrammar(handleA);
                const grammarB = this.getGrammar(handleB);
                return diffGrammars(grammarA, grammarB);
            }
            case "format": {
                const [handle] = params as [string];
                const grammar = this.getGrammar(handle);
                const source = grammar.files?.[0]?.text ?? "";
                return format(source);
            }
            case "listAgents": {
                // Scan workspace for agents with .agr files
                const files = await workspace.findFiles(
                    "**/packages/agents/*/src/*.agr",
                    null,
                    50,
                );
                const agents = new Set<string>();
                for (const f of files) {
                    const parts = f.path.split("/");
                    const agentsIdx = parts.indexOf("agents");
                    if (agentsIdx >= 0 && agentsIdx + 1 < parts.length) {
                        agents.add(parts[agentsIdx + 1]);
                    }
                }
                return [...agents].sort();
            }
            default:
                throw new Error(`Unknown method: ${method}`);
        }
    }

    /**
     * Store a LoadedGrammar and return a serializable LoadResult with a
     * handle string replacing the opaque grammar object.
     */
    private storeGrammar(result: LoadResult): unknown {
        if (!result.ok) {
            return result;
        }
        const handle = `grammar:${++this.grammarSeq}`;
        this.grammars.set(handle, result.grammar);
        return {
            ok: true,
            handle,
            identifiers: result.grammar.identifiers,
            debugInfo: result.grammar.debugInfo
                ? {
                      grammarHash: result.grammar.debugInfo.grammarHash,
                      rules: [...result.grammar.debugInfo.rules.entries()],
                      parts: [...result.grammar.debugInfo.parts.entries()],
                  }
                : undefined,
            files: result.grammar.files,
            source: result.grammar.source,
            diagnostics: result.diagnostics,
        };
    }

    private getGrammar(handle: string): LoadedGrammar {
        const grammar = this.grammars.get(handle);
        if (!grammar) {
            throw new Error(`Invalid grammar handle: ${handle}`);
        }
        return grammar;
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
