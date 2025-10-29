// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SettingsAction = DimBrightNessAction;

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
