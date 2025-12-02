// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type HistoryAction =
    | ListHistoryAction
    | ClearHistoryAction
    | DeleteHistoryAction;

// Shows the chat history
export type ListHistoryAction = {
    actionName: "listHistory";
};

// Clears the chat history
export type ClearHistoryAction = {
    actionName: "clearHistory";
};

// Deletes a specific message from the chat history
export type DeleteHistoryAction = {
    actionName: "deleteHistory";
    parameters: {
        messageNumber: number;
    };
};
