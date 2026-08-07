// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SessionAction =
    | NewSessionAction
    | OpenSessionAction
    | ResetSessionAction
    | ClearSessionAction
    | ListSessionsAction
    | DeleteSessionAction
    | ShowSessionInfoAction;

// Create a new TypeAgent session.
export type NewSessionAction = {
    actionName: "newSession";
    parameters?: {
        // Copy settings from the current session; defaults to false.
        keepSettings?: boolean;
        // Whether to persist the new session; defaults to the current session policy.
        persist?: boolean;
    };
};

// Open a persisted TypeAgent session by name.
export type OpenSessionAction = {
    actionName: "openSession";
    parameters: { session: string };
};

// Reset current session settings to defaults while keeping data.
export type ResetSessionAction = { actionName: "resetSession" };

// Clear current persisted session data after confirmation.
export type ClearSessionAction = { actionName: "clearSession" };

// List persisted TypeAgent sessions.
export type ListSessionsAction = { actionName: "listSessions" };

// Delete one or all persisted sessions after confirmation.
export type DeleteSessionAction = {
    actionName: "deleteSession";
    parameters?: {
        // Session name; omit to delete the current persisted session.
        session?: string;
        // Delete all persisted sessions.
        all?: boolean;
    };
};

// Show current TypeAgent session settings and construction files.
export type ShowSessionInfoAction = { actionName: "showSessionInfo" };
