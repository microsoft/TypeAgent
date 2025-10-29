// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SettingsAction =
    | DimBrightNessAction
    | AdjustMultiMonitorLayoutAction;

// An action to dim or brighten the screen
export interface DimBrightNessAction {
    // an internal unique identifier for the action
    id: "settings/dimBrightness";
    // the name of the action
    actionName: "dimBrightNessAction";
    parameters: {
        // the original request of the user
        originalRequest: string;
    };
}

// An action to adjust multi-monitor layout
export interface AdjustMultiMonitorLayoutAction {
    // an internal unique identifier for the action
    id: "settings/adjustMultiMonitorLayout";
    // the name of the action
    actionName: "adjustMultiMonitorLayoutAction";
    parameters: {
        // the original request of the user
        originalRequest: string;
    };
}
