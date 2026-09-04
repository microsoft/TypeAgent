// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeWorkbenchActions =
    | WorkbenchActionFilesOpenFile
    | WorkbenchActionFilesOpenFolder
    | WorkbenchActionFilesCreateFolderFromExplorer
    | WorkbenchActionBuildRelatedFolderTask
    | WorkbenchActionOpenInIntegratedTerminal
    | WorkbenchActionRunWorkspaceCommand
    | WorkbenchActionCancelWorkspaceCommand;

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

export type WorkbenchActionFilesOpenFolder = {
    actionName: "workbenchOpenFolder";
    parameters: {
        // Name of the folder to reveal in Explorer
        folderName: string;
        // Optional: restrict to folders under this path or name
        folderRelativeTo?: string;
        // Optional: whether to include folders in node_modules, dist, etc. default: false
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

// ACTION: Directly run an explicitly requested focused test, build, lint, or diagnostic command in an open workspace and return structured output. Use this instead of opening an integrated terminal when TypeAgent needs the command result.
export type WorkbenchActionRunWorkspaceCommand = {
    actionName: "runWorkspaceCommand";
    parameters: {
        // Exact shell command to run in an open workspace.
        command: string;
        // Workspace-root name or absolute path. Required for ambiguous multi-root workspaces.
        workspaceFolder?: string;
        // Optional path relative to the selected workspace root.
        workingDirectory?: string;
        // Declared command safety classification. Coda also classifies the exact command and blocks high-risk commands.
        commandRiskLevel?: "low" | "medium" | "high";
        // Bounded execution time in milliseconds.
        timeoutMs?: number;
        // Optional caller-provided identifier; Code Agent assigns one when omitted.
        executionId?: string;
    };
};

// ACTION: Cancel an active structured workspace command by execution ID.
export type WorkbenchActionCancelWorkspaceCommand = {
    actionName: "cancelWorkspaceCommand";
    parameters: {
        executionId: string;
    };
};
