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

export type GetMacrosForUrl = {
    actionName: "getMacrosForUrl";
    parameters: {
        url: string;
        includeGlobal?: boolean;
        author?: "discovered" | "user";
    };
};

export type DeleteMacro = {
    actionName: "deleteMacro";
    parameters: {
        macroId: string;
    };
};

export type SchemaDiscoveryActions =
    | DetectPageActions
    | RegisterPageDynamicAgent
    | SummarizePage
    | StartAuthoringSession
    | GetIntentFromRecording
    | GetMacrosForUrl
    | DeleteMacro;
