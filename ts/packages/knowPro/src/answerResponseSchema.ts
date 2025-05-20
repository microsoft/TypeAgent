// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AnswerType =
    | "NoAnswer" // If question cannot be accurately answered from [ANSWER CONTEXT]
    | "Answered"; // Fully answer question

export type AnswerResponse = {
    // use "NoAnswer" if no highly relevant answer found in the [ANSWER CONTEXT]
    type: AnswerType;
    // The question being answered
    question?: string;
    // the answer to display if [ANSWER CONTEXT] is highly relevant and can be used to answer the user's question
    answer?: string | undefined;
    // If NoAnswer, explain why..
    // particularly explain why you didn't use any supplied entities
    whyNoAnswer?: string;
};
