// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface LanguageTools {
    possibleReferentialPhrase(phrase: string): boolean;
}

const referenceWordList = [
    // object pronouns
    "me",
    "you",
    "him",
    // "her",   // doubled by possessive pronouns in referenceParts
    "it",
    "us",
    // "you",  // doubled above/
    "them",

    // possessive pronons
    "mine",
    "yours",
    // "his", // doubled by possessive pronouns in referenceParts
    "hers",
    // "its"  // doubled by possessive pronouns in referenceParts
    "ours",
    // "yours",  // doubled above
    "theirs",

    // reflexive pronouns
    "myself",
    "yourself",
    "himself",
    "herself",
    "itself",
    "ourselves",
    "yourselves",
    "themselves",
];

const referenceWords = new RegExp(`^(?:${referenceWordList.join("|")})$`, "i");
const referenceOfSuffixes = new RegExp(
    `\\bof\\s(?:${referenceWordList.join("|")})$`,
    "i",
);

const referenceSuffixes = new RegExp(
    `\\b(?:${["here", "there"].join("|")})$`,
    "i",
);

const referenceParts = new RegExp(
    `\\b(?:${[
        // possessive adjectives
        "my",
        "your",
        "his",
        "her",
        "its",
        "our",
        "your",
        "their",

        // demostratives pronouns
        "this",
        "that",
        "these",
        "those",
    ].join("|")})\\b`,
    "i",
);

// REVIEW: Heuristics to allow time references from now.
const relativeToNow =
    /this (week|month|year|quarter|season|day|hour|minute|second|morning|afternoon)$/i;

const languageToolsEn: LanguageTools = {
    possibleReferentialPhrase(phrase: string) {
        // TODO: initiali implemention. Can be overbroad and incomplete.
        return (
            (referenceWords.test(phrase) ||
                referenceSuffixes.test(phrase) ||
                referenceOfSuffixes.test(phrase) ||
                referenceParts.test(phrase)) &&
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
