// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ScriptFlowProcessesActions =
    | ListProcessesAction
    | ProcessMemoryAction
    | ProcessCpuAction
    | StopProcessAction
    | StartProcessAction
    | WaitProcessAction;

// List running processes
export type ListProcessesAction = {
    actionName: "listProcesses";
    parameters: {
        // Filter by process name
        name?: string;
        // Number of results to show
        topN?: number;
    };
};

// Show processes sorted by memory usage
export type ProcessMemoryAction = {
    actionName: "processMemory";
    parameters: {
        // Number of top processes to show
        topN?: number;
        // Filter by process name
        name?: string;
    };
};

// Show processes sorted by CPU usage
export type ProcessCpuAction = {
    actionName: "processCpu";
    parameters: {
        // Number of top processes to show
        topN?: number;
        // Filter by process name
        name?: string;
    };
};

// Stop a running process
export type StopProcessAction = {
    actionName: "stopProcess";
    parameters: {
        // Process name to stop
        name?: string;
        // Process ID to stop
        id?: number;
    };
};

// Start a new process
export type StartProcessAction = {
    actionName: "startProcess";
    parameters: {
        // Path to the program to start
        path: string;
        // Arguments to pass to the program
        arguments?: string;
    };
};

// Wait for a process to exit
export type WaitProcessAction = {
    actionName: "waitProcess";
    parameters: {
        // Process name to wait for
        name?: string;
        // Process ID to wait for
        id?: number;
    };
};
