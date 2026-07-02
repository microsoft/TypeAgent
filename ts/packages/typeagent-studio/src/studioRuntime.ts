// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import {
    createStudioRuntimeCore,
    type StudioRuntime,
} from "@typeagent/core/runtime";

/**
 * The extension's in-process Studio runtime. It is used ONLY by
 * the onboarding command surface (`registerStudioCommands`) — the shared live
 * surfaces (sandboxes, event log, collisions, corpus, health) read from the
 * standalone per-workspace Studio service over the channel instead.
 */
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

export type { StudioRuntime } from "@typeagent/core/runtime";
