// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface LanguageTools {
    possibleReferentialPhrase(phrase: string): boolean;
}

const referenceWords = [
    "he",
    "she",
    "it",
    "they",
    "him",
    "her",
    "them",
    "his",
    "hers",
    "theirs",
    "its",
    "this",
    "that",
    "these",
    "those",
    "here",
    "there",
];

const referencePrefixes = [
    "his ",
    "her ",
    "its",
    "their ",
    "this ",
    "that ",
    "these ",
    "those ",
];

// REVIEW: Heuristics to allow time references from now.
const relativeToNow =
    /^this (week|month|year|quarter|season|day|hour|minute|second|morning|afternoon)$/;

const languageToolsEn: LanguageTools = {
    possibleReferentialPhrase(phrase: string) {
        // TODO: initiali implemention. Can be overbroad and incomplete.
        const lowerCase = phrase.toLowerCase();
        return (
            (referenceWords.includes(lowerCase) ||
                referencePrefixes.some((prefix) =>
                    lowerCase.startsWith(prefix),
                )) &&
            !relativeToNow.test(phrase)
        );
    },
};

export function getLanguageTools(language: string): LanguageTools | undefined {
    if (language !== "en") {
        return undefined;
    }

    return languageToolsEn;
}
