// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ConfigAction =
    | ToggleBotAction
    | ToggleExplanationAction
    | ToggleDeveloperModeAction;

// Toggle use of LLM, bot or AI.
export type ToggleBotAction = {
    actionName: "toggleBot";
    parameters: {
        enable: boolean;
    };
};

// Toggle explanation.
export type ToggleExplanationAction = {
    actionName: "toggleExplanation";
    parameters: {
        enable: boolean;
    };
};

// Toggle developer mode.
export type ToggleDeveloperModeAction = {
    actionName: "toggleDeveloperMode";
    parameters: {
        enable: boolean;
    };
};
