// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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

// Coverage for the per-axis exploration policies on `GrammarMatchOptions`:
//   - optionalPolicy: "exhaustive" | "preferTake" | "preferSkip"
//   - repeatPolicy:   "exhaustive" | "greedy"     | "nonGreedy"
//
// Each non-default value is a "first-success commitment": once a parse
// succeeds along that axis, sibling alternatives on the SAME axis must
// be pruned.  The `preferSkip` regression (matcherInfiniteLoop on
// take-frame restore) is covered separately in
// `optionalPolicyPreferSkipBacktrack.spec.ts`.
//
// Tests use a 5-second per-test timeout: any policy bug that re-pushes
// the same fork (as the original `preferSkip` defect did) would hang
// the matcher and surface as a timeout rather than a wrong-answer.

describe("optionalPolicy coverage", () => {
    // Grammar: `(please)? help` — one optional prefix.
    const g = `<Start> = (please)? help -> true;`;
    let grammar: Grammar;
    beforeAll(() => {
        grammar = loadGrammarRules("test.grammar", g);
    });

    describe("exhaustive (default)", () => {
        it("input with the optional present yields a single parse", () => {
            // Skip path leaves "please help" to be matched as "help",
            // which fails — only the take path succeeds.
            expect(match(grammar, "please help")).toStrictEqual([true]);
        });
        it("input without the optional yields a single parse", () => {
            expect(match(grammar, "help")).toStrictEqual([true]);
        });
    });

    describe("preferTake", () => {
        it("takes when the take path succeeds", () => {
            expect(
                match(grammar, "please help", { optionalPolicy: "preferTake" }),
            ).toStrictEqual([true]);
        });
        it("falls back to skip when take fails", () => {
            // `please` literal is absent, so the take path fails and
            // the matcher restores the queued skip-frame.
            expect(
                match(grammar, "help", { optionalPolicy: "preferTake" }),
            ).toStrictEqual([true]);
        });
    });

    describe("preferSkip", () => {
        it("falls back to take when skip fails", () => {
            // The regression case from
            // optionalPolicyPreferSkipBacktrack.spec.ts; included here
            // for axis-completeness.
            expect(
                match(grammar, "please help", { optionalPolicy: "preferSkip" }),
            ).toStrictEqual([true]);
        }, 5000);
        it("commits to skip when skip succeeds", () => {
            expect(
                match(grammar, "help", { optionalPolicy: "preferSkip" }),
            ).toStrictEqual([true]);
        }, 5000);
    });

    describe("downstream parts unaffected by the consumed flag", () => {
        // Two optional groups; the suppression flag set on the take
        // snapshot must not leak into the second optional.
        const g2 = `<Start> = (please)? do (thanks)? -> true;`;
        let grammar2: Grammar;
        beforeAll(() => {
            grammar2 = loadGrammarRules("test.grammar", g2);
        });
        for (const optionalPolicy of [
            "exhaustive",
            "preferTake",
            "preferSkip",
        ] as const) {
            it(`(${optionalPolicy}) "please do thanks" matches`, () => {
                expect(
                    match(grammar2, "please do thanks", { optionalPolicy }),
                ).toContain(true);
            }, 5000);
            it(`(${optionalPolicy}) "do" matches`, () => {
                expect(match(grammar2, "do", { optionalPolicy })).toContain(
                    true,
                );
            }, 5000);
        }
    });
});

describe("repeatPolicy coverage", () => {
    // Grammar: `(a)+ $(x)` — repeat the `a` literal one-or-more times,
    // then capture the rest of the input as a wildcard.
    //
    // Input "a a a" admits two valid splits (the third `a` cannot be
    // both consumed by the repeat AND captured by the wildcard, since
    // the wildcard requires at least one non-separator character):
    //   - count=1, x="a a"
    //   - count=2, x="a"
    // count=3 fails (wildcard would be empty).
    const g = `<Start> = (a)+ $(x) -> { x };`;
    let grammar: Grammar;
    beforeAll(() => {
        grammar = loadGrammarRules("test.grammar", g);
    });

    describe("exhaustive (default)", () => {
        it("returns every valid (count, x) split", () => {
            const results = match(grammar, "a a a");
            expect(results).toEqual(
                expect.arrayContaining([{ x: "a a" }, { x: "a" }]),
            );
            expect(results).toHaveLength(2);
        });
    });

    describe("greedy", () => {
        it("commits to the longest viable repeat count", () => {
            // count=2 is the longest count that still leaves a
            // non-empty wildcard.
            const results = match(grammar, "a a a", {
                repeatPolicy: "greedy",
            });
            expect(results).toStrictEqual([{ x: "a" }]);
        }, 5000);
    });

    describe("nonGreedy", () => {
        it("commits to the shortest viable repeat count", () => {
            // count=1 is the minimum required by `+`.
            const results = match(grammar, "a a a", {
                repeatPolicy: "nonGreedy",
            });
            expect(results).toStrictEqual([{ x: "a a" }]);
        }, 5000);
    });

    describe("()* zero-or-more", () => {
        // `*` admits count=0 as a valid alternative.  Grammar:
        //   (a)* $(x)
        // input "a a a" — count=0 ⇒ x="a a a"; count=1 ⇒ x="a a";
        // count=2 ⇒ x="a"; count=3 fails (empty wildcard).
        //
        // NOTE: count=0 is NOT a repeat-origin fork — when the inner
        // `( ... )?` skips, no nested rule is ever entered, so
        // `finalizeNestedRule` is not called and no repeat-frame is
        // pushed.  Consequently `repeatPolicy` does not influence
        // the count=0 vs count≥1 split (that is governed by the
        // OUTER optional fork via `optionalPolicy`).  The test
        // documents this interaction.
        const gStar = `<Start> = (a)* $(x) -> { x };`;
        let grammarStar: Grammar;
        beforeAll(() => {
            grammarStar = loadGrammarRules("test.grammar", gStar);
        });

        it("exhaustive returns all counts from 0 upward", () => {
            const results = match(grammarStar, "a a a");
            expect(results).toEqual(
                expect.arrayContaining([
                    { x: "a a a" },
                    { x: "a a" },
                    { x: "a" },
                ]),
            );
        });

        it("greedy still allows count=0 fallback via the optional axis", () => {
            // Greedy collapses the count≥1 branch to its longest
            // valid count, but the count=0 alternative comes from
            // the OUTER optional fork — `optionalPolicy` controls
            // whether it is enumerated.  With optionalPolicy
            // exhaustive (default) we still see count=0.
            const results = match(grammarStar, "a a a", {
                repeatPolicy: "greedy",
            });
            // Expect the count=0 result plus the greedy count≥1 pick.
            expect(results).toEqual(
                expect.arrayContaining([{ x: "a a a" }, { x: "a" }]),
            );
        }, 5000);

        it("greedy + preferTake collapses to a single longest parse", () => {
            // preferTake commits to entering the repeat (skipping
            // count=0); greedy then commits to the longest count.
            const results = match(grammarStar, "a a a", {
                repeatPolicy: "greedy",
                optionalPolicy: "preferTake",
            });
            expect(results).toStrictEqual([{ x: "a" }]);
        }, 5000);

        it("nonGreedy + preferTake collapses to count=1", () => {
            const results = match(grammarStar, "a a a", {
                repeatPolicy: "nonGreedy",
                optionalPolicy: "preferTake",
            });
            expect(results).toStrictEqual([{ x: "a a" }]);
        }, 5000);
    });
});
