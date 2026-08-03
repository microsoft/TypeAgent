// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SelfHelpAction = AnswerTypeAgentQuestionAction;

// Answer a user asking HOW TO DO SOMETHING in TypeAgent - especially "what's the
// command for X" or "how do I X". The handler finds the matching @-command(s) and
// equivalent natural-language action(s) from the TypeAgent command catalog. Use
// only for questions about operating TypeAgent itself; not for general knowledge
// or for performing a task in another domain.
export interface AnswerTypeAgentQuestionAction {
    actionName: "answerTypeAgentQuestion";
    parameters: {
        // The user's question about how to do something in TypeAgent, verbatim.
        question: string;
    };
}
