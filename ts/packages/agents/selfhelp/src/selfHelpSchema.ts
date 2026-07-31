// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SelfHelpAction =
    AnswerTypeAgentQuestionAction | ExplainTypeAgentAction;
// TODO(describeAgent): temporarily disabled - overlaps the built-in
// system.describe.describeAgent (dispatcher). To re-enable, add
// `| DescribeAgentAction` back here and uncomment the interface below plus its
// handler wiring, ideally after deciding how to combine the two describes.
// | DescribeAgentAction;

// Answer a user asking HOW TO DO SOMETHING in TypeAgent, or WHETHER a specific
// task is possible - e.g. "what's the command for X", "how do I X", or "can I X
// in TypeAgent". The handler finds the matching @-command(s) and equivalent
// natural-language action(s) from the TypeAgent command catalog; if nothing
// matches it says the task is not supported. Use only for questions about
// operating TypeAgent itself, not for general knowledge or for performing a task
// in another domain.
export interface AnswerTypeAgentQuestionAction {
    actionName: "answerTypeAgentQuestion";
    parameters: {
        // The user's question about how to do something in TypeAgent, verbatim.
        question: string;
    };
}

// Answer a CONCEPTUAL or SETUP question about TypeAgent as a whole - what it is,
// how it works, what it can do overall, how it compares to other assistants, or
// how to install/configure/run it (API keys, platforms, voice). Use for
// questions about TypeAgent itself, NOT to look up a particular command (use
// answerTypeAgentQuestion). A question about one specific named agent is handled
// by the built-in describe, not here.
export interface ExplainTypeAgentAction {
    actionName: "explainTypeAgent";
    parameters: {
        // The user's conceptual or setup question about TypeAgent, verbatim.
        question: string;
    };
}

// TODO(describeAgent): Temporarily disabled. This action overlaps the built-in
// system.describe.describeAgent (dispatcher - see
// packages/dispatcher/dispatcher/src/context/system/schema/describeActionSchema.ts),
// which already describes an agent's actions deterministically and out-competed
// this one for routing. Kept for a future pass that may combine the two (e.g.
// have this LLM-grounded describe enrich or back the system one). To re-enable,
// restore `| DescribeAgentAction` in the union above and uncomment the handler
// wiring in selfHelpActionHandler.ts.
//
// Describe what a SPECIFIC named application agent can do - e.g. "what can the
// browser agent do", "does the list agent remove items", "what can player
// handle". The handler grounds the answer on that agent's actions and commands
// from the catalog. Use when the question names or clearly refers to one agent;
// use explainTypeAgent for TypeAgent as a whole and answerTypeAgentQuestion to
// look up a particular command.
// export interface DescribeAgentAction {
//     actionName: "describeAgent";
//     parameters: {
//         // The user's question about the agent, verbatim.
//         question: string;
//         // The named agent the question is about, if the user identified one
//         // (e.g. "browser", "player", "list"). Omit if unclear.
//         agent?: string;
//     };
// }
