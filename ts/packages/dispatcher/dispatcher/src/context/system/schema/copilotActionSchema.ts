// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CopilotAction =
    | ImportCopilotSessionsAction
    | FixWithCopilotAction
    | LoginToCopilotAction;

// Import GitHub Copilot Chat sessions as conversation mirrors.
export type ImportCopilotSessionsAction = {
    actionName: "importCopilotSessions";
};

// Hand the current conversation to GitHub Copilot Chat for diagnosis and repair.
export type FixWithCopilotAction = {
    actionName: "fixWithCopilot";
    parameters?: {
        instructions?: string;
        mode?: "agent" | "ask";
        includeScreenshot?: boolean;
        devCaptures?: "auto" | "on" | "off";
        target?: string;
        autoSend?: boolean;
        reuseSession?: boolean;
        location?: "editor" | "view" | "window";
    };
};

// Sign in to GitHub Copilot using the browser device flow.
export type LoginToCopilotAction = {
    actionName: "loginToCopilot";
    parameters?: {
        host?: string;
        openBrowser?: boolean;
    };
};
