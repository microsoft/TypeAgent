// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import * as fs from "fs";
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
    computeCoverage,
} from "grammar-tools-core";
import { DebugPanelManager } from "./debugPanel.js";
import {
    applyCoverageDecorations,
    clearCoverageDecorations,
    disposeCoverageDecorations,
} from "./coverageDecorations.js";

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

    // Coverage decorations (C.7)
    context.subscriptions.push(
        commands.registerCommand("agr.showCoverage", async () => {
            const editor = window.activeTextEditor;
            if (!editor || editor.document.languageId !== "agr") {
                window.showErrorMessage("Open an .agr file first.");
                return;
            }

            const corpusUri = await window.showOpenDialog({
                canSelectMany: false,
                filters: { "Text files": ["txt"], "All files": ["*"] },
                openLabel: "Select corpus file",
                title: "Select a file with one input per line",
            });

            let inputs: string[];
            if (corpusUri && corpusUri.length > 0) {
                const content = await fs.promises.readFile(
                    corpusUri[0].fsPath,
                    "utf-8",
                );
                inputs = content
                    .split("\n")
                    .map((l) => l.trim())
                    .filter((l) => l.length > 0 && !l.startsWith("#"));
            } else {
                // Fallback: prompt for a single input
                const input = await window.showInputBox({
                    prompt: "Enter test input (or cancel to pick a file)",
                    placeHolder: "e.g. play something",
                });
                if (input === undefined) return;
                inputs = [input];
            }

            const text = editor.document.getText();
            const fileId = path.basename(editor.document.fileName);
            const result = loadGrammarFromBuffer(fileId, text);
            if (!result.ok) {
                window.showErrorMessage(
                    "Grammar has errors. Fix diagnostics first.",
                );
                return;
            }

            try {
                const report = computeCoverage(result.grammar, inputs);
                applyCoverageDecorations(editor, report);

                const { totals } = report;
                const rulePct =
                    totals.rules > 0
                        ? Math.round((totals.ruleHits / totals.rules) * 100)
                        : 0;
                const partPct =
                    totals.parts > 0
                        ? Math.round((totals.partHits / totals.parts) * 100)
                        : 0;
                window.showInformationMessage(
                    `Coverage: ${totals.ruleHits}/${totals.rules} rules (${rulePct}%), ` +
                        `${totals.partHits}/${totals.parts} parts (${partPct}%) ` +
                        `from ${inputs.length} input${inputs.length !== 1 ? "s" : ""}`,
                );
            } catch (e: unknown) {
                window.showErrorMessage(
                    e instanceof Error ? e.message : String(e),
                );
            }
        }),
    );

    context.subscriptions.push(
        commands.registerCommand("agr.clearCoverage", () => {
            const editor = window.activeTextEditor;
            if (editor) clearCoverageDecorations(editor);
        }),
    );
}

export function deactivate(): Thenable<void> | undefined {
    disposeCoverageDecorations();
    return client?.stop();
}
