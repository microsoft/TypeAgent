// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ScaffolderActions =
    | ScaffoldAgentAction
    | ScaffoldPluginAction
    | ListTemplatesAction;

export type ScaffoldAgentAction = {
    actionName: "scaffoldAgent";
    parameters: {
        // Integration name to scaffold agent for
        integrationName: string;
        // Target directory for the agent package (defaults to ts/packages/agents/<name>)
        outputDir?: string;
    };
};

export type ScaffoldPluginAction = {
    actionName: "scaffoldPlugin";
    parameters: {
        // Integration name to scaffold the host-side plugin for
        integrationName: string;
        // Template to use for the plugin side
        template: "office-addin" | "vscode-extension" | "electron-app" | "browser-extension" | "rest-client";
        // Target directory for the plugin (defaults to ts/packages/agents/<name>/plugin)
        outputDir?: string;
    };
};

export type ListTemplatesAction = {
    actionName: "listTemplates";
    parameters: {};
};
