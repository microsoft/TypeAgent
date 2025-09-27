// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// An action that processes speech input and returns processed text
// Processed text is in XML format that has been annotated to indicate user intent.
export type SpeechProcessingAction = {
    actionName: "speechProcessingAction";
    parameters: {
        // The original, unmodified speech input
        inputText: string;
        // An XML string containing the processed text
        processedText: string;
    }
}
