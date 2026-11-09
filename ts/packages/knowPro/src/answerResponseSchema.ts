// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AnswerType =
    | "NoAnswer" // If question cannot be accurately answered from [ANSWER CONTEXT]
    | "Answered"; // Fully answer question

export type AnswerResponse = {
    // Supported public facts useful to another evidence part, even when this part cannot answer.
    // Keep source identity, dates, attribution, corrections, bounds and uncertainty.
    supportingFacts?: {
        text: string;
        sourceMessageOrdinals?: number[];
    }[];
    // use "NoAnswer" if no highly relevant answer found in the [ANSWER CONTEXT]
    type: AnswerType;
    // the answer to display if [ANSWER CONTEXT] is highly relevant and can be used to answer the user's question
    answer?: string | undefined;
    // If NoAnswer, explain what is still missing without discarding supported facts.
    // particularly explain why you didn't use any supplied entities
    whyNoAnswer?: string;
};
