// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import {
    createTestCompletion,
    describeForEachCompletion,
    expectMetadata,
    type CompletionVariant,
} from "./testUtils.js";

const terminalWildcardGrammar = loadGrammarRules(
    "test.grammar",
    `<Start> = play $(trackName:wildcard) -> { actionName: "playTrack", parameters: { trackName } };`,
);

describe.each<CompletionVariant>(["grammar", "nfa", "dfa"])(
    "Terminal wildcard partial propagation [%s]",
    (variant) => {
        it("preserves the full multiword partial value", () => {
            const result = createTestCompletion(variant)(
                terminalWildcardGrammar,
                "play Bohemian Rhap",
            );

            expect(result.properties).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        propertyNames: ["parameters.trackName"],
                        partialValue: "Bohemian Rhap",
                    }),
                ]),
            );
        });
    },
);

it("NFA carries a nested wildcard's full partial to its outer property", () => {
    const nestedTerminalGrammar = loadGrammarRules(
        "test.grammar",
        [
            `<Start> = play $(trackName:<TrackName>) -> { actionName: "playTrack", parameters: { trackName } };`,
            `<TrackName> = $(x:wildcard);`,
        ].join("\n"),
    );

    const result = createTestCompletion("nfa")(
        nestedTerminalGrammar,
        "play Bohemian Rhap",
    );

    expect(result.properties).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                propertyNames: ["parameters.trackName"],
                partialValue: "Bohemian Rhap",
            }),
        ]),
    );
});

it("NFA preserves earlier multiword slots while completing a later slot", () => {
    const grammar = loadGrammarRules(
        "test.grammar",
        `<Start> = play $(trackName:wildcard) by $(artist:wildcard) -> { actionName: "playTrack", parameters: { trackName, artist } };`,
    );

    const result = createTestCompletion("nfa")(
        grammar,
        "play Bohemian Rhapsody by Que",
        undefined,
        "backward",
    );
    const artist = result.properties?.find((property) =>
        property.propertyNames.includes("parameters.artist"),
    );

    expect(artist).toEqual(
        expect.objectContaining({
            match: expect.objectContaining({
                parameters: expect.objectContaining({
                    trackName: "Bohemian Rhapsody",
                }),
            }),
            partialValue: "Que",
        }),
    );
});

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

        it("propagates the full multiword partial for a terminal wildcard", () => {
            const result = matchGrammarCompletion(
                terminalWildcardGrammar,
                "play Bohemian Rhap",
            );

            expectMetadata(result, {
                properties: [
                    {
                        match: {
                            actionName: "playTrack",
                            parameters: { trackName: undefined },
                        },
                        propertyNames: ["parameters.trackName"],
                        partialValue: "Bohemian Rhap",
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
