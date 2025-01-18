// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ConfigAction =
    | ListAgents
    | ToggleAgent
    | ToggleExplanationAction
    | ToggleDeveloperModeAction;

// Shows the list of available agents
export type ListAgents = {
    actionName: "listAgents";
};

// Toggle use of LLM, agent or AI.
export type ToggleAgent = {
    actionName: "toggleAgent";
    parameters: {
        enable: boolean;
        agentNames: string[];
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
