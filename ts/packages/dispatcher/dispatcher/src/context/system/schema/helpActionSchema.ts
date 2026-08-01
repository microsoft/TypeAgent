// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type HelpAction =
    | AnswerTypeAgentQuestionAction
    | DescribeAgentAction
    | DescribeActionAction;

// Answer any question about TypeAgent ITSELF that isn't about one specific named
// agent: find the command or action for a task ("what's the command for X", "how
// do I X", "can I X in TypeAgent"), OR explain a concept, feature, or setup topic
// ("what is TypeAgent", "how does translation/memory/the cache work", "what keys
// do I need", "how do I install/configure/run it"). Answers with a summary plus
// any matching @-command(s)/action(s). Not for general knowledge, not for
// performing a task in another domain, and not for describing a specific named
// agent (use describeAgent).
export type AnswerTypeAgentQuestionAction = {
    actionName: "answerTypeAgentQuestion";
    parameters: {
        // The user's question about TypeAgent, verbatim.
        question: string;
    };
};

// Describe what a SPECIFIC INSTALLED agent can do: a natural-language summary
// plus its actions. Use ONLY when the user names an actual agent (e.g. "what can
// the spotify agent do", "describe the calendar agent", "show me all of
// spotify's actions"). Works for installed-but-disabled agents too. Do NOT use
// this for a TypeAgent concept or feature that is not an installed agent (use
// explainTypeAgent), and do NOT use it to execute an action.
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
