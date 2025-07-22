// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type FindPageComponents = {
    actionName: "findPageComponents";
};

export type DetectPageActions = {
    actionName: "detectPageActions";
    parameters: {
        registerAgent?: boolean;
        agentName?: string;
    };
};

export type GetPageType = {
    actionName: "getPageType";
};

export type GetSiteType = {
    actionName: "getSiteType";
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

export type GetIntentFromRecording = {
    actionName: "getIntentFromRecording";
    parameters: {
        recordedActionName: string;
        recordedActionDescription: string;
        recordedActionSteps?: string;
        existingActionNames: string[];
        fragments?: HtmlFragments[];
        screenshots?: string[];
    };
};

export type GetActionsForUrl = {
    actionName: "getActionsForUrl";
    parameters: {
        url: string;
        includeGlobal?: boolean;
        author?: "discovered" | "user";
    };
};

export type DeleteAction = {
    actionName: "deleteAction";
    parameters: {
        actionId: string;
    };
};

export type SchemaDiscoveryActions =
    | FindPageComponents
    | DetectPageActions
    | GetSiteType
    | GetPageType
    | RegisterPageDynamicAgent
    | SummarizePage
    | StartAuthoringSession
    | GetIntentFromRecording
    | GetActionsForUrl
    | DeleteAction;
