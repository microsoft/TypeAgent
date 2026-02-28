// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ListRulesAction = {
    actionName: "listRules";
    parameters?: {
        // Agent/schema name to filter by (e.g. "player", "calendar", "email", "browser").
        // Omit to list all rules across all agents.
        // Use the short agent name, not the npm package name (e.g. "player" not "music").
        agentName?: string;
    };
};

export type ShowRuleAction = {
    actionName: "showRule";
    parameters: {
        // Numeric ID of the rule to inspect, as shown in listRules output
        id: number;
    };
};

export type DeleteRuleAction = {
    actionName: "deleteRule";
    parameters: {
        // Numeric ID of the rule to delete, as shown in listRules output
        id: number;
    };
};

export type ClearRulesAction = {
    actionName: "clearRules";
    parameters?: {
        // Agent/schema name to clear rules for (e.g. "player", "calendar", "email").
        // Omit to clear ALL rules across all agents.
        agentName?: string;
    };
};

export type GrammarAction =
    | ListRulesAction
    | ShowRuleAction
    | DeleteRuleAction
    | ClearRulesAction;
