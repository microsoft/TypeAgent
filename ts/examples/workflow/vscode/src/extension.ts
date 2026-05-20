// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL VS Code extension.
 *
 * Activates the LanguageClient, registers commands (IR preview, graph
 * preview stub), and wires live-refresh of any open IR preview tab
 * when the source `.wf` file is saved.
 */

import * as path from "node:path";
import {
    commands,
    ExtensionContext,
    window,
    workspace,
    Uri,
    TextDocument as VsTextDocument,
    WorkspaceEdit,
    Range,
} from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

/** URI scheme used for all IR preview documents. */
const IR_PREVIEW_SCHEME = "untitled";
/** A map from .wf URI → currently-open IR preview document. */
const irPreviewDocs = new Map<string, VsTextDocument>();

interface CompileIRResult {
    ir?: unknown;
    errors: {
        phase: string;
        message: string;
        line: number;
        col: number;
    }[];
}

export function activate(context: ExtensionContext): void {
    const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ["--nolazy", "--inspect=6009"] },
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "workflow" }],
        synchronize: {
            configurationSection: "workflow",
            fileEvents: workspace.createFileSystemWatcher("**/*.wf"),
        },
    };

    client = new LanguageClient(
        "workflow",
        "Workflow Language Server",
        serverOptions,
        clientOptions,
    );

    context.subscriptions.push(
        commands.registerCommand("workflow.previewIR", previewIR),
        commands.registerCommand("workflow.previewGraph", previewGraph),
    );

    // Live-refresh IR preview when a .wf file is saved.
    context.subscriptions.push(
        workspace.onDidSaveTextDocument(async (savedDoc) => {
            if (savedDoc.languageId !== "workflow") return;
            const previewDoc = irPreviewDocs.get(savedDoc.uri.toString());
            if (!previewDoc) return;
            await refreshIRPreview(savedDoc.uri.toString(), previewDoc);
        }),
    );

    // Drop tracked IR preview documents when their tab is closed so the
    // map doesn't grow without bound over a long VS Code session.
    context.subscriptions.push(
        workspace.onDidCloseTextDocument((closed) => {
            for (const [wfUri, previewDoc] of irPreviewDocs) {
                if (previewDoc.uri.toString() === closed.uri.toString()) {
                    irPreviewDocs.delete(wfUri);
                }
            }
        }),
    );

    client.start();
}

async function fetchIRContent(wfUri: string): Promise<string> {
    if (!client) return JSON.stringify({ error: "Language client not ready" });
    const result = await client.sendRequest<CompileIRResult>(
        "workflow/compileIR",
        { uri: wfUri },
    );
    return result.errors.length
        ? JSON.stringify({ errors: result.errors }, null, 2)
        : JSON.stringify(result.ir, null, 2);
}

async function refreshIRPreview(
    wfUri: string,
    previewDoc: VsTextDocument,
): Promise<void> {
    try {
        const content = await fetchIRContent(wfUri);
        const edit = new WorkspaceEdit();
        const fullRange = new Range(0, 0, previewDoc.lineCount, 0);
        edit.replace(previewDoc.uri, fullRange, content);
        await workspace.applyEdit(edit);
    } catch {
        // Ignore refresh errors silently; the user can re-run the command.
    }
}

async function previewIR(): Promise<void> {
    const editor = window.activeTextEditor;
    if (!editor || editor.document.languageId !== "workflow") {
        window.showInformationMessage("Open a .wf file to preview its IR.");
        return;
    }
    if (!client) return;
    try {
        const wfUri = editor.document.uri.toString();
        const content = await fetchIRContent(wfUri);
        const doc = await workspace.openTextDocument({
            content,
            language: "json",
        });
        // Track this preview doc so we can refresh it on save.
        irPreviewDocs.set(wfUri, doc);
        await window.showTextDocument(doc, { preview: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        window.showErrorMessage(`Workflow IR preview failed: ${message}`);
    }
}

function previewGraph(): void {
    window.showInformationMessage(
        "Workflow graph preview is coming in a follow-up release.",
    );
    void Uri.parse;
}

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
