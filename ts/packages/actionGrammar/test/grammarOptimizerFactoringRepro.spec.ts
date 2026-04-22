// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Targeted reproduction tests for factoring edge cases that previously
 * broke the player grammar.  Keep these as regression tests.
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";

function match(grammar: ReturnType<typeof loadGrammarRules>, s: string) {
    return matchGrammar(grammar, s).map((m) => m.match);
}

describe("Grammar Optimizer - Factoring Repro", () => {
    it("handles alternatives that re-use the same variable name", () => {
        const text = `<Start> = <Play>;
<Play> = play $(trackName:string) -> { kind: "solo", trackName }
       | play $(trackName:string) by $(artist:string) -> { kind: "duet", trackName, artist };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play Hello",
            "play Shake It Off by Taylor Swift",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("handles a group that is fully consumed by the shared prefix", () => {
        const text = `<Start> = <X>;
<X> = play -> "just"
    | play the song -> "song"
    | play the track -> "track";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play", "play the song", "play the track"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("handles mixed explicit / default value alternatives", () => {
        const text = `<Start> = <X>;
<X> = play the song
    | play the track -> "custom";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play the song", "play the track"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("handles shared literal prefix with distinct wrapped RulesParts (player-like)", () => {
        const text = `<Start> = <PlaySpecificTrack>;
<TrackPhrase> = $(trackName:string) -> trackName
              | the $(trackName:string) -> trackName;
<PlaySpecificTrack> = play $(trackName:<TrackPhrase>) by $(artist:string) -> { kind: "byArtist", trackName, artist }
                    | play $(trackName:<TrackPhrase>) from album $(albumName:string) -> { kind: "fromAlbum", trackName, albumName };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play hello by taylor",
            "play the hello by taylor",
            "play hello from album unity",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // Regression for the failure surfaced by the optimizer benchmark
    // against the player grammar:
    //
    //     "Internal error: No value for variable 'trackName'.
    //      Values: {"name":"artist","valueId":4}"
    //
    // Object shorthand `{ trackName }` compiles to a property element
    // with `value: null` (key = "trackName", expanded at evaluation
    // time to `trackName: trackName`).  Variable-renaming during
    // factoring must (a) detect that the key is a variable reference
    // and (b) rewrite it without changing the object field name.
    it("rewrites object shorthand keys when remapping variables", () => {
        const text = `<Start> = <X>;
<X> = greet $(name:string) -> { name }
    | greet $(other:string) twice -> { other };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["greet alice", "greet bob twice"]) {
            // No "Internal error" thrown, and matches identical.
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });
});
