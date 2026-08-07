// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachCompletion, expectMetadata } from "./testUtils.js";

describeForEachCompletion(
    "Grammar Completion - nested wildcard through rules",
    (matchGrammarCompletion) => {
        // Reproduces the bug where completing "play" returns "by" instead of
        // a completionProperty for the wildcard <TrackName>.
        //
        // Grammar:
        //   <Start> = play $(trackName:<TrackPhrase>) by $(artist:<ArtistName>)
        //             -> { actionName: "playTrack", parameters: { trackName, artists: [artist] } }
        //   <TrackPhrase> = $(trackName:<TrackName>) -> trackName
        //   <TrackName> = $(x:wildcard)
        //   <ArtistName> = $(x:wildcard)
        const g = [
            `<Start> = play $(trackName:<TrackPhrase>) by $(artist:<ArtistName>) -> { actionName: "playTrack", parameters: { trackName, artists: [artist] } };`,
            `<TrackPhrase> = $(trackName:<TrackName>) -> trackName;`,
            `<TrackName> = $(x:wildcard);`,
            `<ArtistName> = $(x:wildcard);`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it('should return completionProperty for wildcard after "play"', () => {
            const result = matchGrammarCompletion(grammar, "play");
            // After matching "play", the next part is $(trackName:<TrackPhrase>)
            // which ultimately resolves to a wildcard. The completion should
            // include a property for that wildcard, not just "by".
            expectMetadata(result, {
                properties: [
                    {
                        match: {
                            actionName: "playTrack",
                            parameters: {
                                trackName: undefined,
                                artists: [undefined],
                            },
                        },
                        propertyNames: ["parameters.trackName"],
                    },
                ],
            });
        });

        it('should return completionProperty for wildcard after "play "', () => {
            const result = matchGrammarCompletion(grammar, "play ");
            // Same as above but with trailing space
            expectMetadata(result, {
                properties: [
                    {
                        match: {
                            actionName: "playTrack",
                            parameters: {
                                trackName: undefined,
                                artists: [undefined],
                            },
                        },
                        propertyNames: ["parameters.trackName"],
                    },
                ],
            });
        });

        it('should return "by" as completion after wildcard text', () => {
            const result = matchGrammarCompletion(grammar, "play some song");
            // After the wildcard has captured text, "by" should appear as a
            // completion for the next string part.
            expectMetadata(result, { completions: ["by"] });
        });

        it('forward: partial keyword "b" anchors at partial position, not end-of-input', () => {
            // "play This Train b" — the wildcard absorbs "This Train b"
            // via finalizeState.  The trailing "b" is a partial prefix
            // of the next keyword "by".  Forward completion should anchor
            // at position 16 (start of "b") so the UI can filter "by"
            // against the typed "b", rather than position 17 (end-of-input)
            // with separatorMode "spacePunctuation" which hides the menu.
            const result = matchGrammarCompletion(grammar, "play This Train b");
            expectMetadata(result, {
                completions: ["by"],
                matchedPrefixLength: 15,
                separatorMode: "autoSpacePunctuation",
                afterWildcard: "all",
            });
        });

        it('forward: partial keyword "b" works with single-word wildcard', () => {
            const result = matchGrammarCompletion(grammar, "play Nevermind b");
            expectMetadata(result, {
                completions: ["by"],
                matchedPrefixLength: 14,
                separatorMode: "autoSpacePunctuation",
                afterWildcard: "all",
            });
        });

        it("forward: no partial keyword — offers by at end-of-input", () => {
            // "play some song" — no trailing partial keyword.
            // "by" is offered at end-of-input (position 14).
            const result = matchGrammarCompletion(grammar, "play some song");
            expectMetadata(result, { completions: ["by"] });
        });
    },
);
