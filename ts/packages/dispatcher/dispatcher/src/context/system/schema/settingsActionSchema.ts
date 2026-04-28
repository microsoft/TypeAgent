// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type UserSettingsAction =
    | SetServerHiddenAction
    | SetIdleTimeoutAction
    | SetConversationResumeAction;

// Set whether the agent server starts as a hidden background process.
// Use when the user says things like "start the server hidden", "run the server in the background",
// "don't show a server window", "show the server window on startup".
export type SetServerHiddenAction = {
    actionName: "setServerHidden";
    parameters: {
        // true = server starts as hidden background process; false = server starts with a visible window
        enable: boolean;
    };
};

// Set the idle timeout for the agent server in seconds (0 = disabled).
// Use when the user says things like "shut down the server after 5 minutes of inactivity",
// "set idle timeout to 300 seconds", "disable idle timeout", "never shut down automatically".
export type SetIdleTimeoutAction = {
    actionName: "setIdleTimeout";
    parameters: {
        // Timeout in seconds. 0 means the server never shuts down automatically due to inactivity.
        seconds: number;
    };
};

// Set whether to resume the last conversation on startup.
// Use when the user says things like "always resume my last conversation",
// "pick up where I left off", "don't resume my last conversation", "start fresh each time".
export type SetConversationResumeAction = {
    actionName: "setConversationResume";
    parameters: {
        // true = resume the last conversation on startup; false = always start with the default conversation
        enable: boolean;
    };
};
