// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CrosswordActions = EnterTextAction | GetClueAction;

export type EnterTextAction = {
    actionName: "enterText";
    parameters: {
        value: string;
        clueNumber: number;
        clueDirection: "across" | "down";
    };
};

export type GetClueAction = {
    actionName: "getClueValue";
    parameters: {
        clueNumber: number;
        clueDirection: "across" | "down";
    };
};
