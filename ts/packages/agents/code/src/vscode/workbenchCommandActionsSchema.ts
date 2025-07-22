// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeWorkbenchActions =
    | WorkbenchActionFilesOpenFile
    | WorkbenchActionFilesCreateFolderFromExplorer
    | WorkbenchActionBuildRelatedFolderTask
    | WorkbenchActionOpenInIntegratedTerminal;

export type WorkbenchActionFilesOpenFile = {
    actionName: "workbenchOpenFile";
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
    actionName: "workbenchCreateFolderFromExplorer";
    parameters: {
        folderName: string; // Required: "tests"
        relativeTo?: string; // Optional: "src/utils"
        resolutionHint?: "inferFromName" | "workspaceRoot" | "activeSelection";
    };
};

export type WorkbenchActionBuildRelatedFolderTask = {
    actionName: "workbenchBuildRelatedTask";
    parameters: {
        task: "build" | "rebuild" | "clean"; // build type
        folderName?: string; // optional folder/project name; if omitted, builds workspace/root
        taskSelection?: string | number; // optional: select task by label or index
    };
};

export type WorkbenchActionOpenInIntegratedTerminal = {
    actionName: "openInIntegratedTerminal";
    parameters: {
        // Optional: folder to open terminal in
        folderName?: string;
        // Optional: command to execute immediately
        commandToExecute?: string;
        // Optional: risk of command
        commandRiskLevel?: "low" | "medium" | "high";
        // Optional: reuse current terminal or open new one, default is true
        reuseExistingTerminal?: boolean;
    };
};
