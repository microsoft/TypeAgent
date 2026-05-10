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
    type CompletionOptions,
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
 * A single debug panel instance, associated with one .agr file.
 * Owns its own webview, grammar handle map, and save listener.
 */
class DebugPanelInstance implements Disposable {
    private panel: WebviewPanel;
    private disposables: Disposable[] = [];
    private grammars = new Map<string, LoadedGrammar>();
    private grammarSeq = 0;
    private saveListener: Disposable;

    constructor(
        private readonly context: ExtensionContext,
        readonly fileUri: Uri,
        private readonly onDisposed: (instance: DebugPanelInstance) => void,
    ) {
        const name = path.basename(fileUri.fsPath);
        this.panel = window.createWebviewPanel(
            "agrDebugPanel",
            `Grammar Debug: ${name}`,
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
                this.grammars.clear();
                this.saveListener.dispose();
                this.onDisposed(this);
            },
            undefined,
            this.disposables,
        );

        // Watch for saves of the associated file
        this.saveListener = workspace.onDidSaveTextDocument((doc) => {
            if (doc.uri.toString() === this.fileUri.toString()) {
                this.pushGrammarFromFile();
            }
        });

        // Push initial grammar
        this.pushGrammarFromFile();
    }

    reveal(): void {
        this.panel.reveal(ViewColumn.Beside);
    }

    dispose(): void {
        this.saveListener.dispose();
        this.panel.dispose();
        for (const d of this.disposables) d.dispose();
        this.disposables = [];
        this.grammars.clear();
    }

    private getHtml(): string {
        const webview = this.panel.webview;
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
                   style-src ${webview.cspSource} 'unsafe-inline';
                   font-src ${webview.cspSource};">
    <title>Grammar Debug</title>
    <!-- 'unsafe-inline' is required for Lit component styles
         (adoptedStyleSheets / shadow DOM <style> tags lack nonces) -->
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
            this.panel.webview.postMessage(response);
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
                // Always use the associated file for this panel
                const doc = await workspace.openTextDocument(this.fileUri);
                const text = doc.getText();
                const fileId = path.basename(this.fileUri.fsPath);
                const result = loadGrammarFromBuffer(fileId, text);
                return this.storeGrammar(result);
            }
            case "previewCompletion": {
                const [handle, input, options] = params as [
                    string,
                    string,
                    CompletionOptions | undefined,
                ];
                const grammar = this.getGrammar(handle);
                return previewCompletion(grammar, input, options);
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
                      partRules: [
                          ...result.grammar.debugInfo.partRules.entries(),
                      ],
                      filePaths: [
                          ...result.grammar.debugInfo.filePaths.entries(),
                      ],
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

    private async pushGrammarFromFile(): Promise<void> {
        try {
            const doc = await workspace.openTextDocument(this.fileUri);
            const text = doc.getText();
            const fileId = path.basename(this.fileUri.fsPath);
            const result = loadGrammarFromBuffer(fileId, text);
            const serialized = this.storeGrammar(result);
            this.panel.webview.postMessage({
                type: "grammarLoaded",
                result: serialized,
            });
        } catch {
            // Best-effort
        }
    }
}

/**
 * Registry that manages one DebugPanelInstance per .agr file.
 */
export class DebugPanelManager implements Disposable {
    private instances = new Map<string, DebugPanelInstance>();

    constructor(private readonly context: ExtensionContext) {}

    /**
     * Show or create a debug panel for the given file URI.
     * If no URI is provided, uses the active editor.
     */
    show(fileUri?: Uri): void {
        if (!fileUri) {
            const editor = window.activeTextEditor;
            if (!editor || editor.document.languageId !== "agr") {
                window.showErrorMessage("Open an .agr file first.");
                return;
            }
            fileUri = editor.document.uri;
        }

        const key = fileUri.toString();
        const existing = this.instances.get(key);
        if (existing) {
            existing.reveal();
            return;
        }

        const instance = new DebugPanelInstance(
            this.context,
            fileUri,
            (disposed) => {
                this.instances.delete(disposed.fileUri.toString());
            },
        );
        this.instances.set(key, instance);
    }

    dispose(): void {
        for (const instance of this.instances.values()) {
            instance.dispose();
        }
        this.instances.clear();
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
