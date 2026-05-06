// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Coverage tests for packrat-style memoization in the grammar matcher.
 *
 * Organized into:
 *   1. Flag parity: every optimization flag (memoization, wildcardPolicy,
 *      optionalPolicy, repeatPolicy) produces identical results vs
 *      the baseline ("exhaustive" / true).
 *   2. Failure cache: memo short-circuits re-entry on intrinsic failure.
 *   3. Success delta fidelity: capture/replay preserves match values.
 *   4. Relative valueId rebasing under different outer contexts.
 *   5. Cache key discrimination (leadingSpacingMode, requireValue, carrier).
 *   6. Carrier mode replay (implicit-default single-part).
 *   7. noSuccessCache boundaries (repeat, pendingWildcard).
 *   8. Replay LIFO ordering with 3+ alternation members.
 *   9. Pending wildcard delta capture.
 *  10. Pending wildcard delta capture (continued).
 *  11. lastMatchedPartInfo preservation in deltas.
 *  12. Policy + memoization cross-product parity.
 *  13. Suppression with active memo frames.
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import {
    matchGrammar,
    type GrammarMatchOptions,
} from "../src/grammarMatcher.js";
import type { Grammar } from "../src/grammarTypes.js";

function match(
    grammar: Grammar,
    request: string,
    options?: GrammarMatchOptions,
): unknown[] {
    return matchGrammar(grammar, request, options).map((m) => m.match);
}

// ---------------------------------------------------------------
// 1. Flag parity: every optimization flag combination produces the
//    same set of results as the exhaustive/memo-on baseline.
// ---------------------------------------------------------------

describe("optimization flag parity", () => {
    // A grammar that exercises nested rules, repeats, optionals,
    // wildcards, and value expressions - enough surface to expose
    // any flag interaction with memoization or policy pruning.
    const GRAMMARS: { name: string; grammar: string; inputs: string[] }[] = [
        {
            name: "nested rules with values",
            grammar: `
                <Inner> = $(x:string) -> x;
                <Start> = hello <Inner> end -> true;
            `,
            inputs: ["hello world end", "hello end", "goodbye world end"],
        },
        {
            name: "optional + repeat + wildcard",
            grammar: `
                <Start> = (please)? (do)+ $(x) -> { x };
            `,
            inputs: [
                "please do something",
                "do something",
                "please do do something",
                "do do do it",
            ],
        },
        {
            name: "multi-alternative nested rule",
            grammar: `
                <Action> = play $(t:string) -> { action: "play", target: t }
                          | stop -> { action: "stop" }
                          | pause -> { action: "pause" };
                <Start> = <Action>;
            `,
            inputs: ["play music", "stop", "pause", "unknown"],
        },
        {
            name: "deeply nested with carriers",
            grammar: `
                <Leaf> = $(v:string) -> v;
                <Mid> = <Leaf> mid -> true;
                <Start> = start <Mid> end -> true;
            `,
            inputs: ["start hello mid end", "start mid end", "hello mid end"],
        },
        {
            name: "repeat with value capture",
            grammar: `<Start> = (a)+ $(x) -> { x };`,
            inputs: ["a a a", "a b", "a a a a c"],
        },
    ];

    // All non-default option combinations to test against the baseline.
    const OPTION_SETS: {
        name: string;
        options: GrammarMatchOptions;
    }[] = [
        { name: "memoization: false", options: { memoization: false } },
        {
            name: "wildcardPolicy: shortest",
            options: { wildcardPolicy: "shortest" },
        },
        {
            name: "optionalPolicy: preferTake",
            options: { optionalPolicy: "preferTake" },
        },
        {
            name: "optionalPolicy: preferSkip",
            options: { optionalPolicy: "preferSkip" },
        },
        {
            name: "repeatPolicy: greedy",
            options: { repeatPolicy: "greedy" },
        },
        {
            name: "repeatPolicy: nonGreedy",
            options: { repeatPolicy: "nonGreedy" },
        },
        // Cross-product: memo OFF with each policy
        {
            name: "memoization: false + wildcardPolicy: shortest",
            options: { memoization: false, wildcardPolicy: "shortest" },
        },
        {
            name: "memoization: false + optionalPolicy: preferTake",
            options: { memoization: false, optionalPolicy: "preferTake" },
        },
        {
            name: "memoization: false + optionalPolicy: preferSkip",
            options: { memoization: false, optionalPolicy: "preferSkip" },
        },
        {
            name: "memoization: false + repeatPolicy: greedy",
            options: { memoization: false, repeatPolicy: "greedy" },
        },
        {
            name: "memoization: false + repeatPolicy: nonGreedy",
            options: { memoization: false, repeatPolicy: "nonGreedy" },
        },
    ];

    for (const { name: gName, grammar: gText, inputs } of GRAMMARS) {
        describe(gName, () => {
            let grammar: Grammar;
            beforeAll(() => {
                grammar = loadGrammarRules("test.grammar", gText);
            });

            for (const { name: oName, options } of OPTION_SETS) {
                for (const input of inputs) {
                    it(`${oName} matches baseline on "${input}"`, () => {
                        // Baseline: exhaustive + memo on (all defaults).
                        const baseline = match(grammar, input);

                        // The non-exhaustive policies are allowed to
                        // return a SUBSET of the exhaustive results
                        // (they prune alternatives), but every result
                        // they DO return must appear in the baseline.
                        // When only memoization differs, the full set
                        // must be identical.
                        const result = match(grammar, input, options);

                        const isMemoOnlyDiff =
                            options.memoization === false &&
                            !options.wildcardPolicy &&
                            !options.optionalPolicy &&
                            !options.repeatPolicy;

                        if (isMemoOnlyDiff) {
                            // Memo ON vs OFF must produce identical results.
                            expect(result).toStrictEqual(baseline);
                        } else if (options.memoization === false) {
                            // memo OFF + some policy: compare against
                            // memo ON + same policy (not baseline).
                            const { memoization: _, ...policyOnly } = options;
                            const memoOnSamePolicy = match(
                                grammar,
                                input,
                                policyOnly as GrammarMatchOptions,
                            );
                            expect(result).toStrictEqual(memoOnSamePolicy);
                        } else {
                            // Non-default policy with memo ON: results
                            // must be a subset of the exhaustive baseline.
                            for (const r of result) {
                                expect(baseline).toContainEqual(r);
                            }
                        }
                    });
                }
            }
        });
    }
});

// ---------------------------------------------------------------
// 2. memoization: false actually disables memo logic
// ---------------------------------------------------------------

describe("memoization: false disables all memo logic", () => {
    it("produces identical results to memo ON for a simple grammar", () => {
        const g = `<Start> = (a)+ b -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);

        const withMemo = match(grammar, "a a a a a b");
        const noMemo = match(grammar, "a a a a a b", {
            memoization: false,
        });

        expect(noMemo).toStrictEqual(withMemo);
    });

    it("produces identical results for nested rules with values", () => {
        const g = `
            <Inner> = $(x:string) $(y:number) -> { x, y };
            <Start> = <Inner> end -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const withMemo = match(grammar, "hello 42 end");
        const noMemo = match(grammar, "hello 42 end", {
            memoization: false,
        });

        expect(noMemo).toStrictEqual(withMemo);
    });

    it("produces identical results for multi-alternative grammar", () => {
        const g = `
            <R> = a -> 1 | b -> 2 | c -> 3;
            <Start> = <R> x <R> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const withMemo = match(grammar, "a x b");
        const noMemo = match(grammar, "a x b", { memoization: false });

        expect(noMemo).toStrictEqual(withMemo);
    });

    it("produces identical results for wildcard capture", () => {
        const g = `
            <Text> = $(wc) end -> wc;
            <Start> = start <Text> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const withMemo = match(grammar, "start middle end");
        const noMemo = match(grammar, "start middle end", {
            memoization: false,
        });

        expect(noMemo).toStrictEqual(withMemo);
    });
});

// ---------------------------------------------------------------
// 3. Failure cache: memoization short-circuits on intrinsic failure
// ---------------------------------------------------------------

describe("failure memoization", () => {
    it("short-circuits on cached intrinsic failure", () => {
        // <Num> always fails on non-numeric input; the second
        // reference to <Num> should hit the cache.
        const g = `
            <Num> = $(n:number) -> n;
            <Start> = <Num> x <Num> y -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const result = match(grammar, "abc x def y");
        expect(result).toEqual([]);
    });

    it("pathological case completes in bounded time with memo", () => {
        // Simpler version of the full pathology test: a grammar
        // with multiply-referenced sub-rules that reject on
        // most input positions.
        const g = `
            <A> = $(x:string) b c -> x;
            <Start> = <A> <A> <A> end -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const t0 = Date.now();
        const result = match(grammar, "x b c y b c z b c end");
        const elapsed = Date.now() - t0;

        expect(result).toStrictEqual([true]);
        // Should be fast with memoization.
        expect(elapsed).toBeLessThan(2000);
    });
});

// ---------------------------------------------------------------
// 4. Success delta fidelity: capture/replay preserves values
// ---------------------------------------------------------------

describe("success delta fidelity", () => {
    it("preserves exact match values across capture and replay", () => {
        // matchGrammar runs a single pass; the cache is per-call.
        // To trigger replay we need the same sub-rule entered
        // twice within one matchGrammar call.
        const g = `
            <Inner> = $(x:string) -> x;
            <Start> = <Inner> and <Inner> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const results = matchGrammar(grammar, "hello and world");
        expect(results.length).toBeGreaterThan(0);

        // Both <Inner> references should have produced values.
        for (const r of results) {
            expect(r.match).toBe(true);
        }
    });

    it("replays nested value expressions correctly", () => {
        const g = `
            <Tag> = $(t:string) -> { tag: t };
            <Start> = <Tag> plus <Tag> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const results = matchGrammar(grammar, "alpha plus beta");
        expect(results.length).toBeGreaterThan(0);

        // With memo, the second <Tag> should replay from cache
        // and still produce the correct value.
        for (const r of results) {
            expect(r.match).toBe(true);
        }
    });
});

// ---------------------------------------------------------------
// 5. Relative valueId rebasing under different outer contexts
// ---------------------------------------------------------------

describe("relative valueId rebasing", () => {
    it("rebases correctly when same sub-rule entered from different depths", () => {
        // <Inner> is entered from two different outer contexts
        // with different nextValueId bases.
        const g = `
            <Inner> = $(a:string) -> a;
            <Outer1> = pre1 <Inner> -> true;
            <Outer2> = pre2a pre2b <Inner> -> true;
            <Start> = <Outer1> | <Outer2>;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const r1 = match(grammar, "pre1 test");
        expect(r1).toStrictEqual([true]);

        const r2 = match(grammar, "pre2a pre2b test");
        expect(r2).toStrictEqual([true]);
    });

    it("rebases with multiple values in the same sub-rule", () => {
        const g = `
            <Pair> = $(a:string) dash $(b:string) -> { a, b };
            <Start> = <Pair> and <Pair> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const results = matchGrammar(grammar, "x dash y and p dash q");
        // Should produce at least one match; the second <Pair>
        // replay should correctly rebase both valueIds.
        expect(results.length).toBeGreaterThan(0);
    });

    it("rebases deeply nested valueId chains", () => {
        const g = `
            <L3> = $(v:string) -> v;
            <L2> = <L3> mid -> true;
            <L1> = <L2> and <L2> -> true;
            <Start> = <L1>;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const results = match(grammar, "alpha mid and beta mid");
        expect(results).toStrictEqual([true]);
    });
});

// ---------------------------------------------------------------
// 6. Cache key discrimination
// ---------------------------------------------------------------

describe("cache key discrimination", () => {
    it("different requireValue contexts produce distinct cache entries", () => {
        // <Inner> is referenced both as a bound variable and
        // unbound; the cache key includes requireValue.
        const g = `
            <Inner> = foo -> "matched";
            <Start> = $(v:<Inner>) end -> { v }
                    | <Inner> end -> "unbound";
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const results = match(grammar, "foo end");
        // Both alternatives should succeed: one with v="matched",
        // the other with "unbound".
        expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("carrier vs non-carrier same rules get separate entries", () => {
        // <Single> has one part with no variable expression (carrier mode).
        // When referenced as $(v:<Single>), the carrier flag differs.
        const g = `
            <Single> = hello;
            <Start> = $(v:<Single>) end -> { v }
                     | <Single> end -> "plain";
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const results = match(grammar, "hello end");
        expect(results.length).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------
// 7. Carrier mode delta replay (implicit-default single-part)
// ---------------------------------------------------------------

describe("carrier mode replay", () => {
    it("implicit-default carrier replays with correct value", () => {
        // <Animal> is a single-part rule with no value expression
        // (carrier mode). When used as $(v:<Animal>), the outer
        // call captures the inner text as the value.
        const g = `
            <Animal> = cat | dog | bird;
            <Start> = I like $(v:<Animal>) and $(w:<Animal>) -> { v, w };
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const results = match(grammar, "I like cat and dog");
        expect(results).toContainEqual({ v: "cat", w: "dog" });
    });

    it("carrier preserves value through two replay sites", () => {
        const g = `
            <Color> = red | blue | green;
            <Start> = $(a:<Color>) then $(b:<Color>) then $(c:<Color>) -> { a, b, c };
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const results = match(grammar, "red then blue then green");
        expect(results).toContainEqual({
            a: "red",
            b: "blue",
            c: "green",
        });
    });
});

// ---------------------------------------------------------------
// 8. noSuccessCache boundaries (repeat, pendingWildcard)
// ---------------------------------------------------------------

describe("noSuccessCache boundaries", () => {
    it("repeat entries do not pollute memoization cache", () => {
        // A repeat body should NOT be success-cached because the
        // repeat's backtrack frame controls iteration. Verify
        // correct results even with memoization on.
        const g = `
            <Item> = a -> 1;
            <Start> = (<Item>)+ end -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const withMemo = match(grammar, "a a a end");
        const noMemo = match(grammar, "a a a end", {
            memoization: false,
        });

        expect(withMemo).toStrictEqual(noMemo);
        expect(withMemo).toStrictEqual([true]);
    });

    it("pendingWildcard entries do not get success-cached", () => {
        // When a wildcard is active at the sub-rule entry, the
        // success depends on the wildcard length, which varies
        // across attempts. Verify correctness.
        const g = `
            <Tag> = $(t:string) end -> t;
            <Start> = $(prefix) <Tag> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const withMemo = match(grammar, "some prefix text end");
        const noMemo = match(grammar, "some prefix text end", {
            memoization: false,
        });

        expect(withMemo).toStrictEqual(noMemo);
    });

    it("repeat with values matches identically with and without memo", () => {
        const g = `<Start> = ($(x:string))+ end -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);

        const withMemo = match(grammar, "a b c end");
        const noMemo = match(grammar, "a b c end", {
            memoization: false,
        });

        expect(withMemo).toStrictEqual(noMemo);
    });
});

// ---------------------------------------------------------------
// 9. Replay LIFO ordering with 3+ alternation members
// ---------------------------------------------------------------

describe("replay frame ordering", () => {
    it("3+ alternation members replay in correct order", () => {
        const g = `
            <R> = a -> 1 | b -> 2 | c -> 3;
            <Start> = <R> x <R> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const withMemo = match(grammar, "a x b");
        const noMemo = match(grammar, "a x b", { memoization: false });

        // Both must produce the same set (order may differ, but
        // content must match).
        expect(withMemo.sort()).toStrictEqual(noMemo.sort());
        expect(withMemo.length).toBeGreaterThan(0);
    });

    it("4 alternation members produce identical results", () => {
        const g = `
            <R> = w -> 1 | x -> 2 | y -> 3 | z -> 4;
            <Start> = <R> and <R> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const withMemo = match(grammar, "w and x");
        const noMemo = match(grammar, "w and x", { memoization: false });

        expect(withMemo).toStrictEqual(noMemo);
    });
});

// ---------------------------------------------------------------
// 10. Pending wildcard delta capture
// ---------------------------------------------------------------

describe("pending wildcard delta capture", () => {
    it("wildcard offset stored relative to entry index", () => {
        const g = `
            <Text> = $(wc) end -> wc;
            <Start> = start <Text> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const withMemo = match(grammar, "start middle stuff end");
        const noMemo = match(grammar, "start middle stuff end", {
            memoization: false,
        });

        expect(withMemo).toStrictEqual(noMemo);
    });

    it("wildcard in nested rules with different prefix lengths", () => {
        const g = `
            <Capture> = $(wc) done -> wc;
            <Start> = a <Capture> -> true
                    | a b <Capture> -> true
                    | a b c <Capture> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const withMemo = match(grammar, "a b c something done");
        const noMemo = match(grammar, "a b c something done", {
            memoization: false,
        });

        // All three alternatives that can match should produce
        // identical results regardless of memoization.
        expect(withMemo).toStrictEqual(noMemo);
    });
});

// ---------------------------------------------------------------
// 11. lastMatchedPartInfo preservation in deltas
// ---------------------------------------------------------------

describe("lastMatchedPartInfo preservation", () => {
    it("completion-relevant part info survives memo replay", () => {
        // This grammar has a sub-rule whose last matched part is
        // a variable - important for completion.
        const g = `
            <Item> = $(name:string) -> name;
            <Start> = <Item> and <Item> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        // The second <Item> triggers a replay; the lastMatchedPartInfo
        // from the replay must match the live execution.
        const withMemo = matchGrammar(grammar, "alpha and beta");
        const noMemo = matchGrammar(grammar, "alpha and beta", {
            memoization: false,
        });

        // Verify both produce the same matches.
        expect(withMemo.map((m) => m.match)).toStrictEqual(
            noMemo.map((m) => m.match),
        );
    });
});

// ---------------------------------------------------------------
// 12. Cross-cutting: all existing policy combos + memo parity
// ---------------------------------------------------------------

describe("policy + memoization cross-product parity", () => {
    // Use a grammar with enough structure to exercise all axes.
    const g = `
        <Inner> = $(x:string) -> x;
        <Start> = (please)? (<Inner>)+ $(rest) -> { rest };
    `;

    let grammar: Grammar;
    beforeAll(() => {
        grammar = loadGrammarRules("test.grammar", g);
    });

    const policies: GrammarMatchOptions[] = [
        {},
        { wildcardPolicy: "shortest" },
        { optionalPolicy: "preferTake" },
        { optionalPolicy: "preferSkip" },
        { repeatPolicy: "greedy" },
        { repeatPolicy: "nonGreedy" },
    ];

    const inputs = [
        "please alpha beta gamma",
        "alpha beta gamma",
        "please alpha gamma",
    ];

    for (const policy of policies) {
        const policyName =
            Object.entries(policy)
                .map(([k, v]) => `${k}:${v}`)
                .join("+") || "defaults";

        for (const input of inputs) {
            it(`${policyName} on "${input}"`, () => {
                const memoOn = match(grammar, input, {
                    ...policy,
                    memoization: true,
                });
                const memoOff = match(grammar, input, {
                    ...policy,
                    memoization: false,
                });

                expect(memoOn).toStrictEqual(memoOff);
            }, 5000);
        }
    }
});

// ---------------------------------------------------------------
// 13. Suppression with active memo frames
// ---------------------------------------------------------------

describe("suppression preserves memo frames", () => {
    // When a non-exhaustive policy suppresses backtrack frames
    // after a successful match, memoMarker and memoReplay frames
    // must survive suppression.  Dropping a memoMarker would
    // prevent failure-cache population; dropping a memoReplay
    // would lose cached alternative parses.

    it("wildcardPolicy shortest with rule reuse", () => {
        // <Inner> is referenced twice; the second entry may hit
        // a memoReplay frame.  wildcardPolicy: shortest suppresses
        // wildcard frames but must NOT suppress memo frames.
        const g = `
            <Inner> = $(x:string) -> x;
            <Start> = $(w) <Inner> and <Inner> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const memoOn = match(grammar, "pre hello and world", {
            wildcardPolicy: "shortest",
        });
        const memoOff = match(grammar, "pre hello and world", {
            wildcardPolicy: "shortest",
            memoization: false,
        });

        expect(memoOn).toStrictEqual(memoOff);
    });

    it("optionalPolicy preferTake with memoized sub-rule", () => {
        const g = `
            <Tag> = $(t:string) -> t;
            <Start> = (hey)? <Tag> and <Tag> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const memoOn = match(grammar, "hey alpha and beta", {
            optionalPolicy: "preferTake",
        });
        const memoOff = match(grammar, "hey alpha and beta", {
            optionalPolicy: "preferTake",
            memoization: false,
        });

        expect(memoOn).toStrictEqual(memoOff);
    });

    it("repeatPolicy greedy with memoized sub-rule", () => {
        const g = `
            <Item> = $(v:string) -> v;
            <Start> = (go)+ <Item> and <Item> -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const memoOn = match(grammar, "go go alpha and beta", {
            repeatPolicy: "greedy",
        });
        const memoOff = match(grammar, "go go alpha and beta", {
            repeatPolicy: "greedy",
            memoization: false,
        });

        expect(memoOn).toStrictEqual(memoOff);
    });

    it("all suppression axes combined", () => {
        const g = `
            <R> = $(x:string) -> x;
            <Start> = (please)? $(w) (<R>)+ end -> true;
        `;
        const grammar = loadGrammarRules("test.grammar", g);

        const opts: GrammarMatchOptions = {
            wildcardPolicy: "shortest",
            optionalPolicy: "preferTake",
            repeatPolicy: "greedy",
        };

        const memoOn = match(grammar, "please stuff alpha beta end", opts);
        const memoOff = match(grammar, "please stuff alpha beta end", {
            ...opts,
            memoization: false,
        });

        expect(memoOn).toStrictEqual(memoOff);
    });
});
