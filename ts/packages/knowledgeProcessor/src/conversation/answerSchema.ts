// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AnswerRelevance =
    | "NoAnswer" // Query was NOT answered
    | "Answered"; // Fully answer question

export type AnswerResponse = {
    // use "NoAnswer" if no highly relevant answer found in the conversation history OR if the provided information is insufficient or ambiguous
    type: AnswerRelevance;
    // the answer to display if the conversation history is highly relevant and can be used to answer the user's question
    answer?: string | undefined;
    // If NoAnswer, explain why..
    // particularly explain why you didn't use any supplied entities
    whyNoAnswer?: string;
};
