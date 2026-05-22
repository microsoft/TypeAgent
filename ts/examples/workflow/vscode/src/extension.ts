// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL VS Code extension.
 *
 * Activates the LanguageClient, registers the IR / graph preview and
 * "show server output" commands, and wires live-refresh of any open
 * preview when the source `.wf` file is saved.
 */

import * as path from "node:path";
import {
    commands,
    ExtensionContext,
    window,
    workspace,
    TextDocument as VsTextDocument,
    WebviewPanel,
    WorkspaceEdit,
    Range,
} from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";
import {
    createGraphPanel,
    renderGraph,
    type PreviewGraphResult,
} from "./graphPreview";

let client: LanguageClient | undefined;
let clientReady: Promise<void> | undefined;
let serverOutputChannel: import("vscode").LogOutputChannel | undefined;

/** A map from .wf URI → currently-open IR preview document. */
const irPreviewDocs = new Map<string, VsTextDocument>();
/** A map from .wf URI → currently-open graph preview panel. */
const graphPreviewPanels = new Map<string, WebviewPanel>();

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

    // Explicit output channel so the `workflow.trace.server` setting
    // and any server-side `console.log`s land in a discoverable place.
    // (vscode-languageclient binds the trace setting by client id, so
    //  the channel name is purely cosmetic / for command discovery.)
    serverOutputChannel = window.createOutputChannel(
        "Workflow Language Server",
        { log: true },
    );

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "workflow" }],
        synchronize: {
            configurationSection: "workflow",
            fileEvents: workspace.createFileSystemWatcher("**/*.wf"),
        },
        outputChannel: serverOutputChannel,
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
        commands.registerCommand("workflow.showServerOutput", () =>
            serverOutputChannel?.show(true),
        ),
    );
    if (serverOutputChannel) context.subscriptions.push(serverOutputChannel);

    // Live-refresh IR preview and graph preview when a .wf file is saved.
    context.subscriptions.push(
        workspace.onDidSaveTextDocument(async (savedDoc) => {
            if (savedDoc.languageId !== "workflow") return;
            const wfUri = savedDoc.uri.toString();
            const previewDoc = irPreviewDocs.get(wfUri);
            if (previewDoc) await refreshIRPreview(wfUri, previewDoc);
            const panel = graphPreviewPanels.get(wfUri);
            if (panel) await refreshGraphPreview(wfUri, panel, savedDoc);
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
    // Track readiness so command handlers can wait for the server
    // before issuing custom requests. `LanguageClient.start()` in
    // vscode-languageclient v9 returns a Promise that resolves once
    // the server has responded to `initialize`.
    clientReady = Promise.resolve(client.start()).catch((err) => {
        serverOutputChannel?.error(
            `workflow-lsp failed to start: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
    });
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
        await clientReady;
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
    void renderGraphForActiveEditor();
}

async function renderGraphForActiveEditor(): Promise<void> {
    const editor = window.activeTextEditor;
    if (!editor || editor.document.languageId !== "workflow") {
        window.showInformationMessage("Open a .wf file to preview its graph.");
        return;
    }
    if (!client) return;
    const wfUri = editor.document.uri.toString();
    const fileLabel = editor.document.uri.fsPath
        ? path.basename(editor.document.uri.fsPath)
        : editor.document.uri.toString();
    const title = `Graph: ${fileLabel}`;
    try {
        await clientReady;
        const result = await client.sendRequest<PreviewGraphResult>(
            "workflow/previewGraph",
            { uri: wfUri },
        );
        let panel = graphPreviewPanels.get(wfUri);
        if (!panel) {
            panel = createGraphPanel(title);
            graphPreviewPanels.set(wfUri, panel);
            panel.onDidDispose(() => graphPreviewPanels.delete(wfUri));
        } else {
            panel.reveal(undefined, true);
        }
        renderGraph(panel.webview, result, fileLabel);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        window.showErrorMessage(`Workflow graph preview failed: ${message}`);
    }
}

async function refreshGraphPreview(
    wfUri: string,
    panel: WebviewPanel,
    doc: VsTextDocument,
): Promise<void> {
    if (!client) return;
    try {
        await clientReady;
        const result = await client.sendRequest<PreviewGraphResult>(
            "workflow/previewGraph",
            { uri: wfUri },
        );
        const fileLabel = doc.uri.fsPath
            ? path.basename(doc.uri.fsPath)
            : doc.uri.toString();
        renderGraph(panel.webview, result, fileLabel);
    } catch {
        // Silent — user can re-run the command if needed.
    }
}

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
