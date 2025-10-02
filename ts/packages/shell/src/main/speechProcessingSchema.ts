// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// An action that processes speech input and returns processed text
// Processed text has been annotated to indicate user intent.
export type SpeechProcessingAction = {
    actionName: "speechProcessingAction";
    parameters: {
        // The original, unmodified speech input
        inputText: string;
        // An XML string containing the processed text
        processedText: UserExpression[];
    };
};

export type UserExpression = {
    type: "statement" | "question" | "command" | "other";
    other_explanation?: string;
    confidence: "low" | "medium" | "high";
    complete_statement: boolean;
    text: string;
};
