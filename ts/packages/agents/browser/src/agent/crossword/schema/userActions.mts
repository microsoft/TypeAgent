// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CrosswordActions = EnterText | GetClueValue;

export type EnterText = {
    actionName: "enterText";
    parameters: {
        value: string;
        clueNumber: number;
        clueDirection: "across" | "down";
    };
};

export type GetClueValue = {
    actionName: "getClueValue";
    parameters: {
        clueNumber: number;
        clueDirection: "across" | "down";
    };
};
