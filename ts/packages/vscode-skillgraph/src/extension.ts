// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "node:path";
import * as vscode from "vscode";
import {
    LanguageClient,
    TransportKind,
    type LanguageClientOptions,
    type ServerOptions,
} from "vscode-languageclient/node.js";

// Starts the bundled skillgraph LSP (dist/skillgraph.mjs lsp) per window.
//
//   VS Code ─stdio─▶ node skillgraph.mjs lsp [--no-probe]   (cwd = workspace)
//     cwd/.skillgraphrc.json + .agents|.claude|.github/skills ─▶ roots
//
// Edits to .skillgraphrc.json restart the server so new roots load.

const ID = "skillgraph";
const RC_FILE = ".skillgraphrc.json";
let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
    const start = async () => {
        await client?.stop();
        client = createClient(context);
        await client.start();
    };
    context.subscriptions.push(
        vscode.commands.registerCommand(`${ID}.restart`, start),
        vscode.workspace.onDidChangeConfiguration(
            (e) => e.affectsConfiguration(ID) && start(),
        ),
    );
    const rc = vscode.workspace.createFileSystemWatcher(`**/${RC_FILE}`);
    rc.onDidChange(start);
    rc.onDidCreate(start);
    rc.onDidDelete(start);
    context.subscriptions.push(rc);
    await start();
}

export function deactivate() {
    return client?.stop();
}

function createClient(context: vscode.ExtensionContext): LanguageClient {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const probe = vscode.workspace.getConfiguration(ID).get("probe", true);
    const server = {
        module: context.asAbsolutePath(path.join("dist", "skillgraph.mjs")),
        transport: TransportKind.stdio,
        args: ["lsp", ...(probe ? [] : ["--no-probe"])],
        options: folder ? { cwd: folder } : {},
    };
    const serverOptions: ServerOptions = { run: server, debug: server };
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "markdown" }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher(
                "**/{*.md,scripts/**}",
            ),
        },
    };
    return new LanguageClient(ID, "Skill Graph", serverOptions, clientOptions);
}
