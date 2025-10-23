// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SettingsAction = DimBrightNessAction;

// An actio to dim or brighten the screen
export interface DimBrightNessAction {
    actionName: "dimBrightNessAction";
    parameters: {
        // the original request of the user
        originalRequest: string;
    };
}
