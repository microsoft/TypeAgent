// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// An entity from memory.ts
export interface SpelunkerEntity {
    // the name of the entity such as "Bach" or "frog"
    name: string;
    // the types of the entity such as "artist" or "animal"; an entity can have multiple types; entity types should be single words
    type: string[];
    // source link, '<file name>#<line number>'
    additionalEntityText?: string;
    // unique id for the entity (typically a ChunkId)
    uniqueId: string;
}

export type SpelunkerAction =
    | SetFocusAction
    | GetFocusAction
    | SearchCodeAction;

// Set the spelunker's focus to a list of folders; or clear focus
export type SetFocusAction = {
    actionName: "setFocus";
    parameters: {
        folders: string[]; // Focus exclusively on these folders (may be empty to clear focus)
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
        question: string; // Question to answer
        entities: SpelunkerEntity[]; // Entities to prioritize in the search
    };
};
