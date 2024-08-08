// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type EnterTextAction = {
    actionName: "enterText";
    parameters: {
        value: string;
        clueNumber: number;
        clueDirection: "across" | "down";
        frameId: string;
    };
};

export type GetClueAction = {
    actionName: "getClueValue";
    parameters: {
        clueNumber: number;
        clueDirection: "across" | "down";
        frameId: string;
    };
};

export type GetEntryValue = {
    actionName: "getEntryValue";
    parameters: {
        // The proposed value to use for this clue
        value: string;
        clueNumber: number;
        clueDirection: "across" | "down";
        frameId: string;
    };
};

export type UnknownAction = {
    actionName: "unknown";
    parameters: {
        // text typed by the user that the system did not understand
        text: string;
    };
};

export type BoardActions = {
    actions: Action[];
};

export type Action =
    | EnterTextAction
    | GetClueAction
    | GetEntryValue
    | UnknownAction;
