// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SpelunkerAction = QueryAction;

// Ask the spelunker a question about the code base it is focused on.
export type QueryAction = {
    actionName: "querySpelunker";
    parameters: {
        query: string; // The question for the spelunker
    };
};
