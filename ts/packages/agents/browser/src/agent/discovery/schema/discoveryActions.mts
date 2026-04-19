// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DetectPageActions = {
    actionName: "detectPageActions";
    parameters: {
        registerAgent?: boolean;
        agentName?: string;
    };
};

export type SummarizePage = {
    actionName: "summarizePage";
};

export type RegisterPageDynamicAgent = {
    actionName: "registerPageDynamicAgent";
    parameters: {
        agentName?: string;
    };
};

export type HtmlFragments = {
    frameId: string;
    content: string;
    text?: string;
    cssSelector?: string;
};

export type CreateWebFlowFromRecording = {
    actionName: "createWebFlowFromRecording";
    parameters: {
        actionName: string;
        actionDescription: string;
        recordedSteps: string;
        existingActionNames?: string[];
        startUrl: string;
        screenshots?: string[];
        fragments?: HtmlFragments[];
    };
};

export type GetWebFlowsForDomain = {
    actionName: "getWebFlowsForDomain";
    parameters: {
        domain: string;
    };
};

export type DeleteWebFlow = {
    actionName: "deleteWebFlow";
    parameters: {
        name: string;
    };
};

export type GetAllWebFlows = {
    actionName: "getAllWebFlows";
    parameters: {};
};

export type InferredActionParameter = {
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
};

export type InferredAction = {
    name: string;
    description: string;
    parameters: InferredActionParameter[];
    expectedOutcome: string;
};

export type InferActionsResult = {
    existingActions: {
        name: string;
        description: string;
        flowId?: string;
    }[];
    newActions: InferredAction[];
    pageUrl: string;
};

export type InferActions = {
    actionName: "inferActions";
    parameters: {};
};

export type CreateInferredFlows = {
    actionName: "createInferredFlows";
    parameters: {
        selectedIndices: number[];
        inferredActions: InferredAction[];
    };
};

export type SchemaDiscoveryActions =
    | DetectPageActions
    | RegisterPageDynamicAgent
    | SummarizePage
    | CreateWebFlowFromRecording
    | GetWebFlowsForDomain
    | GetAllWebFlows
    | DeleteWebFlow
    | InferActions
    | CreateInferredFlows;
