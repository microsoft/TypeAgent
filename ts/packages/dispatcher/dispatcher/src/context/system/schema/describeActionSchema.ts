// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DescribeAction =
    | DescribeAgentOrAction
    | DescribeAgentAction
    | DescribeActionAction;

// Describe an agent, or one action when actionName is supplied.
export type DescribeAgentOrAction = {
    actionName: "describeAgentOrAction";
    parameters: {
        // Agent name, or an action name when no owning agent is supplied.
        name: string;
        // Action name when name identifies the owning agent.
        targetActionName?: string;
        // Whether to show all actions instead of the default subset.
        all?: boolean;
    };
};

// Describe what an agent can do: a natural-language summary plus its actions.
// Works for installed-but-disabled agents too — describing is informational
// and does not require the agent to be enabled.
// Examples: "what can the spotify agent do", "describe spotify",
// "show me all of spotify's actions", "list everything calendar can do".
export type DescribeAgentAction = {
    actionName: "describeAgent";
    parameters: {
        // the agent to describe
        agentName: string;
        // true when the user asks for ALL actions, not the default set
        all?: boolean;
    };
};

// Explain a single action in detail, beyond its one-line schema description.
// Examples: "what does the play action do", "describe spotify's play action",
// "describe the play action from spotify".
export type DescribeActionAction = {
    actionName: "describeAction";
    parameters: {
        // the action to describe
        actionName: string;
        // optional owning agent, when the user names one
        agentName?: string;
    };
};
