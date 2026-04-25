// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PowerShellSystemActions =
    | SystemInfoAction
    | DiskUsageAction
    | HotFixesAction
    | UptimeAction
    | EnvVarsAction;

// Get system information
export type SystemInfoAction = {
    actionName: "systemInfo";
    parameters: {};
};

// Show disk space usage
export type DiskUsageAction = {
    actionName: "diskUsage";
    parameters: {
        // Filter by drive letter (e.g., "C")
        driveLetter?: string;
    };
};

// List installed hotfixes/updates
export type HotFixesAction = {
    actionName: "hotFixes";
    parameters: {};
};

// Show system uptime
export type UptimeAction = {
    actionName: "uptime";
    parameters: {};
};

// Show environment variables
export type EnvVarsAction = {
    actionName: "envVars";
    parameters: {
        // Filter by variable name
        name?: string;
    };
};
