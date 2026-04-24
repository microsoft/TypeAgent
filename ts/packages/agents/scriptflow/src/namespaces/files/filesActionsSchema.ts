// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ScriptFlowFilesActions =
    | ListFilesAction
    | ReadFileAction
    | WriteFileAction
    | CopyFileAction
    | MoveFileAction
    | DeleteFileAction
    | TestPathAction
    | FindTextAction
    | NewItemAction;

// List files in a directory
export type ListFilesAction = {
    actionName: "listFiles";
    parameters: {
        // Directory path to list (default: current directory)
        path?: string;
        // Filter pattern (e.g., "*.txt")
        filter?: string;
        // Include subdirectories
        recurse?: boolean;
    };
};

// Read contents of a file
export type ReadFileAction = {
    actionName: "readFile";
    parameters: {
        // Path to the file to read
        path: string;
        // Number of lines from the end (tail)
        tail?: number;
        // Number of lines from the start (head)
        head?: number;
    };
};

// Write content to a file
export type WriteFileAction = {
    actionName: "writeFile";
    parameters: {
        // Path to the file to write
        path: string;
        // Content to write
        content: string;
        // Append instead of overwrite
        append?: boolean;
    };
};

// Copy a file or directory
export type CopyFileAction = {
    actionName: "copyFile";
    parameters: {
        // Source path
        source: string;
        // Destination path
        destination: string;
        // Copy recursively for directories
        recurse?: boolean;
    };
};

// Move or rename a file or directory
export type MoveFileAction = {
    actionName: "moveFile";
    parameters: {
        // Source path
        source: string;
        // Destination path
        destination: string;
    };
};

// Delete a file or directory
export type DeleteFileAction = {
    actionName: "deleteFile";
    parameters: {
        // Path to delete
        path: string;
        // Delete recursively for directories
        recurse?: boolean;
    };
};

// Check if a path exists
export type TestPathAction = {
    actionName: "testPath";
    parameters: {
        // Path to check
        path: string;
    };
};

// Search for text in files
export type FindTextAction = {
    actionName: "findText";
    parameters: {
        // Text pattern to search for
        pattern: string;
        // Directory or file to search in (default: current directory)
        path?: string;
        // File filter (e.g., "*.ts")
        include?: string;
    };
};

// Create a new file or directory
export type NewItemAction = {
    actionName: "newItem";
    parameters: {
        // Path for the new item
        path: string;
        // Type of item to create
        itemType: "file" | "directory";
    };
};
