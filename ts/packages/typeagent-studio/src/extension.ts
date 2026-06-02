// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { VERSION } from "@typeagent/core";
import { registerStudioCommands } from "./commands.js";
import { createStudioRuntime } from "./studioRuntime.js";

export function activate(context: vscode.ExtensionContext): void {
    const runtime = createStudioRuntime(context);

    registerStudioCommands(context, runtime);

    context.subscriptions.push(
        vscode.commands.registerCommand("typeagent-studio.hello", () => {
            vscode.window.showInformationMessage(
                `TypeAgent Studio skeleton (typeagent-core ${VERSION}).`,
            );
        }),
    );
}

export function deactivate(): void {}
