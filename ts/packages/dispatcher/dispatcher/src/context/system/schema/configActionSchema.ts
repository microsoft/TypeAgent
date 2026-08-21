// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ConfigAction =
    | ListAgents
    | ToggleAgent
    | ToggleExplanationAction
    | ToggleDeveloperModeAction
    | EnterAgentPriorityModeAction
    | ExitAgentPriorityModeAction
    | RunConfigCommandAction;

export type ConfigCommandPath =
    | "action"
    | "agent"
    | "agent refresh"
    | "agent setup"
    | "cache grammarSystem"
    | "cache useDFA"
    | "collision"
    | "collision contextSelector decay"
    | "collision contextSelector detect"
    | "collision contextSelector detect off"
    | "collision contextSelector detect on"
    | "collision contextSelector margin"
    | "collision contextSelector minMass"
    | "collision contextSelector minUniqueTokens"
    | "collision contextSelector windowTurns"
    | "collision fuzzy detect"
    | "collision fuzzy detect off"
    | "collision fuzzy detect on"
    | "collision fuzzy strategy"
    | "collision grammarMatch detect"
    | "collision grammarMatch detect off"
    | "collision grammarMatch detect on"
    | "collision grammarMatch strategy"
    | "collision llmSelect detect"
    | "collision llmSelect detect off"
    | "collision llmSelect detect on"
    | "collision llmSelect strategy"
    | "collision preference enabled"
    | "collision preference enabled off"
    | "collision preference enabled on"
    | "collision preference registry"
    | "collision preference registryFirst"
    | "collision preference registryFirst off"
    | "collision preference registryFirst on"
    | "collision preference remember"
    | "collision preference source"
    | "collision priority"
    | "collision show"
    | "collision static detect"
    | "collision static detect off"
    | "collision static detect on"
    | "collision static strategy"
    | "collision telemetry debugLog"
    | "collision telemetry debugLog off"
    | "collision telemetry debugLog on"
    | "collision telemetry emit"
    | "collision telemetry emit off"
    | "collision telemetry emit on"
    | "collision telemetry experimentId"
    | "command"
    | "dev"
    | "dev off"
    | "dev on"
    | "execution activity"
    | "execution activity off"
    | "execution activity on"
    | "execution conversationAnswer"
    | "execution entityPromptShape"
    | "execution planReuse"
    | "execution reasoning"
    | "execution reasoningEffort"
    | "execution reasoningForwardActions"
    | "execution reasoningForwardActions off"
    | "execution reasoningForwardActions on"
    | "execution reasoningHistory"
    | "execution reasoningModel"
    | "execution recordUserMessages"
    | "execution recordUserMessages off"
    | "execution recordUserMessages on"
    | "execution scriptReuse"
    | "execution setupOnFirstUse"
    | "execution setupOnFirstUse off"
    | "execution setupOnFirstUse on"
    | "execution subagents"
    | "execution subagents off"
    | "execution subagents on"
    | "explainer"
    | "explainer async"
    | "explainer async off"
    | "explainer async on"
    | "explainer filter"
    | "explainer filter multiple"
    | "explainer filter multiple off"
    | "explainer filter multiple on"
    | "explainer filter off"
    | "explainer filter on"
    | "explainer filter reference"
    | "explainer filter reference list"
    | "explainer filter reference list off"
    | "explainer filter reference list on"
    | "explainer filter reference off"
    | "explainer filter reference on"
    | "explainer filter reference translate"
    | "explainer filter reference translate off"
    | "explainer filter reference translate on"
    | "explainer filter reference value"
    | "explainer filter reference value off"
    | "explainer filter reference value on"
    | "explainer model"
    | "explainer name"
    | "explainer off"
    | "explainer on"
    | "log db"
    | "log db off"
    | "log db on"
    | "match grammar"
    | "match grammar off"
    | "match grammar on"
    | "modelProvider"
    | "request"
    | "schema"
    | "scrub"
    | "scrub off"
    | "scrub on"
    | "translation"
    | "translation entity clarify"
    | "translation entity clarify off"
    | "translation entity clarify on"
    | "translation entity filter"
    | "translation entity filter off"
    | "translation entity filter on"
    | "translation entity resolve"
    | "translation entity resolve off"
    | "translation entity resolve on"
    | "translation history limit"
    | "translation history off"
    | "translation history on"
    | "translation model"
    | "translation multi off"
    | "translation multi on"
    | "translation multi pending"
    | "translation multi pending off"
    | "translation multi pending on"
    | "translation multi result"
    | "translation multi result off"
    | "translation multi result on"
    | "translation off"
    | "translation on"
    | "translation recentActions limit"
    | "translation recentActions off"
    | "translation recentActions on"
    | "translation schema generation json"
    | "translation schema generation json off"
    | "translation schema generation json on"
    | "translation schema generation jsonFunc"
    | "translation schema generation jsonFunc off"
    | "translation schema generation jsonFunc on"
    | "translation schema optimize actions"
    | "translation schema optimize off"
    | "translation schema optimize on"
    | "translation stream"
    | "translation stream off"
    | "translation stream on"
    | "translation switch embedding"
    | "translation switch embedding off"
    | "translation switch embedding on"
    | "translation switch fix"
    | "translation switch inline"
    | "translation switch inline off"
    | "translation switch inline on"
    | "translation switch off"
    | "translation switch on"
    | "translation switch search"
    | "translation switch search off"
    | "translation switch search on";

// Run one exact TypeAgent configuration command through the canonical command parser.
export type RunConfigCommandAction = {
    actionName: "runConfigCommand";
    parameters: {
        // Executable command path after "@config".
        command: ConfigCommandPath;
        // Positional argument values in command order. Use an empty string to clear settings that support it.
        arguments?: string[];
        flags?: {
            reset?: boolean;
            off?: string[];
            priority?: string[];
            confirm?: boolean;
        };
    };
};

// Shows the list of available agents
export type ListAgents = {
    actionName: "listAgents";
};

// Toggle use of LLM, agent or AI.
export type ToggleAgent = {
    actionName: "toggleAgent";
    parameters: {
        enable: boolean;
        agentNames: string[];
    };
};

// Toggle explanation.
export type ToggleExplanationAction = {
    actionName: "toggleExplanation";
    parameters: {
        enable: boolean;
    };
};

// Toggle developer mode.
export type ToggleDeveloperModeAction = {
    actionName: "toggleDeveloperMode";
    parameters: {
        enable: boolean;
    };
};

// Puts a specific agent into priority mode
export type EnterAgentPriorityModeAction = {
    actionName: "enterAgentPriorityMode";
    parameters: {
        // the agent name or wildcard match string (* to match all agents)
        agentName: string;
    };
};

// Leaves agent priority mode
export type ExitAgentPriorityModeAction = {
    actionName: "exitAgentPriorityMode";
    parameters: {};
};
