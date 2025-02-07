// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SpelunkerAction =
    | SetFocusAction
    | GetFocusAction
    | SearchCodeAction;

// Set the spelunker's focus to a list of folders; or clear focus
export type SetFocusAction = {
    actionName: "setFocus";
    parameters: {
        // Focus exclusively on these folders (may be empty to clear focus)
        folders: string[];
    };
};

// Report the spelunker's current focus folder(s)
export type GetFocusAction = {
    actionName: "getFocus";
};

// Search the spelunker's focus folder(s) for an answer to a question
export type SearchCodeAction = {
    actionName: "searchCode";
    parameters: {
        // Question to answer
        question: string;
    };
};
