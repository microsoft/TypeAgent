// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachCompletion, expectMetadata } from "./testUtils.js";

describeForEachCompletion(
    "Grammar Completion - multi-word keyword fully matched first word at EOI",
    (matchGrammarCompletion) => {
        // Reproduces a bug where a wildcard-at-EOI absorbs a keyword that
        // the grammar should recognize.
        //
        // Grammar:
        //   <Start> = play something good -> 1
        //           | play $(x:string) played by -> 2;
        //
        // Input: "play something played"
        //
        // Expected: Alternative 2 matches with x="something" and
        //   "played" consumed as the first keyword word.  The completion
        //   should offer "by" (the second keyword word).
        //
        // Bug: findPartialKeywordInWildcard returns position=prefix.length
        //   for the "consumed to EOI with more words remaining" case, but
        //   the forward code requires position < state.index — which fails
        //   when they're equal.  The result falls through to Phase 3's
        //   tryPartialStringMatch at EOI, which naively offers "played"
        //   instead of "by".
        const g = [
            `<Start> = play something good -> 1 | play $(x:string) played by -> 2;`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it('forward: "play something played" — should offer "by", not "played"', () => {
            // Buggy result:
            //   completions: ["played"], matchedPrefixLength: 21,
            //   separatorMode: "autoSpacePunctuation", afterWildcard: "all"
            //
            // Correct: "played" is keyword word 0, fully matched to EOI.
            // The completion should be "by" (keyword word 1) at
            // matchedPrefixLength=21.
            const result = matchGrammarCompletion(
                grammar,
                "play something played",
                undefined,
                "forward",
            );
            expectMetadata(result, {
                completions: ["by"],
                matchedPrefixLength: 21,
                separatorMode: "autoSpacePunctuation",
                closedSet: true,
                directionSensitive: true,
                afterWildcard: "all",
                properties: [],
            });
        });

        it('forward: "play something play" — partial keyword + merge, completions: ["good", "played"]', () => {
            // "play" is a partial prefix of "played" — this correctly
            // offers "played" via findPartialKeywordInWildcard at
            // position 15 (start of "play"), which is < state.index.
            // "good" (from Rule 1) survives because the gap between
            // matchedPrefixLength=14 and anchor=15 is separator-only (merge path).
            const result = matchGrammarCompletion(
                grammar,
                "play something play",
                undefined,
                "forward",
            );
            expectMetadata(result, {
                completions: ["good", "played"],
                matchedPrefixLength: 14,
                separatorMode: "autoSpacePunctuation",
                closedSet: true,
                directionSensitive: true,
                afterWildcard: "some",
                properties: [],
            });
        });

        it('backward: "play something play" — separator-only gap preserves "good"', () => {
            // When backward encounters a partial keyword whose position
            // exceeds maxPrefixLength across a separator-only gap,
            // fixedCandidates (like "good" from Rule 1) must be
            // preserved rather than cleared.
            const result = matchGrammarCompletion(
                grammar,
                "play something play",
                undefined,
                "backward",
            );
            // properties:[] — the partial keyword path only produces
            // fixed string candidates, not property completions.
            expectMetadata(result, {
                completions: ["good", "played"],
                matchedPrefixLength: 14,
                separatorMode: "autoSpacePunctuation",
                closedSet: true,
                directionSensitive: true,
                afterWildcard: "some",
                properties: [],
            });
        });

        it('backward: "play something played" — range candidate uses truncated prefix', () => {
            // Backward range candidate processing must truncate the
            // prefix to maxPrefixLength before calling
            // tryPartialStringMatch.  Without truncation, the match
            // peeks at "played" beyond mpl and incorrectly offers
            // "by" instead of the expected completions.
            const result = matchGrammarCompletion(
                grammar,
                "play something played",
                undefined,
                "backward",
            );
            expectMetadata(result, {
                completions: ["good", "played"],
                matchedPrefixLength: 14,
                separatorMode: "autoSpacePunctuation",
                closedSet: true,
                directionSensitive: true,
                afterWildcard: "some",
                properties: [],
            });
        });

        it('forward: "play something played " — first keyword word + space, should offer "by"', () => {
            // Buggy result:
            //   completions: ["played"], matchedPrefixLength: 22,
            //   separatorMode: "autoSpacePunctuation", afterWildcard: "all"
            //
            // Correct: "played " with trailing space — the first keyword
            // word was fully matched.  Should offer "by" at
            // matchedPrefixLength=22.
            const result = matchGrammarCompletion(
                grammar,
                "play something played ",
                undefined,
                "forward",
            );
            expectMetadata(result, {
                completions: ["by"],
                matchedPrefixLength: 22,
                separatorMode: "autoSpacePunctuation",
                closedSet: true,
                directionSensitive: true,
                afterWildcard: "all",
                properties: [],
            });
        });
        describe("plain wildcard grammar", () => {
            const g2 = [
                `<Start> = play $(name) played by $(artist) -> { name, artist };`,
            ].join("\n");
            const grammar2 = loadGrammarRules("test.grammar", g2);

            it('forward: "play Never played " — trailing space offers "by"', () => {
                const result = matchGrammarCompletion(
                    grammar2,
                    "play Never played ",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["by"],
                    matchedPrefixLength: 18,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("forward: full first keyword word + partial second offers 'by'", () => {
                const result = matchGrammarCompletion(
                    grammar2,
                    "play Never played b",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["by"],
                    matchedPrefixLength: 17,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("backward: trailing space after full first keyword word backs up to wildcard", () => {
                const result = matchGrammarCompletion(
                    grammar2,
                    "play Never played ",
                    undefined,
                    "backward",
                );
                // Trailing space is inside the wildcard content, not
                // after a committed keyword boundary — backward still
                // backs up to the wildcard start.
                expectMetadata(result, {
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [
                        {
                            match: {},
                            propertyNames: ["name"],
                        },
                    ],
                });
            });

            it("backward: partial first keyword word offers 'played'", () => {
                const result = matchGrammarCompletion(
                    grammar2,
                    "play Never p",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["played"],
                    matchedPrefixLength: 10,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it("backward: full first keyword word at EOI backs up to wildcard", () => {
                const result = matchGrammarCompletion(
                    grammar2,
                    "play Never played",
                    undefined,
                    "backward",
                );
                // Full keyword word at EOI — the partial keyword
                // position equals state.index, so backward falls
                // through to collectBackwardCandidate which backs
                // up to the wildcard start.
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [
                        {
                            match: {},
                            propertyNames: ["name"],
                        },
                    ],
                });
            });

            it("backward: full first keyword word + partial second offers 'by'", () => {
                const result = matchGrammarCompletion(
                    grammar2,
                    "play Never played b",
                    undefined,
                    "backward",
                );
                expectMetadata(result, {
                    completions: ["by"],
                    matchedPrefixLength: 17,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });
        });

        describe("3-word keyword — two words consumed at EOI", () => {
            const g3 = [
                `<Start> = play $(name) played by someone $(extra) -> { name, extra };`,
            ].join("\n");
            const grammar3 = loadGrammarRules("test.grammar", g3);

            it('forward: "play Never played by" — offers "someone"', () => {
                const result = matchGrammarCompletion(
                    grammar3,
                    "play Never played by",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["someone"],
                    matchedPrefixLength: 20,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });

            it('backward: "play Never played by" — backs up to wildcard', () => {
                const result = matchGrammarCompletion(
                    grammar3,
                    "play Never played by",
                    undefined,
                    "backward",
                );
                // Two keyword words consumed to EOI — the partial
                // keyword position equals state.index, so backward
                // falls through to collectBackwardCandidate which
                // backs up to the wildcard start.
                expectMetadata(result, {
                    completions: [],
                    matchedPrefixLength: 4,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: false,
                    directionSensitive: true,
                    afterWildcard: "none",
                    properties: [
                        {
                            match: {},
                            propertyNames: ["name"],
                        },
                    ],
                });
            });
        });

        describe("consumed-to-EOI edge case (matchKeywordWordsFrom textToCheck='')", () => {
            // Minimal grammar isolating the edge case where the first
            // keyword word is fully consumed to end-of-input with a
            // second word remaining.  matchKeywordWordsFrom must
            // return the second word as completionWord even though
            // the remaining text after the first word is empty.
            const gMinimal = [
                `<Start> = go $(dest:string) arrived safely -> { dest };`,
            ].join("\n");
            const grammarMinimal = loadGrammarRules("test.grammar", gMinimal);

            it('forward: "go home arrived" — first keyword word consumed to EOI, offers "safely"', () => {
                const result = matchGrammarCompletion(
                    grammarMinimal,
                    "go home arrived",
                    undefined,
                    "forward",
                );
                expectMetadata(result, {
                    completions: ["safely"],
                    matchedPrefixLength: 15,
                    separatorMode: "autoSpacePunctuation",
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                    properties: [],
                });
            });
        });
    },
);
