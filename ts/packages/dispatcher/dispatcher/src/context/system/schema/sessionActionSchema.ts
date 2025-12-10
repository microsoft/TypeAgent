// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SessionAction =
    | NewSessionAction
    | ListSessionAction
    | ShowSessionInfoAction;

// Create a new session.
export type NewSessionAction = {
    actionName: "newSession";
    parameters: {
        name?: string;
    };
};

// List all sessions.
export type ListSessionAction = {
    actionName: "listSession";
};

// Show information about a session.
export type ShowSessionInfoAction = {
    actionName: "showSessionInfo";
};
