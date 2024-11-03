// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Line of code for which this is a comment
export type LineDoc = {
    lineNumber: number;
    comment: string; // Can be multiline
};

export type CodeDocumentation = {
    comments?: LineDoc[];
};
