// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SelfHelpAction = AnswerTypeAgentQuestionAction;

// Answer any question about TypeAgent itself: how to do something (the command
// or action for a task, "what's the command for X", "how do I X", "can I X"), or
// a concept/setup topic (what TypeAgent is, how a feature works, what
// keys/configuration are needed to run it). Use only for questions about
// TypeAgent itself, not for general knowledge or for performing a task in
// another domain.
export interface AnswerTypeAgentQuestionAction {
    actionName: "answerTypeAgentQuestion";
    parameters: {
        // The user's question about TypeAgent, verbatim.
        question: string;
    };
}
