import * as vscode from "vscode";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
    });
}

export type { StudioRuntime } from "./studioRuntimeCore.js";
