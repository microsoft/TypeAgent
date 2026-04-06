// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PhraseGenActions =
    | GeneratePhrasesAction
    | AddPhraseAction
    | RemovePhraseAction
    | ApprovePhrasesAction;

export type GeneratePhrasesAction = {
    actionName: "generatePhrases";
    parameters: {
        // Integration name to generate phrases for
        integrationName: string;
        // Number of phrases to generate per action (default: 5)
        phrasesPerAction?: number;
        // Generate phrases only for these specific action names (generates for all if omitted)
        forActions?: string[];
    };
};

export type AddPhraseAction = {
    actionName: "addPhrase";
    parameters: {
        // Integration name
        integrationName: string;
        // The action name this phrase should map to
        actionName: string;
        // The natural language phrase to add
        phrase: string;
    };
};

export type RemovePhraseAction = {
    actionName: "removePhrase";
    parameters: {
        // Integration name
        integrationName: string;
        // The action name to remove the phrase from
        actionName: string;
        // The exact phrase to remove
        phrase: string;
    };
};

export type ApprovePhrasesAction = {
    actionName: "approvePhrases";
    parameters: {
        // Integration name to approve phrases for
        integrationName: string;
    };
};
