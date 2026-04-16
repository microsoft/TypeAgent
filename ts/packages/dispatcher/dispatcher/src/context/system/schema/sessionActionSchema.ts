// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SessionAction =
    | NewSessionAction
    | ListSessionAction
    | ShowSessionInfoAction
    | SwitchSessionAction
    | DeleteSessionAction;

// Create a new session/conversation.
export type NewSessionAction = {
    actionName: "newSession";
    parameters: {
        // Optional name for the new session
        name?: string;
    };
};

// List all sessions/conversations.
export type ListSessionAction = {
    actionName: "listSession";
};

// Show information about the current session/conversation.
export type ShowSessionInfoAction = {
    actionName: "showSessionInfo";
};

// Switch to an existing session/conversation by name.
// Use this when the user wants to open, switch to, or go to a different conversation.
export type SwitchSessionAction = {
    actionName: "switchSession";
    parameters: {
        // The name of the session/conversation to switch to
        name: string;
    };
};

// Delete a session/conversation by name.
// Use this when the user wants to remove or delete a conversation.
export type DeleteSessionAction = {
    actionName: "deleteSession";
    parameters: {
        // The name of the session/conversation to delete
        name: string;
    };
};
