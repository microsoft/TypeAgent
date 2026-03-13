// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ListWebFlows = {
    actionName: "listWebFlows";
    parameters?: {
        scope?: "site" | "global" | "all";
    };
};

export type DeleteWebFlow = {
    actionName: "deleteWebFlow";
    parameters: {
        name: string;
    };
};

export type EditWebFlowScope = {
    actionName: "editWebFlowScope";
    parameters: {
        name: string;
        scopeType: "site" | "global";
        domains?: string[];
    };
};

// Goal-driven mode: describe what you want and a reasoning model completes it
export type StartGoalDrivenTask = {
    actionName: "startGoalDrivenTask";
    parameters: {
        // The goal to achieve (e.g. "search for wireless headphones and add the cheapest to cart")
        goal: string;
        // Optional starting URL; uses current page if not specified
        startUrl?: string;
        // Maximum reasoning steps (default 30)
        maxSteps?: number;
    };
};

// Generate a reusable WebFlow script from a saved trace
export type GenerateWebFlow = {
    actionName: "generateWebFlow";
    parameters: {
        // Trace ID (from a previous goal-driven task) to generate a script from
        traceId: string;
        // Optional name for the generated flow
        name?: string;
        // Optional description override
        description?: string;
    };
};

// Generate a WebFlow from recorded user interactions
export type GenerateWebFlowFromRecording = {
    actionName: "generateWebFlowFromRecording";
    parameters: {
        // Description of what the recording does
        description: string;
        // Optional name for the generated flow
        name?: string;
    };
};

// Bulk-convert existing macros from MacroStore into webFlows
export type ConvertMacrosToWebFlows = {
    actionName: "convertMacrosToWebFlows";
    parameters?: {
        // Only convert macros for a specific domain (default: all)
        domain?: string;
    };
};

export type WebFlowActions =
    | ListWebFlows
    | DeleteWebFlow
    | EditWebFlowScope
    | StartGoalDrivenTask
    | GenerateWebFlow
    | GenerateWebFlowFromRecording
    | ConvertMacrosToWebFlows;
