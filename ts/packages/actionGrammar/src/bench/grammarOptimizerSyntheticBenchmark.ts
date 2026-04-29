// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Synthetic optimizer benchmark — informational only.
 *
 * Constructs grammars whose structure is *designed* to exercise each
 * optimization in isolation and at varying scale, so the impact of
 * each pass is visible without the noise of a real agent grammar.
 *
 * Three benchmarks are produced:
 *
 *   1. Pass-through chain      — N levels of `<L0> = <L1>; <L1> = <L2>; …`
 *      Targets `inlineSingleAlternatives`.
 *
 *   2. Wide common-prefix      — N alternatives that all start with the
 *      same long literal prefix and diverge in the last token.
 *      Targets `factorCommonPrefixes`.
 *
 *   3. Combined                — Pass-through wrappers around a wide
 *      common-prefix block.  Targets both passes together.
 *
 * Run with: `pnpm run bench:synthetic` (from this package directory).
 */

import { runBenchmark } from "./benchUtil.js";

// ─── Synthetic grammar builders ────────────────────────────────────────────

/**
 * Pass-through chain: `<L0> = <L1>; <L1> = <L2>; …; <LN> = "target"`.
 * Each `<Li>` adds one nested RulesPart with no other semantics —
 * exactly the shape `inlineSingleAlternatives` collapses.
 */
function buildPassthroughChain(depth: number): string {
    const lines: string[] = [`<Start> = <L0>;`];
    for (let i = 0; i < depth; i++) {
        lines.push(`<L${i}> = <L${i + 1}>;`);
    }
    lines.push(`<L${depth}> = target word here;`);
    return lines.join("\n");
}

/**
 * Wide common prefix: N alternatives that share the same long literal
 * prefix and differ only in the last word.
 *
 *   <Choice> = perform the action with item one
 *            | perform the action with item two
 *            | …
 */
function buildWideCommonPrefix(width: number): string {
    const prefix = "perform the action with item";
    const alts: string[] = [];
    for (let i = 0; i < width; i++) {
        const word = `value${String.fromCharCode(97 + (i % 26))}${Math.floor(
            i / 26,
        )}`;
        alts.push(`${prefix} ${word} -> "${word}"`);
    }
    return `<Start> = <Choice>;\n<Choice> = ${alts.join("\n         | ")};`;
}

/**
 * Combined pattern: two layers of pass-through wrapping around a wide
 * common-prefix block — exercises both passes together.
 */
function buildCombined(width: number): string {
    // Rename <Start> → <Inner> in the wide-prefix grammar and wrap it
    // in a chain of pass-through rules.  Keep every line of the
    // renamed inner grammar so <Inner> is actually defined.
    const inner = buildWideCommonPrefix(width).replace("<Start>", "<Inner>");
    return [`<Start> = <W1>;`, `<W1> = <W2>;`, `<W2> = <Inner>;`, inner].join(
        "\n",
    );
}

/**
 * Cross-scope-ref fork: N alternatives that share a prefix capturing
 * `$(item:string)` and each alternative's value expression references
 * that prefix-bound capture.  Without `tailFactoring`, the factorer
 * bails out at this fork (`cross-scope-ref`) and emits each member
 * as a separate full rule - losing prefix factoring entirely.  With
 * `tailFactoring`, the factorer emits a tail RulesPart and the prefix
 * is shared.  This is the motivating case the player grammar hits in
 * the wild.
 *
 *   <Choice> = act on $(item:string) by $(name0:string) -> { kind: "by0", item, name0 }
 *            | act on $(item:string) by $(name1:string) -> { kind: "by1", item, name1 }
 *            | …
 */
function buildCrossScopeRefFork(width: number): string {
    const alts: string[] = [];
    for (let i = 0; i < width; i++) {
        const slot = `name${i}`;
        const tag = `by${i}`;
        alts.push(
            `act on $(item:string) by ${i} $(${slot}:string) -> { kind: "${tag}", item, ${slot} }`,
        );
    }
    return `<Start> = <Choice>;\n<Choice> = ${alts.join("\n         | ")};`;
}

/**
 * Wide keyword dispatch: N alternatives with *distinct* leading
 * keywords and short tails.  Each alternative's first token is unique
 * so common-prefix factoring cannot help, but `dispatchifyAlternations`
 * can index the entire fork by first token and reduce a linear regex
 * scan over N members to a single hash lookup.  This is the canonical
 * "command keyword" pattern (each agent action starts with a different
 * verb).
 *
 *   <Choice> = verb0 the thing -> 0
 *            | verb1 the thing -> 1
 *            | …
 */
function buildWideKeywordDispatch(width: number): string {
    const alts: string[] = [];
    for (let i = 0; i < width; i++) {
        alts.push(`verb${i} the thing -> ${i}`);
    }
    return `<Start> = <Choice>;\n<Choice> = ${alts.join("\n         | ")};`;
}

/**
 * Mixed keyword dispatch with shared-prefix buckets: groups of M
 * alternatives sharing each first token.  Within a bucket, members
 * differ in trailing tokens.  This exercises dispatch combined with
 * common-prefix factoring: dispatch should narrow the fork to the
 * bucket, and the factorer should still factor each bucket's prefix.
 *
 *   <Choice> = play song0 -> "s0"
 *            | play song1 -> "s1"
 *            | …
 *            | stop song0 -> "x0"
 *            | …
 */
function buildBucketedKeywordDispatch(
    buckets: number,
    bucketSize: number,
): string {
    const alts: string[] = [];
    for (let b = 0; b < buckets; b++) {
        for (let i = 0; i < bucketSize; i++) {
            alts.push(`verb${b} item${i} now -> ${b * bucketSize + i}`);
        }
    }
    return `<Start> = <Choice>;\n<Choice> = ${alts.join("\n         | ")};`;
}

function main(): void {
    runBenchmark(
        `pass-through chain (depth=8)`,
        "synthetic.grammar",
        buildPassthroughChain(8),
        ["target word here", "miss", "target word", "no match here"],
    );

    runBenchmark(
        `wide common prefix (width=20)`,
        "synthetic.grammar",
        buildWideCommonPrefix(20),
        [
            "perform the action with item valuea0",
            "perform the action with item valuet0",
            "perform the action with item nothere",
            "perform the action with",
            "noise input that does not match",
        ],
    );

    runBenchmark(
        `wide common prefix (width=50)`,
        "synthetic.grammar",
        buildWideCommonPrefix(50),
        [
            "perform the action with item valuea0",
            "perform the action with item valuex0",
            "perform the action with item valuew1",
            "perform the action with item nothere",
            "noise input",
        ],
    );

    runBenchmark(
        `combined (depth=4 wrappers, width=20 prefix)`,
        "synthetic.grammar",
        buildCombined(20),
        [
            "perform the action with item valuea0",
            "perform the action with item valuek0",
            "perform the action with item nothere",
            "noise",
        ],
    );

    runBenchmark(
        `cross-scope-ref fork (width=10)`,
        "synthetic.grammar",
        buildCrossScopeRefFork(10),
        [
            "act on widget by 0 alice",
            "act on widget by 5 bob",
            "act on widget by 9 carol",
            "act on widget by 3 dave",
            "act on widget by 11 eve",
            "no match here",
        ],
    );

    runBenchmark(
        `cross-scope-ref fork (width=30)`,
        "synthetic.grammar",
        buildCrossScopeRefFork(30),
        [
            "act on widget by 0 alice",
            "act on widget by 15 bob",
            "act on widget by 29 carol",
            "act on widget by 7 dave",
            "act on widget by 99 eve",
            "noise",
        ],
    );

    // ─── Dispatch-targeted benchmarks ──────────────────────────────────
    // Wide alternation with distinct leading keywords - the canonical
    // case `dispatchifyAlternations` is designed to accelerate.
    runBenchmark(
        `wide keyword dispatch (width=20)`,
        "synthetic.grammar",
        buildWideKeywordDispatch(20),
        [
            "verb0 the thing",
            "verb10 the thing",
            "verb19 the thing",
            "verb99 the thing", // miss: not a known verb
            "noise input that does not match",
        ],
    );

    runBenchmark(
        `wide keyword dispatch (width=50)`,
        "synthetic.grammar",
        buildWideKeywordDispatch(50),
        [
            "verb0 the thing",
            "verb25 the thing",
            "verb49 the thing",
            "verb99 the thing",
            "noise",
        ],
    );

    runBenchmark(
        `wide keyword dispatch (width=100)`,
        "synthetic.grammar",
        buildWideKeywordDispatch(100),
        [
            "verb0 the thing",
            "verb50 the thing",
            "verb99 the thing",
            "verb500 the thing",
            "noise",
        ],
    );

    // Bucketed dispatch: several distinct first tokens, multiple
    // alternatives per bucket - exercises dispatch + factoring together.
    runBenchmark(
        `bucketed keyword dispatch (buckets=5, size=10)`,
        "synthetic.grammar",
        buildBucketedKeywordDispatch(5, 10),
        [
            "verb0 item0 now",
            "verb2 item5 now",
            "verb4 item9 now",
            "verb9 item0 now", // miss
            "noise",
        ],
    );

    runBenchmark(
        `bucketed keyword dispatch (buckets=20, size=5)`,
        "synthetic.grammar",
        buildBucketedKeywordDispatch(20, 5),
        [
            "verb0 item0 now",
            "verb10 item2 now",
            "verb19 item4 now",
            "verb99 item0 now", // miss
            "noise",
        ],
    );
}

main();
