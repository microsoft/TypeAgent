// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WindowsClockAction =
    | NavigateToTimerTabAction
    | RenameTimerAction
    | SetTimerViewModeAction
    | StartTimerAction;

// Switch to the Timer tab from another section.
export type NavigateToTimerTabAction = {
    actionName: "navigateToTimerTab";
    parameters: {};
};

// Rename an existing timer and save the changes.
export type RenameTimerAction = {
    actionName: "renameTimer";
    parameters: {
        // The new name to assign to the timer.
        name: string;
    };
};

// Expand the timer into its alternate/compact view.  [merged from: expandTimerView, restoreTimerView]
export type SetTimerViewModeAction = {
    actionName: "setTimerViewMode";
    parameters: {
        // Distinguishes expandTimerView / restoreTimerView variants.
        mode: "compact" | "full";
    };
};

// Start or resume the timer from list or paused states.
export type StartTimerAction = {
    actionName: "startTimer";
    parameters: {};
};
