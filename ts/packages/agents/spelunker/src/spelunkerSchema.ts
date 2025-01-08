// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SpelunkerAction =
    | SetFocusAction
    | GetFocusAction
    | AnswerQuestionAction;

// Set the spelunker's focus to a set of folders; or clear focus
export type SetFocusAction = {
    actionName: "setFocus";
    parameters: {
        folders: string[]; // Focus exclusively on these folders (may be empty to clear focus)
    };
};

// Report the spelunker's folder
export type GetFocusAction = {
    actionName: "getFocus";
};

// Answer a question about the files/folders currently in focus
export type AnswerQuestionAction = {
    actionName: "answerQuestion";
    parameters: {
        question: string; // Question to answer
    };
};
