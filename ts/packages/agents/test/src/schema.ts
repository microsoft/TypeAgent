// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TestActions = AddAction | RandomNumberAction | FallbackErrorAction;
type AddAction = {
    actionName: "add";
    parameters: {
        a: number;
        b: number;
    };
};

type RandomNumberAction = {
    actionName: "random";
};

type FallbackErrorAction = {
    actionName: "fallbackError";
};
