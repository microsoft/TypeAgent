// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeDebugActions =
    | ShowDebugAction
    | StartOrContinueDebugAction
    | StepAction
    | StopDebugAction
    | ShowHoverAction
    | ToggleBreakpointAction
    | SetBreakpointAction
    | RemoveBreakpointAction
    | RemoveAllBreakpointsAction;

// Show debug panel or window in the editor or code window, if not already visible
export type ShowDebugAction = {
    actionName: "showDebugPanel";
};

// Start/Continue debugging
export type StartOrContinueDebugAction = {
    actionName: "startDebugging";
    parameters?: {
        // Name of the launch configuration to start
        configurationName?: string;
        // Optional: run without debugging
        noDebug?: boolean;
    };
};

// Step into/out/over
export type StepAction = {
    actionName: "step";
    parameters: {
        stepType: "into" | "out" | "over";
    };
};

// Stop debugging
export type StopDebugAction = {
    actionName: "stopDebugging";
};

// Show hover
export type ShowHoverAction = {
    actionName: "showHover";
};

export type SetBreakpointAction = {
    actionName: "setBreakpoint";
    parameters: {
        // Line number where to set the breakpoint
        line: number;
        // Optional: target file
        fileName?: string;
        // Optional: folder relative to workspace
        folderName?: string;
    };
};

export type ToggleBreakpointAction = {
    actionName: "toggleBreakpoint";
    parameters: {
        // Line number where to toggle the breakpoint
        line: number;
        // Optional: target file
        fileName?: string;
        // Optional: folder relative to workspace
        folderName?: string;
    };
};

export type RemoveBreakpointAction = {
    actionName: "removeBreakpoint";
    parameters: {
        // Line number where to remove the breakpoint
        line: number;
        // Optional: target file
        fileName?: string;
        // Optional: folder relative to workspace
        folderName?: string;
    };
};

export type RemoveAllBreakpointsAction = {
    actionName: "removeAllBreakpoints";
    parameters?: {};
};
