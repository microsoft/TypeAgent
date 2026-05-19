// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL VS Code extension.
 *
 * Phase 0 scope: register the `workflow` language (already declared in
 * package.json contributions) and start the LSP server. Custom
 * commands (IR preview, graph preview) and richer client behaviour are
 * added in later phases.
 */

import * as path from "node:path";
import { commands, ExtensionContext, window, workspace, Uri } from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

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
    const serverModule = context.asAbsolutePath(
        path.join("dist", "server.js"),
    );

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

    client.start();
}

async function previewIR(): Promise<void> {
    const editor = window.activeTextEditor;
    if (!editor || editor.document.languageId !== "workflow") {
        window.showInformationMessage(
            "Open a .wf file to preview its IR.",
        );
        return;
    }
    if (!client) return;
    try {
        const result = await client.sendRequest<CompileIRResult>(
            "workflow/compileIR",
            { uri: editor.document.uri.toString() },
        );
        const content = result.errors.length
            ? JSON.stringify({ errors: result.errors }, null, 2)
            : JSON.stringify(result.ir, null, 2);
        const doc = await workspace.openTextDocument({
            content,
            language: "json",
        });
        await window.showTextDocument(doc, { preview: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        window.showErrorMessage(`Workflow IR preview failed: ${message}`);
    }
}

function previewGraph(): void {
    // Graph preview (extractGraph + elkjs) is planned but not yet
    // implemented. Surface a friendly message so the command isn't a
    // silent no-op.
    window.showInformationMessage(
        "Workflow graph preview is coming in a follow-up release.",
    );
    // Reference Uri to keep the import live for future use.
    void Uri.parse;
}

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
