// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface LanguageTools {
    possibleReferentialPhrase(phrase: string): boolean;
    hasClosedClass(phase: string, exact?: boolean /* = false */): boolean;
}

const subjectPronouns = [
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    // "you",  // doubled above
    "they",
    "you-all",
    "y'all",
    "thou",
    "ye",
    "youse",
];

const objectPronouns = [
    "me",
    "you",
    "him",
    "her",
    "it",
    "us",
    // "you",  // doubled above
    "them",
    "you-all",
    "y'all",
    "thee",
    "ye",
    "youse",
];

const possessivePronouns = [
    "mine",
    "yours",
    "his",
    "hers",
    "its",
    "ours",
    "yours",
    "theirs",
    "one's",
    "thine",
    "yeers",
    "y'all's",
    "each other's",
    "one another's",
];

const reflexivePronouns = [
    "myself",
    "yourself",
    "himself",
    "herself",
    "itself",
    "ourselves",
    "yourselves",
    "themselves",
    "oneself",
    "thyself",
    "whoself",
];
const demostrativePronouns = ["this", "that", "these", "those"];
const indefinitePronouns = [
    "all",
    "another",
    "any",
    "anybody",
    "anyone",
    "anything",
    "aught",
    "both",
    "certain",
    "each",
    "either",
    "enough",
    "everybody",
    "everyone",
    "everything",
    "few",
    "fewer",
    "fewest",
    "little",
    "many",
    "more",
    "most",
    "neither",
    "no one",
    "nobody",
    "none",
    "nothing",
    "one",
    "other",
    "others",
    "own",
    "plenty",
    "several",
    "same",
    "some",
    "somebody",
    "someone",
    "something",
    "somewhat",
    "such and such",
    "such",
    "suchlike",
];

const interrogativePronouns = [
    "what",
    "whate'er",
    "whatever",
    "whatsoever",
    "which",
    "whichever",
    "whichsoever",
    "who",
    "whoever",
    "whoso",
    "whosoever",
    "whom",
    "whomever",
    "whomsoever",
    "whose",
];

const relativePronuns = ["as", "that", ...interrogativePronouns];
const reciprocalPronouns = ["each other", "one another"];
const possessiveAdjectives = [
    "my",
    "your",
    "his",
    "her",
    "its",
    "our",
    "your",
    "their",
    "one's",
    "yeer",
    "y'all's",
    "each other's",
    "one another's",
];

const demostrativeAdverbs = ["here", "there"];

const conjunctions = [
    "according as",
    "and",
    "after",
    "albeit",
    "although",
    "as if",
    "as long as",
    "as though",
    "as",
    "because",
    "before",
    "both and",
    "but that",
    "but then again",
    "but then",
    "but",
    "considering",
    "cos",
    "directly",
    "either or",
    "ere",
    "except",
    "for",
    "forasmuchas",
    "how",
    "however",
    "if",
    "immediately",
    "in as far as",
    "inasmuch as",
    "insofar as",
    "insomuch that",
    "insomuchas",
    "lest",
    "like",
    "neither nor",
    "neither",
    "nor",
    "notwithstanding",
    "now that",
    "now",
    "once",
    "only",
    "or",
    "provided that",
    "provided",
    "providing that",
    "providing",
    "seeing as how",
    "seeing as",
    "seeing that",
    "seeing",
    "since",
    "so",
    "suppose",
    "supposing",
    "than",
    "that",
    "though",
    "till",
    "unless",
    "until",
    "when",
    "whenever",
    "where",
    "whereas",
    "whereat",
    "whereby",
    "wherever",
    "whereof",
    "wherein",
    "whereon",
    "wheresoever",
    "whereto",
    "whereupon",
    "whereunto",
    "whether",
    "while",
    "whilst",
    "why",
    "without",
    "yet",
];

const prepositions = [
    "aboard",
    "about",
    "above",
    "across",
    "after",
    "against",
    "along",
    "amid",
    "amidst",
    "among",
    "amongst",
    "around",
    "as",
    "at",
    "before",
    "behind",
    "below",
    "beneath",
    "beside",
    "besides",
    "between",
    "beyond",
    "but",
    "by",
    "circa",
    "concerning",
    "considering",
    "despite",
    "down",
    "during",
    "ere",
    "except",
    "following",
    "for",
    "from",
    "in",
    "inside",
    "into",
    "less",
    "like",
    "mid", // amid
    "midst",
    "minus",
    "near",
    "next",
    "nigh",
    "of",
    "off",
    "on",
    "onto",
    "opposite",
    "out",
    "outside",
    "over",
    "o'vr", // over
    "pace",
    "past",
    "per",
    "plus",
    "re",
    "regarding",
    "round",
    "sans",
    "save",
    "since",
    "than",
    "through",
    "throughout",
    "thru",
    "till",
    "to",
    "toward",
    "towards",
    "under",
    "underneath",
    "unlike",
    "until",
    "up",
    "upon",
    "versus",
    "via",
    "vice",
    "vs",
    "while",
    "with",
    "within",
    "without",
    "worth",
];

function combineSets(words: string[][]): string[] {
    const set = new Set<string>(words.flat());
    return Array.from(set.values()).sort();
}

function exactMatch(words: string[][]): RegExp {
    return new RegExp(`^(?:${combineSets(words).join("|")})$`, "i");
}

function suffixMatch(words: string[][], prefix?: string): RegExp {
    return new RegExp(
        `\\b${prefix ? `${prefix}\\s` : ""}(?:${combineSets(words).join("|")})$`,
        "i",
    );
}

function partOfMatch(words: string[][]): RegExp {
    return new RegExp(`\\b(?:${combineSets(words).join("|")})\\b`, "i");
}

const referenceWords = exactMatch([
    objectPronouns,
    possessivePronouns,
    reflexivePronouns,
]);
const referenceOfSuffixes = suffixMatch(
    [objectPronouns, possessivePronouns, reflexivePronouns],
    "of",
);

const referenceParts = partOfMatch([
    demostrativePronouns,
    indefinitePronouns,
    interrogativePronouns,
    relativePronuns,
    reciprocalPronouns,
    possessiveAdjectives,
]);

const referenceSuffixes = suffixMatch([demostrativeAdverbs]);

const closeClass = [
    subjectPronouns,
    objectPronouns,
    possessivePronouns,
    reflexivePronouns,
    demostrativePronouns,
    indefinitePronouns,
    interrogativePronouns,
    relativePronuns,
    reciprocalPronouns,
    possessiveAdjectives,
    demostrativeAdverbs,
    prepositions,
    conjunctions,
];
const partClosedClass = partOfMatch(closeClass);
const exactClosedClass = exactMatch(closeClass);

// REVIEW: Heuristics to allow time references from now.
const relativeToNow =
    /this (week|month|year|quarter|season|day|hour|minute|second|morning|afternoon)$/i;

const languageToolsEn: LanguageTools = {
    possibleReferentialPhrase(phrase: string) {
        // TODO: initial implementation. Can be over-broad and incomplete.
        return (
            (referenceWords.test(phrase) ||
                referenceSuffixes.test(phrase) ||
                referenceOfSuffixes.test(phrase) ||
                referenceParts.test(phrase)) &&
            !relativeToNow.test(phrase)
        );
    },
    hasClosedClass(phrase: string, exact: boolean = false) {
        return (exact ? exactClosedClass : partClosedClass).test(phrase);
    },
};

export function getLanguageTools(language: string): LanguageTools | undefined {
    if (language !== "en") {
        return undefined;
    }

    return languageToolsEn;
}
