// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DispatcherActions = UnknownAction;

// the user request isn't any of the action available
export interface UnknownAction {
    actionName: "unknown";
    parameters: {
        // user request that couldn't be matched to any action
        request: string;
    };
}
