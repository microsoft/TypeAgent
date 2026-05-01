// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Regression test for catastrophic matcher backtracking on a
 * near-match input.  The grammar (discovered via fuzz) interleaves
 * `$(v:string)` wildcards with fixed anchors; on a truncated prefix
 * the matcher explores an exponential number of wildcard
 * assignments before rejecting (~12s wall-clock).
 *
 * Failure memoization at sub-rule entry
 * (`grammarMatcher.ts`, `MemoMarkerBacktrack` / `memoCache`)
 * helps grammars whose pathology is dominated by repeated
 * intrinsic sub-rule failures, but does NOT cover this case:
 * `<R3>` with its inner wildcard succeeds internally at almost
 * every position (the wildcard absorbs anything before `b a e`),
 * so the repeated work is success-then-continuation-rejection,
 * not intrinsic failure.  Memoizing successes requires reifying
 * the per-rule success-set, a structural rewrite of the matcher
 * outside the current change.
 *
 * Until that lands (or a bounded-work option is added to
 * `matchGrammar`), this case takes ~12s wall-clock for a single
 * match attempt.  The test is `xit`-skipped so the fuzz suite
 * stays green; remove the `x` prefix once a fix is in.
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
    // Re-enabled after success memoization landed: failure-only
    // memoization could not collapse this case (members succeed
    // internally but their continuations reject), but per-entry
    // success-delta caching does.
    it("rejects truncated near-match within a reasonable time", () => {
        const grammar = loadGrammarRules("repro.grammar", GRAMMAR, {
            startValueRequired: false,
            enableValueExpressions: true,
        });
        const t0 = Date.now();
        const matches = matchGrammar(grammar, TRUNCATED_NEAR_MATCH);
        const elapsedMs = Date.now() - t0;
        expect(matches).toEqual([]);
        // Pre-memoization this took ~12s.  With success memo
        // landed it runs in well under a second; the bound is
        // generous to absorb CI jitter and first-run JIT warmup.
        expect(elapsedMs).toBeLessThan(3000);
    });
});
