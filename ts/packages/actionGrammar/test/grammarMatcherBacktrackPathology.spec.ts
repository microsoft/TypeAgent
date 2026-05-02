// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Regression test for catastrophic matcher backtracking on a
 * near-match input.  The grammar (discovered via fuzz) interleaves
 * `$(v:string)` wildcards with fixed anchors; on a truncated prefix
 * the matcher explores an exponential number of wildcard
 * assignments before rejecting.
 *
 * Until packrat memoization (or equivalent pruning) lands in
 * `grammarMatcher.ts`, this case takes ~12 s wall-clock for a
 * single match attempt.  The test is `xit`-skipped so the fuzz
 * suite stays green; remove the `x` prefix once the matcher fix
 * is in to lock in the improvement.
 *
 * Source: `packages/actionGrammar/src/fuzz/reproSlowMatch.mjs`
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";

const GRAMMAR = `<Start> = <R0>;
<R0> = <R1> <R2> <R1> <R1> | <R1> <R1> <R2> | <R3> <R2> <R2> <R3> | e;
<R1> = $(v1:string) c <R2> <R2> -> ({ k: v1 }).k | <R3> <R3> | <R2> $(n2:number) <R2> <R2> -> (6 + 6) * 3 | $(v3:string) $(v4:string) <R2>;
<R2> = <R3> <R3> <R3>;
<R3> = $(v0:string) b a e;
`;

// Truncated near-match prefix: matches the start of the longest
// expansion of <R0> but is missing the final `e` token, forcing
// the matcher to explore every wildcard binding before rejecting.
const TRUNCATED_NEAR_MATCH =
    "a c b b a e b b a e b b a e b b a e b b a e b b a e b b a e " +
    "b b a e b b a e a c b b a e b b a e b b a e b b a e b b a e " +
    "b b a e a c b b a e b b a e b b a e b b a e b b a e b b a";

describe("Grammar Matcher - Backtrack Pathology", () => {
    // Skipped pending packrat memoization; takes ~12s wall-clock today.
    xit("rejects truncated near-match within a reasonable time", () => {
        const grammar = loadGrammarRules("repro.grammar", GRAMMAR, {
            startValueRequired: false,
            enableValueExpressions: true,
        });
        const t0 = Date.now();
        const matches = matchGrammar(grammar, TRUNCATED_NEAR_MATCH);
        const elapsedMs = Date.now() - t0;
        expect(matches).toEqual([]);
        // Generous bound; current matcher takes ~12s.  Tighten as
        // packrat lands.
        expect(elapsedMs).toBeLessThan(1000);
    });
});
