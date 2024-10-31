// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface LanguageTools {
    possibleReferentialPhrase(phrase: string): boolean;
}

const referenceWords = [
    "him",
    // "her",
    "it",
    "them",
    // "his",  // doubled by referenceParts
    "hers",
    "theirs",
    // "its", // doubled by referenceParts
];

const referenceOfSuffixes = referenceWords.map(
    (w) => new RegExp(`\\bof\\s${w}$`),
);

const referenceSuffixes = ["here", "there"].map((w) => new RegExp(`\\b${w}$`));

const referenceParts = [
    "his",
    "her",
    "its",
    "their",
    "this",
    "that",
    "these",
    "those",
].map((w) => new RegExp(`\\b${w}\\b`));

// REVIEW: Heuristics to allow time references from now.
const relativeToNow =
    /this (week|month|year|quarter|season|day|hour|minute|second|morning|afternoon)$/;

const languageToolsEn: LanguageTools = {
    possibleReferentialPhrase(phrase: string) {
        // TODO: initiali implemention. Can be overbroad and incomplete.
        const lowerCase = phrase.toLowerCase();
        return (
            (referenceWords.some((r) => r === lowerCase) ||
                referenceSuffixes.some((r) => r.test(lowerCase)) ||
                referenceOfSuffixes.some((r) => r.test(lowerCase)) ||
                referenceParts.some((r) => r.test(lowerCase))) &&
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
