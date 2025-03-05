// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type FindPageComponents = {
    actionName: "findPageComponents";
};

export type FindUserActions = {
    actionName: "findUserActions";
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

export type InitializePageSchema = {
    actionName: "initializePageSchema";
    parameters: {
        registerAgent?: boolean;
        agentName?: string;
    };
};

export type SaveUserActions = {
    actionName: "saveUserActions";
    parameters: {
        actionListId?: string;
        agentName?: string;
    };
};

export type AddUserAction = {
    actionName: "addUserAction";
    parameters: {
        actionName?: string;
        actionDescription?: string;
        agentName?: string;
    };
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
        fragments?: HtmlFragments[];
        screenshot?: string;
    };
};

export type SchemaDiscoveryActions =
    | FindPageComponents
    | FindUserActions
    | GetSiteType
    | GetPageType
    | InitializePageSchema
    | SummarizePage
    | SaveUserActions
    | AddUserAction
    | GetIntentFromRecording;
