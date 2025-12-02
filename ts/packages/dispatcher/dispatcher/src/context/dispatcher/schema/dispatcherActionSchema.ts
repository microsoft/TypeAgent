// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DispatcherActions = UnknownAction;

// Use UnknownAction when all the available actions in the schema is not relevant to the user request
export interface UnknownAction {
    actionName: "unknown";
    parameters: {
        // user request that couldn't be matched to any action or schema group to look up from.
        request: string;
    };
}
