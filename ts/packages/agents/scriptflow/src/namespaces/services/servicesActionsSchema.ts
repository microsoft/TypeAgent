// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ScriptFlowServicesActions =
    | ListServicesAction
    | ServiceStatusAction
    | StartServiceAction
    | StopServiceAction
    | RestartServiceAction;

// List Windows services
export type ListServicesAction = {
    actionName: "listServices";
    parameters: {
        // Filter by service name
        name?: string;
        // Filter by status
        status?: "running" | "stopped";
    };
};

// Check status of a specific service
export type ServiceStatusAction = {
    actionName: "serviceStatus";
    parameters: {
        // Service name to check
        name: string;
    };
};

// Start a Windows service
export type StartServiceAction = {
    actionName: "startService";
    parameters: {
        // Service name to start
        name: string;
    };
};

// Stop a Windows service
export type StopServiceAction = {
    actionName: "stopService";
    parameters: {
        // Service name to stop
        name: string;
    };
};

// Restart a Windows service
export type RestartServiceAction = {
    actionName: "restartService";
    parameters: {
        // Service name to restart
        name: string;
    };
};
