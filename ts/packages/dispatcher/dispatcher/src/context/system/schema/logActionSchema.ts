// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type LogAction =
    | ShowLogStatusAction
    | SetLogProfileAction
    | ClearLogSettingsAction;

// Show the current local OpenTelemetry logging configuration.
// Examples: "show local log status", "check local telemetry settings".
export type ShowLogStatusAction = {
    actionName: "showLogStatus";
};

// Set the local JSONL capture profile without changing debug namespaces.
// Examples: "set local logging to diagnostic", "turn off local telemetry".
export type SetLogProfileAction = {
    actionName: "setLogProfile";
    parameters: {
        profile: "focused" | "diagnostic" | "verbose" | "off";
    };
};

// Restore local logging to the focused profile.
// Examples: "reset local logging", "clear local telemetry settings".
export type ClearLogSettingsAction = {
    actionName: "clearLogSettings";
};
