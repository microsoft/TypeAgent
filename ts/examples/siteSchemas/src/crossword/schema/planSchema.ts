// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ClickAction = {
    actionName: "clickOnElement";
    parameters: {
        row: number;
        column: number;
    };
};

export type EnterLetter = {
    actionName: "enterLetterInCell";
    parameters: {
        row: number;
        column: number;
        letter: string;
    };
};

export type ScrollAction = {
    actionName: "scrollOnElement";
    parameters: {
        row: number;
        column: number;
    };
};

export type UnknownAction = {
    actionName: "unknown";
    parameters: {
        // text typed by the user that the system did not understand
        text: string;
    };
};

export type Step = {
    // a brief explanation of the step being taken
    explanation: string;
    nextAction: ClickAction | EnterLetter | ScrollAction;
};

export type UIActionsPlan = {
    steps: Step[];
};
