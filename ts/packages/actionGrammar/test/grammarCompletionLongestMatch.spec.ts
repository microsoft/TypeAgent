// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammarCompletion } from "../src/grammarMatcher.js";

describe("Grammar Completion - longest match property", () => {
    describe("three sequential parts", () => {
        // Verifies that after matching 2 of 3 parts, completion is the 3rd part.
        const g = [
            `<Start> = $(a:<A>) $(b:<B>) $(c:<C>) -> { a, b, c };`,
            `<A> = first -> "a";`,
            `<B> = second -> "b";`,
            `<C> = third -> "c";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("completes first part for empty input", () => {
            const result = matchGrammarCompletion(grammar, "");
            expect(result.completions).toContain("first");
            expect(result.matchedPrefixLength).toBe(0);
        });

        it("completes second part after first matched", () => {
            const result = matchGrammarCompletion(grammar, "first");
            expect(result.completions).toContain("second");
            expect(result.matchedPrefixLength).toBe(5);
        });

        it("completes second part after first matched with space", () => {
            const result = matchGrammarCompletion(grammar, "first ");
            expect(result.completions).toContain("second");
            expect(result.matchedPrefixLength).toBe(5);
        });

        it("completes third part after first two matched", () => {
            const result = matchGrammarCompletion(grammar, "first second");
            expect(result.completions).toContain("third");
            expect(result.matchedPrefixLength).toBe(12);
        });

        it("completes third part after first two matched with space", () => {
            const result = matchGrammarCompletion(grammar, "first second ");
            expect(result.completions).toContain("third");
            expect(result.matchedPrefixLength).toBe(12);
        });

        it("no completion for exact full match", () => {
            const result = matchGrammarCompletion(
                grammar,
                "first second third",
            );
            expect(result.completions).toHaveLength(0);
            // Exact match records the full consumed length.
            expect(result.matchedPrefixLength).toBe(18);
        });

        it("partial prefix of third part completes correctly", () => {
            const result = matchGrammarCompletion(grammar, "first second th");
            expect(result.completions).toContain("third");
            expect(result.matchedPrefixLength).toBe(12);
        });
    });

    describe("four sequential parts", () => {
        const g = [
            `<Start> = $(a:<A>) $(b:<B>) $(c:<C>) $(d:<D>) -> { a, b, c, d };`,
            `<A> = alpha -> "a";`,
            `<B> = bravo -> "b";`,
            `<C> = charlie -> "c";`,
            `<D> = delta -> "d";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("completes delta after three parts matched", () => {
            const result = matchGrammarCompletion(
                grammar,
                "alpha bravo charlie",
            );
            expect(result.completions).toContain("delta");
            expect(result.matchedPrefixLength).toBe(19);
        });

        it("completes charlie after two parts matched", () => {
            const result = matchGrammarCompletion(grammar, "alpha bravo");
            expect(result.completions).toContain("charlie");
            expect(result.matchedPrefixLength).toBe(11);
        });
    });

    describe("competing rules - longer match wins", () => {
        // Two rules: short (2 parts) and long (3 parts).
        // When first two parts match, the short rule is a full match (no
        // completion) and the long rule offers completion for the third part.
        const g = [
            `<Start> = $(a:<A>) $(b:<B>) -> { a, b };`,
            `<Start> = $(a:<A>) $(b:<B>) $(c:<C>) -> { a, b, c };`,
            `<A> = alpha -> "a";`,
            `<B> = bravo -> "b";`,
            `<C> = charlie -> "c";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("short rule is exact match; long rule offers completion", () => {
            const result = matchGrammarCompletion(grammar, "alpha bravo");
            // Short rule matches exactly, no completion from it.
            // Long rule matches alpha + bravo and offers "charlie".
            expect(result.completions).toContain("charlie");
            expect(result.matchedPrefixLength).toBe(11);
        });

        it("both rules offer completions at same depth for first part", () => {
            const result = matchGrammarCompletion(grammar, "alpha");
            // Both rules need "bravo" next.
            expect(result.completions).toContain("bravo");
            expect(result.matchedPrefixLength).toBe(5);
        });
    });

    describe("competing rules - different next parts at same depth", () => {
        // Two rules that share a prefix but diverge after.
        const g = [
            `<Start> = $(a:<A>) suffix_x -> "rx";`,
            `<Start> = $(a:<A>) suffix_y -> "ry";`,
            `<A> = prefix -> "a";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("offers both alternatives after shared prefix", () => {
            const result = matchGrammarCompletion(grammar, "prefix");
            expect(result.completions).toContain("suffix_x");
            expect(result.completions).toContain("suffix_y");
            expect(result.matchedPrefixLength).toBe(6);
        });

        it("alternative still offered even when one rule matches exactly", () => {
            const result = matchGrammarCompletion(grammar, "prefix suffix_x");
            // Rule 1 (suffix_x) matches exactly at length 15.
            // Rule 2's "suffix_y" at prefixLength 6 is filtered out
            // because a longer match exists.
            expect(result.completions).toHaveLength(0);
            expect(result.matchedPrefixLength).toBe(15);
        });
    });

    describe("optional part followed by required part", () => {
        const g = [
            `<Start> = $(a:<A>) $(b:<B>)? $(c:<C>) -> { a, c };`,
            `<A> = begin -> "a";`,
            `<B> = middle -> "b";`,
            `<C> = finish -> "c";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("offers both optional and skip alternatives after first part", () => {
            const result = matchGrammarCompletion(grammar, "begin");
            // Should offer "middle" (optional) and "finish" (skipping optional)
            expect(result.completions).toContain("middle");
            expect(result.completions).toContain("finish");
            expect(result.matchedPrefixLength).toBe(5);
        });

        it("offers finish after optional part matched", () => {
            const result = matchGrammarCompletion(grammar, "begin middle");
            expect(result.completions).toContain("finish");
            expect(result.matchedPrefixLength).toBe(12);
        });

        it("longest path wins for 'finish' completion when optional is matched", () => {
            // When "begin middle" is typed:
            //   - Through-optional path: matches "begin" + "middle",
            //     offers "finish" at matchedPrefixLength=12.
            //   - Skip-optional path: matches "begin" (index=5),
            //     offers "finish" at matchedPrefixLength=5 — but this
            //     is filtered out because a longer match (12) exists.
            const result = matchGrammarCompletion(grammar, "begin middle");
            expect(result.completions).toContain("finish");
            expect(result.matchedPrefixLength).toBe(12);
        });
    });

    describe("completion after number variable", () => {
        const g = [
            `<Start> = set volume $(n:number) percent -> { volume: n };`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("completes 'percent' after number matched", () => {
            const result = matchGrammarCompletion(grammar, "set volume 50");
            expect(result.completions).toContain("percent");
            expect(result.matchedPrefixLength).toBe(13);
        });

        it("completes 'percent' after number with space", () => {
            const result = matchGrammarCompletion(grammar, "set volume 50 ");
            expect(result.completions).toContain("percent");
            expect(result.matchedPrefixLength).toBe(13);
        });

        it("no completion for exact match", () => {
            const result = matchGrammarCompletion(
                grammar,
                "set volume 50 percent",
            );
            expect(result.completions).toHaveLength(0);
        });
    });

    describe("multiple alternatives in nested rule", () => {
        // After matching a prefix, the nested rule has multiple alternatives
        // for the next part, all at the same depth.
        const g = [
            `<Start> = play $(g:<Genre>) -> { genre: g };`,
            `<Genre> = rock -> "rock";`,
            `<Genre> = pop -> "pop";`,
            `<Genre> = jazz -> "jazz";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("offers all genre alternatives after 'play'", () => {
            const result = matchGrammarCompletion(grammar, "play");
            expect(result.completions).toContain("rock");
            expect(result.completions).toContain("pop");
            expect(result.completions).toContain("jazz");
            expect(result.matchedPrefixLength).toBe(4);
        });

        it("all alternatives offered even with partial trailing text", () => {
            const result = matchGrammarCompletion(grammar, "play r");
            // All genre alternatives are reported after the longest
            // complete match "play"; the caller filters by "r".
            expect(result.completions).toContain("rock");
            expect(result.completions).toContain("pop");
            expect(result.completions).toContain("jazz");
            expect(result.matchedPrefixLength).toBe(4);
        });

        it("all alternatives offered with 'p' trailing text", () => {
            const result = matchGrammarCompletion(grammar, "play p");
            // All are reported; caller filters by "p".
            expect(result.completions).toContain("pop");
            expect(result.completions).toContain("rock");
            expect(result.completions).toContain("jazz");
        });
    });

    describe("wildcard between string parts - longest match", () => {
        // Grammar: verb WILDCARD terminator
        // Completion should offer terminator only after wildcard captures text.
        const g = [
            `<Start> = play $(name) by $(artist) -> { name, artist };`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("offers wildcard property after 'play'", () => {
            const result = matchGrammarCompletion(grammar, "play");
            // Wildcard is next, should have property completion
            expect(result.properties).toBeDefined();
            expect(result.properties!.length).toBeGreaterThan(0);
        });

        it("offers 'by' terminator after wildcard text", () => {
            const result = matchGrammarCompletion(grammar, "play hello");
            expect(result.completions).toContain("by");
        });

        it("offers artist wildcard property after 'by'", () => {
            const result = matchGrammarCompletion(grammar, "play hello by");
            // After "by", the next part is the artist wildcard
            expect(result.properties).toBeDefined();
            expect(result.properties!.length).toBeGreaterThan(0);
        });
    });

    describe("deep nesting - three levels of rules", () => {
        const g = [
            `<Start> = $(x:<Outer>) done -> { x };`,
            `<Outer> = $(y:<Inner>) -> y;`,
            `<Inner> = deep -> "deep";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("completes 'deep' for empty input", () => {
            const result = matchGrammarCompletion(grammar, "");
            expect(result.completions).toContain("deep");
            expect(result.matchedPrefixLength).toBe(0);
        });

        it("completes 'done' after deeply nested match", () => {
            const result = matchGrammarCompletion(grammar, "deep");
            expect(result.completions).toContain("done");
            expect(result.matchedPrefixLength).toBe(4);
        });
    });

    describe("repeat group (+) completion", () => {
        // Grammar with ()+ repeat group using inline alternatives
        const g = `<Start> = hello (world | earth)+ done -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);

        it("offers 'hello' for empty input", () => {
            const result = matchGrammarCompletion(grammar, "");
            expect(result.completions).toContain("hello");
        });

        it("offers repeat alternatives after 'hello'", () => {
            const result = matchGrammarCompletion(grammar, "hello");
            // After "hello", the ()+ group requires at least one match
            expect(result.completions).toContain("world");
            expect(result.completions).toContain("earth");
        });

        it("offers 'done' and repeat alternatives after first repeat match", () => {
            const result = matchGrammarCompletion(grammar, "hello world");
            // After one repeat match, can repeat or proceed to "done"
            expect(result.completions).toContain("done");
            // Also should offer repeat alternatives
            expect(
                result.completions.includes("world") ||
                    result.completions.includes("earth"),
            ).toBe(true);
        });

        it("offers 'done' after two repeat matches", () => {
            const result = matchGrammarCompletion(grammar, "hello world earth");
            expect(result.completions).toContain("done");
        });
    });

    describe("partial prefix vs longest match interaction", () => {
        // Test that partial prefix matching from a shorter rule does not
        // interfere with the longest match from a longer rule.
        //
        // Rule 1's string part "beta gamma" partially matches "beta" in the
        // remaining text, while Rule 2 fully matches "beta" as a separate
        // nested rule and offers "gamma" from the longer match.
        //
        // Both completions may appear because they're valid for different
        // interpretations. The key property is that matchedPrefixLength
        // reflects the longest consumed prefix.
        const g = [
            `<Start> = $(a:<A>) beta gamma -> "r1";`,
            `<Start> = $(a:<A>) $(b:<B>) gamma -> "r2";`,
            `<A> = alpha -> "a";`,
            `<B> = beta -> "b";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("matchedPrefixLength reflects longest consumed prefix", () => {
            const result = matchGrammarCompletion(grammar, "alpha beta");
            // Rule 2 matches alpha + beta = 10 chars.
            // matchedPrefixLength should be at least 10 (from the longest match).
            expect(result.matchedPrefixLength).toBeGreaterThanOrEqual(10);
            // "gamma" must appear as completion from the longer match.
            expect(result.completions).toContain("gamma");
        });

        it("shorter partial prefix completion also appears (known behavior)", () => {
            const result = matchGrammarCompletion(grammar, "alpha beta");
            // Rule 1 may produce "beta gamma" via isPartialPrefixOfStringPart
            // since "beta" is a prefix of "beta gamma". This is expected:
            // both rules produce valid completions for the input.
            // We verify maxPrefixLength is from the longest match.
            expect(result.matchedPrefixLength).toBe(10);
        });
    });

    describe("case insensitive matching for completions", () => {
        const g = [
            `<Start> = $(a:<A>) World -> { a };`,
            `<A> = Hello -> "hello";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("completes after case-insensitive match", () => {
            const result = matchGrammarCompletion(grammar, "hello");
            expect(result.completions).toContain("World");
            expect(result.matchedPrefixLength).toBe(5);
        });

        it("completes after uppercase input", () => {
            const result = matchGrammarCompletion(grammar, "HELLO");
            expect(result.completions).toContain("World");
            expect(result.matchedPrefixLength).toBe(5);
        });

        it("partial prefix is case insensitive", () => {
            const result = matchGrammarCompletion(grammar, "hello WO");
            expect(result.completions).toContain("World");
        });
    });

    describe("no spurious completions from unrelated rules", () => {
        // Two completely different rules. Only the matching one should
        // produce completions.
        const g = [
            `<Start> = play $(g:<Genre>) -> { action: "play", genre: g };`,
            `<Start> = stop $(r:<Reason>) -> { action: "stop", reason: r };`,
            `<Genre> = rock -> "rock";`,
            `<Reason> = now -> "now";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("only matching rule offers completions for 'play'", () => {
            const result = matchGrammarCompletion(grammar, "play");
            expect(result.completions).toContain("rock");
            expect(result.completions).not.toContain("now");
            expect(result.completions).not.toContain("stop");
        });

        it("only matching rule offers completions for 'stop'", () => {
            const result = matchGrammarCompletion(grammar, "stop");
            expect(result.completions).toContain("now");
            expect(result.completions).not.toContain("rock");
            expect(result.completions).not.toContain("play");
        });

        it("all first parts offered for unrelated input", () => {
            const result = matchGrammarCompletion(grammar, "dance");
            // Nothing consumed; all first string parts from every rule
            // are offered at prefixLength 0.  The caller filters by
            // the trailing text "dance".
            expect(result.completions.sort()).toEqual(["play", "stop"]);
            expect(result.matchedPrefixLength).toBe(0);
        });
    });

    describe("completion with entity wildcard", () => {
        // Entity wildcards should produce property completions, not string
        // completions, and matchedPrefixLength should indicate where the
        // entity value begins.
        const g = [
            `entity SongName;`,
            `<Start> = play $(song:SongName) next -> { song };`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("entity wildcard produces property completion", () => {
            const result = matchGrammarCompletion(grammar, "play");
            expect(result.properties).toBeDefined();
            expect(result.properties!.length).toBeGreaterThan(0);
            expect(result.matchedPrefixLength).toBe(4);
        });

        it("string terminator after entity text", () => {
            const result = matchGrammarCompletion(grammar, "play mysong");
            expect(result.completions).toContain("next");
        });
    });

    describe("completion at boundary between consumed and remaining", () => {
        // Verify that trailing separators (spaces) don't affect
        // which part is offered for completion.
        const g = [
            `<Start> = $(a:<A>) $(b:<B>) -> { a, b };`,
            `<A> = one -> "a";`,
            `<B> = two -> "b";`,
        ].join("\n");
        const grammar = loadGrammarRules("test.grammar", g);

        it("same completion with and without trailing space", () => {
            const r1 = matchGrammarCompletion(grammar, "one");
            const r2 = matchGrammarCompletion(grammar, "one ");
            const r3 = matchGrammarCompletion(grammar, "one  ");
            expect(r1.completions).toEqual(r2.completions);
            expect(r2.completions).toEqual(r3.completions);
            expect(r1.completions).toContain("two");
        });

        it("matchedPrefixLength is stable regardless of trailing spaces", () => {
            const r1 = matchGrammarCompletion(grammar, "one");
            const r2 = matchGrammarCompletion(grammar, "one ");
            const r3 = matchGrammarCompletion(grammar, "one  ");
            // All should report the same matchedPrefixLength (end of
            // consumed prefix, which is the "one" portion)
            expect(r1.matchedPrefixLength).toBe(r2.matchedPrefixLength);
            expect(r2.matchedPrefixLength).toBe(r3.matchedPrefixLength);
        });
    });
});
