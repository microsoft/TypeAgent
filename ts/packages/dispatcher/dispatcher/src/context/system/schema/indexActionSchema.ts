// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type IndexAction =
    | ListIndexesAction
    | ShowIndexInfoAction
    | CreateIndexAction
    | DeleteIndexAction;

// List all TypeAgent indexes.
export type ListIndexesAction = {
    actionName: "listIndexes";
};

// Show details for one TypeAgent index.
export type ShowIndexInfoAction = {
    actionName: "showIndexInfo";
    parameters: {
        // Name of the index.
        name: string;
    };
};

// Create a TypeAgent index.
export type CreateIndexAction = {
    actionName: "createIndex";
    parameters: {
        // Index kind; defaults to image for the command, but is explicit in this action.
        type: "image" | "email" | "website";
        // Name of the new index.
        name: string;
        // Source location to index.
        location: string;
    };
};

// Delete a TypeAgent index by name.
export type DeleteIndexAction = {
    actionName: "deleteIndex";
    parameters: {
        // Name of the index to delete.
        name: string;
    };
};
