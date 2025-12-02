// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ActivityActions = ExitActivityAction;

// Exit the current activity.
export interface ExitActivityAction {
    actionName: "exitActivity";
}
