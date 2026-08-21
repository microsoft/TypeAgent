// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type BrowserPageToolsActions =
    | ExtractCurrentPageKnowledge
    | AnswerCurrentPageQuestion
    | StartPageActionRecording
    | StopPageActionRecording;

// Extract and index structured knowledge from the current browser page.
export type ExtractCurrentPageKnowledge = {
    actionName: "extractCurrentPageKnowledge";
};

// Answer a question using knowledge from the current browser page.
export type AnswerCurrentPageQuestion = {
    actionName: "answerCurrentPageQuestion";
    parameters: {
        // Question to answer about the current page.
        question: string;
    };
};

// Start recording browser interactions for a named page action.
export type StartPageActionRecording = {
    actionName: "startPageActionRecording";
    parameters: {
        // Name of the browser action being recorded.
        name: string;
    };
};

// Stop the current browser interaction recording.
export type StopPageActionRecording = {
    actionName: "stopPageActionRecording";
    parameters?: {
        // Optional description of what the recorded action does.
        description?: string;
    };
};
