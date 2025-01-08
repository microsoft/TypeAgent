// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SpelunkerAction =
    | SetFocusToFoldersAction
    // | AddFoldersToFocusAction
    | GetFocusAction
    | AnswerQuestionAction;

// Set the spelunker's focus to a set of folders; or clear focus
export type SetFocusToFoldersAction = {
    actionName: "setFocusToFolders";
    parameters: {
        folders: string[]; // Focus exclusively on these folders (may be empty to clear focus)
    };
};

// // Add more folders to the spelunker's focus
// export type AddFoldersToFocusAction = {
//     actionName: "addFoldersToFocus";
//     parameters: {
//         folders: string[]; // Add these folders to the focus set
//     };
// };

// // Add files to the spelunker's focus
// export type AddFilesToFocusAction = {
//     actionName: "addFilesToFocus";
//     parameters: {
//         files: string[]; // Add these files to the focus set
//     };
// };

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
