// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachMatcher } from "./testUtils.js";

describeForEachMatcher(
    "Grammar Matcher - Groups and Recursion",
    (testMatchGrammar) => {
        describe("Repeat GroupExpr", () => {
            it("()* - zero matches", () => {
                const g = `<Start> = hello (world)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    true,
                ]);
            });
            it("()* - one match", () => {
                const g = `<Start> = hello (world)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("()* - two matches", () => {
                const g = `<Start> = hello (world)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(
                    testMatchGrammar(grammar, "hello world world"),
                ).toStrictEqual([true]);
            });
            it("()+ - zero matches not accepted", () => {
                const g = `<Start> = hello (world)+ -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([]);
            });
            it("()+ - one match", () => {
                const g = `<Start> = hello (world)+ -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("()+ - two matches", () => {
                const g = `<Start> = hello (world)+ -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(
                    testMatchGrammar(grammar, "hello world world"),
                ).toStrictEqual([true]);
            });
            it("()* - alternates in group", () => {
                const g = `<Start> = hello (world | earth)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(
                    testMatchGrammar(grammar, "hello world earth world"),
                ).toStrictEqual([true]);
            });
            it("()+ - suffix after repeat", () => {
                const g = `<Start> = hello (world)+ end -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(
                    testMatchGrammar(grammar, "hello world world end"),
                ).toStrictEqual([true]);
            });
        });

        describe("Recursive rules", () => {
            // Regression: when a rule has a non-epsilon back-reference to itself,
            // the compiled RulesPart.rules must point to the final populated array,
            // not the empty sentinel assigned before compilation begins.
            // If the sentinel is captured (bug), the recursive match silently fails.
            it("right-recursive rule reference can match multi-token input", () => {
                // <Start> = foo <Start> -> "hit" | bar -> "bar"
                // "foo bar": foo consumes mandatory input, then <Start> matches "bar"
                const g = `
                <Start> = foo <Start> -> "hit"
                        | bar -> "bar";
            `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                    "hit",
                ]);
            });

            it("right-recursive variable rule can match multi-token input", () => {
                // <Start> = foo $(x:<Start>) -> x | bar -> "bar"
                // "foo bar": foo consumes mandatory input, then $(x:<Start>) captures "bar"
                const g = `
                <Start> = foo $(x:<Start>) -> x
                        | bar -> "bar";
            `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                    "bar",
                ]);
            });
        });

        describe("Wildcard leaking into captured nested rule", () => {
            it("wildcard sibling does not prevent default value in following captured rule", () => {
                // Regression: when the wildcard alternative $(wc)->wc in
                // <Genre> is explored, the pending wildcard leaks into
                // <Suffix>.  matchStringPartWithWildcard must assign the
                // default string value for single-part rules (just like the
                // non-wildcard path) to avoid "No value assign to variable".
                const g = `
                    <Start> = $(v0:<Genre>) $(v1:<Suffix>)
                            -> { genre: v0, suffix: v1 };
                    <Genre> = rock -> "rock"
                            | pop -> "pop"
                            | $(wc) -> wc;
                    <Suffix> = tunes;
                `;
                const grammar = loadGrammarRules("test.grammar", g);

                // Literal genre — may match via both literal and wildcard
                // paths; verify at least one result is correct.
                const rockResults = testMatchGrammar(grammar, "rock tunes");
                expect(rockResults).toContainEqual({
                    genre: "rock",
                    suffix: "tunes",
                });

                // Unknown genre — wildcard path, wc captures "metal",
                // then <Suffix> must still produce its default value.
                expect(testMatchGrammar(grammar, "metal tunes")).toStrictEqual([
                    { genre: "metal", suffix: "tunes" },
                ]);
            });

            it("wildcard with preceding literal and trailing captured rule", () => {
                // Same pattern but with a non-captured literal part before
                // the wildcard rule, matching the exportGrammar output shape.
                const g = `
                    <Start> = play $(v0:<Genre>) $(v1:<Suffix>)
                            -> { genre: v0, suffix: v1 };
                    <Genre> = rock -> "rock"
                            | $(wc) -> wc;
                    <Suffix> = tunes;
                `;
                const grammar = loadGrammarRules("test.grammar", g);

                const rockResults = testMatchGrammar(
                    grammar,
                    "play rock tunes",
                );
                expect(rockResults).toContainEqual({
                    genre: "rock",
                    suffix: "tunes",
                });

                expect(
                    testMatchGrammar(grammar, "play metal tunes"),
                ).toStrictEqual([{ genre: "metal", suffix: "tunes" }]);
            });
        });

        describe("Default value for single-part captured sub-rules", () => {
            it("single string part produces default value (non-wildcard path)", () => {
                // <Verb> = play; is captured as $(v:<Verb>) — no wildcard
                // anywhere, so the non-wildcard path in
                // matchStringPartWithoutWildcard must assign the default.
                const g = `
                    <Start> = $(v:<Verb>) -> v;
                    <Verb> = play;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "play")).toStrictEqual([
                    "play",
                ]);
            });

            it("single string part with multiple alternatives (non-wildcard)", () => {
                const g = `
                    <Start> = $(v:<Action>) -> v;
                    <Action> = play | pause | stop;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "play")).toStrictEqual([
                    "play",
                ]);
                expect(testMatchGrammar(grammar, "pause")).toStrictEqual([
                    "pause",
                ]);
                expect(testMatchGrammar(grammar, "stop")).toStrictEqual([
                    "stop",
                ]);
            });

            it("single number part produces default value (non-wildcard path)", () => {
                // <Num> has a single $(n:number) part and no explicit value.
                // The number variable capture provides the rule's value.
                const g = `
                    <Start> = set $(v:<Num>) -> v;
                    <Num> = $(n:number);
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "set 42")).toStrictEqual([42]);
            });

            it("single wildcard part produces default value (no explicit ->)", () => {
                // <Any> has a single $(wc) part and no explicit value.
                // The wildcard variable capture provides the rule's value.
                const g = `
                    <Start> = find $(v:<Any>) -> v;
                    <Any> = $(wc);
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(
                    testMatchGrammar(grammar, "find something"),
                ).toStrictEqual(["something"]);
            });

            it("single number part in captured sub-rule with wildcard sibling", () => {
                // Ensures the wildcard path for number parts also works
                // when a pending wildcard leaks from a sibling rule.
                const g = `
                    <Start> = $(v0:<Label>) $(v1:<Count>)
                            -> { label: v0, count: v1 };
                    <Label> = items -> "items"
                            | $(wc) -> wc;
                    <Count> = $(n:number);
                `;
                const grammar = loadGrammarRules("test.grammar", g);

                // Known label — non-wildcard path
                expect(testMatchGrammar(grammar, "items 5")).toContainEqual({
                    label: "items",
                    count: 5,
                });

                // Unknown label — wildcard leaks into <Count>
                expect(testMatchGrammar(grammar, "widgets 10")).toStrictEqual([
                    { label: "widgets", count: 10 },
                ]);
            });
        });

        describe("Nullable repeat body (must-advance guard)", () => {
            // These grammars have a repeat group whose body can match the
            // empty string.  Without the runtime must-advance guard in
            // grammarMatcher.finalizeNestedRule, the matcher would push an
            // unbounded chain of zero-progress CONTINUE frames and hang.
            // The guard short-circuits any iteration that consumed no
            // input, so these tests must terminate (jest's 90s suite
            // timeout would catch a regression).  Multiple distinct parse
            // trees are expected for ambiguous inputs - we assert
            // termination AND produce a small, exact set of parse trees.
            // Expected parse counts (one `true` per distinct parse):
            //   ((foo)?)*  on ""    -> 2 (zero-iters; one ε-iter)
            //   ((foo)?)*  on "foo" -> 2 (one iter consuming "foo"; one
            //                         iter consuming "foo" + a final
            //                         ε-iter through the optional)
            //   ((foo)?)+  on ""    -> 1 (`+` requires >=1 iteration; only
            //                         the single ε-iter parse remains
            //                         after the must-advance guard)
            //   (<X>)*     on ""    -> 2 (zero-iters; one ε-iter via the
            //                         nullable <X>)
            it("((X)?)* on empty input has exactly 2 parses", () => {
                const g = `<Start> = ((foo)?)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "")).toStrictEqual([
                    true,
                    true,
                ]);
            });
            it("((X)?)* on 'foo' has exactly 2 parses", () => {
                const g = `<Start> = ((foo)?)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "foo")).toStrictEqual([
                    true,
                    true,
                ]);
            });
            it("((X)?)+ on empty input has exactly 1 parse", () => {
                const g = `<Start> = ((foo)?)+ -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "")).toStrictEqual([true]);
            });
            it("(<X>)* with nullable <X> on empty input has exactly 2 parses", () => {
                const g = `
                    <Start> = (<X>)* -> true;
                    <X> = (foo)?;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "")).toStrictEqual([
                    true,
                    true,
                ]);
            });

            // Wildcard interaction: wildcards always advance index >= 1,
            // so the must-advance guard never fires on a non-empty wildcard
            // capture.  But when the wildcard is wrapped in an optional
            // inside the repeat body, the body becomes nullable via the
            // skipped-optional path, and the guard MUST fire to prevent
            // an infinite chain of zero-progress iterations.
            it("(($(w))?)* on empty input terminates", () => {
                const g = `<Start> = (($(w))?)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                // Body is fully nullable via the skipped optional.
                // Must-advance guard short-circuits after the single
                // ε-iteration: zero-iters + one ε-iter = 2 parses.
                expect(testMatchGrammar(grammar, "")).toStrictEqual([
                    true,
                    true,
                ]);
            });
            it("(($(w))?)* on non-empty input terminates", () => {
                const g = `<Start> = (($(w))?)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                // The wildcard can absorb the entire input in one
                // iteration; the optional can also be skipped (body=ε).
                // Must terminate with at least one parse (the wildcard
                // capture); exact count depends on wildcard-length axis
                // enumeration but must be finite and non-empty.
                const results = testMatchGrammar(grammar, "hello");
                expect(results.length).toBeGreaterThan(0);
                expect(results.every((r) => r === true)).toBe(true);
            });
            it("((foo)? ($(w))?)* with two nullable parts terminates", () => {
                // Body is two optional parts in sequence - fully nullable.
                // Stresses the guard against multiple ε-paths through the
                // body (skip both, skip first, skip second).
                const g = `<Start> = ((foo)? ($(w))?)* -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                const results = testMatchGrammar(grammar, "");
                expect(results.length).toBeGreaterThan(0);
                expect(results.every((r) => r === true)).toBe(true);
            });
        });
    },
);
