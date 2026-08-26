// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type HistoryAction =
    | ListHistoryAction
    | ClearHistoryAction
    | DeleteHistoryAction
    | SaveHistoryAction
    | InsertHistoryAction
    | ListHistoryEntitiesAction
    | DeleteHistoryEntityAction;

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

// Save the current TypeAgent chat history to a JSON file.
export type SaveHistoryAction = {
    actionName: "saveHistory";
    parameters: {
        // Destination file path.
        file: string;
    };
};

// Insert structured user/assistant entries into TypeAgent chat history.
export type InsertHistoryAction = {
    actionName: "insertHistory";
    parameters: {
        // JSON object or array text in the same format produced by the history save command.
        messagesJson: string;
    };
};

// List entities retained in TypeAgent working memory.
export type ListHistoryEntitiesAction = {
    actionName: "listHistoryEntities";
};

// Delete one entity from TypeAgent working memory by unique ID.
export type DeleteHistoryEntityAction = {
    actionName: "deleteHistoryEntity";
    parameters: {
        // Unique ID of the entity to delete.
        entityId: string;
    };
};
