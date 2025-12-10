// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ConfigAction =
    | ListAgents
    | ToggleAgent
    | ToggleExplanationAction
    | ToggleDeveloperModeAction
    | EnterAgentPriorityModeAction
    | ExitAgentPriorityModeAction;

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

// Puts a specific agent into priority mode
export type EnterAgentPriorityModeAction = {
    actionName: "enterAgentPriorityMode";
    parameters: {
        // the agent name or wildcard match string (* to match all agents)
        agentName: string;
    };
};

// Leaves agent priority mode
export type ExitAgentPriorityModeAction = {
    actionName: "exitAgentPriorityMode";
    parameters: {};
};
