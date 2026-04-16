// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Agent architectural patterns supported by the scaffolder.
export type AgentPattern =
    | "schema-grammar" // Standard: schema + grammar + dispatch handler (default)
    | "external-api" // REST/OAuth cloud API bridge (MS Graph, Spotify, etc.)
    | "llm-streaming" // LLM-injected agent with streaming responses
    | "sub-agent-orchestrator" // Root agent routing to N typed sub-schemas
    | "websocket-bridge" // Bidirectional WebSocket to a host-side plugin
    | "state-machine" // Multi-phase disk-persisted workflow
    | "native-platform" // OS/device APIs via child_process or SDK
    | "view-ui" // Web view renderer with IPC handler
    | "command-handler"; // CommandHandler (direct dispatch, no typed schema)

export type ScaffolderActions =
    | ScaffoldAgentAction
    | ScaffoldPluginAction
    | ListTemplatesAction
    | ListPatternsAction;

export type ScaffoldAgentAction = {
    actionName: "scaffoldAgent";
    parameters: {
        // Integration name to scaffold agent for
        integrationName: string;
        // Architectural pattern to use (defaults to "schema-grammar")
        pattern?: AgentPattern;
        // Target directory for the agent package (defaults to ts/packages/agents/<name>)
        outputDir?: string;
        // Emoji character for the agent icon (defaults to "🔎")
        emojiChar?: string;
    };
};

export type ScaffoldPluginAction = {
    actionName: "scaffoldPlugin";
    parameters: {
        // Integration name to scaffold the host-side plugin for
        integrationName: string;
        // Template to use for the plugin side
        template:
            | "office-addin"
            | "vscode-extension"
            | "electron-app"
            | "browser-extension"
            | "rest-client";
        // Target directory for the plugin (defaults to ts/packages/agents/<name>/plugin)
        outputDir?: string;
    };
};

export type ListTemplatesAction = {
    actionName: "listTemplates";
    parameters: {};
};

export type ListPatternsAction = {
    actionName: "listPatterns";
    parameters: {};
};
