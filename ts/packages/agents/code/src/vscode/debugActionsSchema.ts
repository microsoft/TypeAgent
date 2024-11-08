// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeDebugActions =
    | ShowDebugAction
    | ToggleBreakpointAction
    | StartOrContinueDebugAction
    | StepAction
    | StopDebugAction
    | ShowHoverAction;

// Show debug panel or window in the editor or code window, if not already visible
export type ShowDebugAction = {
    actionName: "showDebugPanel";
};

// Toggle breakpoint
export type ToggleBreakpointAction = {
    actionName: "toggleBreakpoint";
};

// Start/Continue debugging
export type StartOrContinueDebugAction = {
    actionName: "startDebugging";
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
