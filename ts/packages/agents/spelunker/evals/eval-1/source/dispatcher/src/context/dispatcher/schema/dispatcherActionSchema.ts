// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DispatcherActions = UnknownAction;

// user request isn't any of the action available and no schema group that may have potential actions to look up from.
export interface UnknownAction {
    actionName: "unknown";
    parameters: {
        // user request that couldn't be matched to any action or schema group to look up from.
        request: string;
    };
}
