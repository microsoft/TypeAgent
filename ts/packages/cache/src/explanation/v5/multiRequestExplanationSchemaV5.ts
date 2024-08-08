// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MultiRequestExplanation = {
    subPhrases: (SimpleSentenceRequest | Conjunctions)[];
};

export type SimpleSentenceRequest = {
    text: string;
    actionIndex: number[];
};

export type Conjunctions = {
    // For example, "and", "or", "but", etc.
    text: string;
};
