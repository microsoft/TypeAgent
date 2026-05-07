// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import { ExtensionContext, workspace } from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node.js";

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
}

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
