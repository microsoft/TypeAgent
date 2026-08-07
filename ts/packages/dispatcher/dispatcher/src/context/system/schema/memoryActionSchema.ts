// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MemoryAction =
    | SetLegacyMemoryAction
    | QueryMemoryAction
    | SearchMemoryAction
    | AnswerFromMemoryAction;

// Enable or disable legacy conversation memory.
export type SetLegacyMemoryAction = {
    actionName: "setLegacyMemory";
    parameters: { enabled: boolean };
};

// Search conversation memory for explicit terms.
export type QueryMemoryAction = {
    actionName: "queryMemory";
    parameters: {
        terms: string[];
        ascending?: boolean;
        displayMessages?: boolean;
        displayKnowledge?: boolean;
        count?: number;
        distinct?: boolean;
    };
};

// Translate a question into a conversation-memory search and show matches.
export type SearchMemoryAction = {
    actionName: "searchMemory";
    parameters: MemoryQuestionParameters;
};

// Answer a question using conversation memory and show supporting matches.
export type AnswerFromMemoryAction = {
    actionName: "answerFromMemory";
    parameters: MemoryQuestionParameters;
};

export type MemoryQuestionParameters = {
    question: string;
    ascending?: boolean;
    displayMessages?: boolean;
    displayKnowledge?: boolean;
    count?: number;
    distinct?: boolean;
};
