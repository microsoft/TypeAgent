// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import { commands, ExtensionContext, window, workspace } from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node.js";
import {
    loadGrammarFromBuffer,
    traceMatch,
    formatTrace,
} from "grammar-tools-core";
import { DebugPanelManager } from "./debugPanel.js";

let client: LanguageClient | undefined;

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
        documentSelector: [{ scheme: "file", language: "agr" }],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher("**/*.agr"),
        },
    };

    client = new LanguageClient(
        "agrLanguageServer",
        "Action Grammar Language Server",
        serverOptions,
        clientOptions,
    );

    client.start();

    const traceChannel = window.createOutputChannel(
        "Action Grammar Trace",
        "agr",
    );

    context.subscriptions.push(
        commands.registerCommand("agr.traceMatch", async () => {
            const editor = window.activeTextEditor;
            if (!editor || editor.document.languageId !== "agr") {
                window.showErrorMessage("Open an .agr file first.");
                return;
            }

            const input = await window.showInputBox({
                prompt: "Enter text to match against the grammar",
                placeHolder: "e.g. play something",
            });
            if (input === undefined) return;

            const text = editor.document.getText();
            const fileId = path.basename(editor.document.fileName);
            const result = loadGrammarFromBuffer(fileId, text);
            if (!result.ok) {
                window.showErrorMessage(
                    "Grammar has errors. Fix diagnostics first.",
                );
                return;
            }

            const trace = traceMatch(result.grammar, input);
            const output = formatTrace(trace, {
                debugInfo: result.grammar.debugInfo,
            });

            traceChannel.clear();
            traceChannel.appendLine(output);
            traceChannel.show(true);
        }),
    );

    // Debug panel (C.6)
    const debugPanelManager = new DebugPanelManager(context);
    context.subscriptions.push(debugPanelManager);
    context.subscriptions.push(
        commands.registerCommand("agr.openDebugPanel", () => {
            debugPanelManager.show();
        }),
    );
}

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
