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

export type StartAuthoringSession = {
    actionName: "startAuthoringSession";
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

export type SchemaDiscoveryActions =
    | DetectPageActions
    | RegisterPageDynamicAgent
    | SummarizePage
    | StartAuthoringSession
    | CreateWebFlowFromRecording
    | GetWebFlowsForDomain
    | GetAllWebFlows
    | DeleteWebFlow;
