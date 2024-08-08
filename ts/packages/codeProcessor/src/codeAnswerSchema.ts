// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type RelevantLine = {
    lineNumber: number;
    comment: string;
    relevance: "High" | "Medium" | "Low" | "None";
};

export type CodeAnswer = {
    answerStatus: "Answered" | "PartiallyAnswered" | "NotAnswered";
    // Lines of supplied code that may answer the user's question
    answerLines?: RelevantLine[];
};
