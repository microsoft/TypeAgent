// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SystemOperationsAction =
    | ExecuteTypedActionAction
    | ClearConsoleAction
    | DeepClearConsoleAction
    | StartDebuggerAction
    | ShowQuestionCardsAction
    | DisplayContentAction
    | ExitTypeAgentAction
    | ShowCommandHelpAction
    | OpenFolderAction
    | ListRegisteredPortsAction
    | RunCommandScriptAction
    | RestartAgentServerAction
    | ShutdownAgentServerAction
    | ConfigureTraceAction;

// Execute a specific typed action, optionally associating a natural-language phrase with it.
export type ExecuteTypedActionAction = {
    actionName: "executeTypedAction";
    parameters: {
        schemaName: string;
        actionName: string;
        // JSON object text containing parameters for the target action.
        actionParametersJson?: string;
        naturalLanguage?: string;
    };
};

// Clear displayed console content.
export type ClearConsoleAction = { actionName: "clearConsole" };

// Clear displayed content, chat history, reasoning state, activity, and the persistent display log.
export type DeepClearConsoleAction = { actionName: "deepClearConsole" };

// Start the Node.js inspector and wait for a debugger to attach.
export type StartDebuggerAction = { actionName: "startDebugger" };

// Show the interactive question-card demonstration.
export type ShowQuestionCardsAction = {
    actionName: "showQuestionCards";
    parameters?: { paged?: boolean };
};

// Send one or more content values to the TypeAgent display.
export type DisplayContentAction = {
    actionName: "displayContent";
    parameters: {
        content: string[];
        type?: "text" | "html" | "markdown" | "iframe";
        speak?: boolean;
        inline?: boolean;
    };
};

// Exit the current TypeAgent client.
export type ExitTypeAgentAction = { actionName: "exitTypeAgent" };

// Show command help for one command or all commands.
export type ShowCommandHelpAction = {
    actionName: "showCommandHelp";
    parameters?: {
        command?: string;
        all?: boolean;
    };
};

// Open a system, TypeAgent, session, or agent folder.
export type OpenFolderAction = {
    actionName: "openFolder";
    parameters: { folder: string };
};

// List ports registered by agents and their connected-client counts.
export type ListRegisteredPortsAction = {
    actionName: "listRegisteredPorts";
};

// Run TypeAgent commands from a script file.
export type RunCommandScriptAction = {
    actionName: "runCommandScript";
    parameters: { input: string };
};

// Restart the standalone TypeAgent agent server.
export type RestartAgentServerAction = {
    actionName: "restartAgentServer";
};

// Shut down the TypeAgent agent server and exit.
export type ShutdownAgentServerAction = {
    actionName: "shutdownAgentServer";
};

// Add trace namespaces or clear all trace namespaces.
export type ConfigureTraceAction = {
    actionName: "configureTrace";
    parameters?: {
        namespaces?: string[];
        clear?: boolean;
    };
};
