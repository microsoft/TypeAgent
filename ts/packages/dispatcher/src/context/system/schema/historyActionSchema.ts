// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type HistoryAction =
    | ListHistoryAction
    | ClearHistoryAction
    | DeleteHistoryAction;

// Shows the chat history
export type ListHistoryAction = {
    actionName: "list";
};

// Clears the chat history
export type ClearHistoryAction = {
    actionName: "clear";
};

// Deletes a specific message from the chat history
export type DeleteHistoryAction = {
    actionName: "delete";
    parameters: {
        messageNumber: number;
    };
};
