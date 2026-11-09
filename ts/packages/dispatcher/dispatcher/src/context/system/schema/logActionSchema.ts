// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type LogAction =
    | ShowLogStatusAction
    | SetLogProfileAction
    | ClearLogSettingsAction
    | OpenLogTraceAction;

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

// Open a captured request's OpenTelemetry trace in the local Grafana Explore
// view. `traceId` is either a 32-character hex trace id or the literal "last",
// which resolves to the trace id of the previously completed request.
// Examples: "open trace <id> in local Grafana", "open last trace",
// "view the last action result in Grafana".
export type OpenLogTraceAction = {
    actionName: "openLogTrace";
    parameters: {
        traceId: string;
    };
};
