// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammarCompletion } from "../src/grammarMatcher.js";

describe("Grammar Completion - nested wildcard through rules", () => {
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
        expect(result.properties).toBeDefined();
        expect(result.properties!.length).toBeGreaterThan(0);
    });

    it('should return completionProperty for wildcard after "play "', () => {
        const result = matchGrammarCompletion(grammar, "play ");
        // Same as above but with trailing space
        expect(result.properties).toBeDefined();
        expect(result.properties!.length).toBeGreaterThan(0);
    });

    it('should return "by" as completion after wildcard text', () => {
        const result = matchGrammarCompletion(grammar, "play some song");
        // After the wildcard has captured text, "by" should appear as a
        // completion for the next string part.
        expect(result.completions).toContain("by");
    });
});
