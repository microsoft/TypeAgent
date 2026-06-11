// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import {
    createStudioRuntimeCore,
    type StudioRuntime,
} from "./studioRuntimeCore.js";

export function createStudioRuntime(
    context: vscode.ExtensionContext,
): StudioRuntime {
    return createStudioRuntimeCore({
        workspaceState: context.workspaceState,
        globalStorageFsPath: context.globalStorageUri.fsPath,
        workspaceFolderFsPaths:
            vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [],
        agentSearchPaths: () =>
            vscode.workspace
                .getConfiguration("typeagentStudio")
                .get<string[]>("agentSearchPaths", []),
    });
}

export type { StudioRuntime } from "./studioRuntimeCore.js";
