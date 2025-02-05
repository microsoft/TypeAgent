// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MyEntity = {
    // the name of the entity such as "Bach" or "frog" or "createFooHandler"
    name: string;
    // the types of the entity such as "artist" or "animal"; an entity can have multiple types; entity types should be single words
    type: string[];

    // Additional text (e.g. '<file>#<line>')
    additionalEntityText: string;
    // Unique identifier for the entity, typically derived from a timestamp
    uniqueId: string;
};

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
        // Entities relevant to the question, taken from working memory
        entities: MyEntity[];
    };
};
