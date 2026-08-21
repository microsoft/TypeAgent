// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SystemDiagnosticsAction =
    | ListEnvironmentVariablesAction
    | GetEnvironmentVariableAction
    | ShowTokenSummaryAction
    | ShowTokenDetailsAction
    | RunRandomOfflineRequestAction
    | RunRandomOnlineRequestAction;

// List process environment variables with sensitive values redacted.
export type ListEnvironmentVariablesAction = {
    actionName: "listEnvironmentVariables";
};

// Show one process environment variable.
export type GetEnvironmentVariableAction = {
    actionName: "getEnvironmentVariable";
    parameters: {
        // Environment variable name.
        name: string;
    };
};

// Show aggregate in-process LLM token usage.
export type ShowTokenSummaryAction = {
    actionName: "showTokenSummary";
};

// Show detailed per-request in-process LLM token usage.
export type ShowTokenDetailsAction = {
    actionName: "showTokenDetails";
};

// Select and execute a random request from the offline dataset.
export type RunRandomOfflineRequestAction = {
    actionName: "runRandomOfflineRequest";
};

// Generate and execute a random request using an LLM.
export type RunRandomOnlineRequestAction = {
    actionName: "runRandomOnlineRequest";
};
