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
import { ExtensionContext, workspace } from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

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

    client.start();
}

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
