// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeWorkbenchActions =
    | WorkbenchActionFilesOpenFile
    | WorkbenchActionFilesCreateFolderFromExplorer;

export type WorkbenchActionFilesOpenFile = {
    actionName: "WorkbenchOpenFile";
    parameters: {
        // The name of the file to open (e.g., "main.ts")
        fileName: string;
        // Optional: control how strict the match is (default: "exact")
        matchStrategy?: "exact" | "fuzzy";
        // Optional: restrict to certain extensions (e.g., [".ts", ".js"])
        extensions?: string[];
        // Optional: whether to include files in dist/build/etc (default: false)
        includeGenerated?: boolean;
    };
};

export type WorkbenchActionFilesCreateFolderFromExplorer = {
    actionName: "WorkbenchCreateFolderFromExplorer";
    parameters: {
        folderName: string; // Required: "tests"
        relativeTo?: string; // Optional: "src/utils"
        resolutionHint?: "inferFromName" | "workspaceRoot" | "activeSelection";
    };
};
