// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type LogAction =
    | ShowLogStatusAction
    | SetLogProfileAction
    | SetLogDebugCopyAction
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

// Control whether enabled debug messages are copied into local JSONL logs.
// Examples: "include debug output in local logs", "stop copying debug logs locally".
export type SetLogDebugCopyAction = {
    actionName: "setLogDebugCopy";
    parameters: {
        enabled: boolean;
    };
};

// Restore local logging to focused profile with debug copying disabled.
// Examples: "reset local logging", "clear local telemetry settings".
export type ClearLogSettingsAction = {
    actionName: "clearLogSettings";
};
