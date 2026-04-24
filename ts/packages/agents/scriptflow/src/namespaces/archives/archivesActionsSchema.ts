// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ScriptFlowArchivesActions = CompressAction | ExpandAction;

// Compress files into a zip archive
export type CompressAction = {
    actionName: "compress";
    parameters: {
        // Source path (file or directory)
        sourcePath: string;
        // Destination zip file path (default: derived from source path)
        destinationPath?: string;
    };
};

// Extract files from a zip archive
export type ExpandAction = {
    actionName: "expand";
    parameters: {
        // Path to the archive file
        archivePath: string;
        // Destination directory (default: current directory)
        destinationPath?: string;
    };
};
