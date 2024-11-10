// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TODO: Rename this file and the exported types to differ from the other codeDocSchema.ts.

// Extracted information for a chunk of code.
export type LineDoc = {
    lineNumber: number;
    name: string; // Function, class or method name (fully qualified)
    // One paragraph summary of the code chunk starting at that line.
    // Concise, informative, don't explain Python or stdlib features.
    comment: string; // Can be multiline
    keywords?: string[];
    topics?: string[];
    goals?: string[];
    dependencies?: string[];
};

export type CodeDocumentation = {
    comments?: LineDoc[];
};
