// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getLanguageTools } from "../src/utils/language.js";

const referenceTests = [
    "him",
    "all of his dishes",
    "some of theirs",
    "this song",
    "that movie",
    "some of these people",
    "those places",
    "that week",
    "his album",
    "her book",
    "its cover",
    "their car",
    "all of him",
    "location here",
    "somewhere over there",
    "some of it",
];

const nonReferenceTests = [
    "this week",
    "it's a good day",
    "Chemical Brothers",
    "here comes the sun",
];

const langTool = getLanguageTools("en")!;
describe("LanguageTools", () => {
    describe("possibleReferentialPhrase", () => {
        it.each(referenceTests)("reference - %s", (phrase) => {
            expect(langTool.possibleReferentialPhrase(phrase)).toBe(true);
        });
        it.each(nonReferenceTests)("not reference - %s", (phrase) => {
            expect(langTool.possibleReferentialPhrase(phrase)).toBe(false);
        });
    });
});
