// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TestActions = AddAction;
type AddAction = {
    actionName: "add";
    parameters: {
        a: number;
        b: number;
    };
};
