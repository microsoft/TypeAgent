// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { VERSION } from "@typeagent/core";

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand("typeagent-studio.hello", () => {
            vscode.window.showInformationMessage(
                `TypeAgent Studio skeleton (typeagent-core ${VERSION}).`,
            );
        }),
    );
}

export function deactivate(): void {}
