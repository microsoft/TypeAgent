// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SessionAction =
    | NewAction
    | ListAction
    | ShowInfoAction
    | ToggleHistoryAction;

// Create a new session.
export type NewAction = {
    actionName: "new";
    parameters: {
        name?: string;
    };
};

// List all sessions.
export type ListAction = {
    actionName: "list";
};

// Show information about a session.
export type ShowInfoAction = {
    actionName: "showInfo";
};

// Toggle history flag for the session.
export type ToggleHistoryAction = {
    actionName: "toggleHistory";
    parameters: {
        enable: boolean;
    };
};
