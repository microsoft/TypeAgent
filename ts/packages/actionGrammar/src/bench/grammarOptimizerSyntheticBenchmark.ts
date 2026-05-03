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

import { runScenarios, Scenario } from "./benchUtil.js";

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

/**
 * Trailing-RulesPart pattern (pure forwarding): a parent rule with a
 * fixed leading literal followed by a multi-alternative subrule whose
 * value is forwarded as-is.  Without `promoteTailRulesParts`, the
 * matcher pushes a frame to enter `<Song>`, runs the alternation, then
 * pops back into the parent to apply the implicit-default rule.  With
 * the promote pass, the trailing `<Song>` becomes a tail call - the
 * parent frame is skipped and the chosen member's value flows up
 * directly.
 *
 *   <Start> = play $(s:<Song>);
 *   <Song>  = "track0" -> 0 | "track1" -> 1 | …;
 *
 * `<Song>` members carry explicit values so the parent's implicit
 * default has a binding to forward; the parent itself has no value
 * expression, which is exactly what the pure-forwarding branch of
 * `promoteTailRulesParts` looks for.
 */
function buildTrailingForward(width: number): string {
    const alts: string[] = [];
    for (let i = 0; i < width; i++) {
        alts.push(`track${i} -> ${i}`);
    }
    return [
        `<Start> = play $(s:<Song>);`,
        `<Song> = ${alts.join("\n       | ")};`,
    ].join("\n");
}

/**
 * Trailing-RulesPart pattern (value substitution): same shape as
 * `buildTrailingForward` but the parent captures the subrule into a
 * variable and folds it into a value expression.  Promote rewrites
 * each member's value to embed the substitution and drops the
 * wrapper variable + parent value, again skipping the parent frame.
 *
 *   <Start> = play $(s:<Song>) -> { kind: "play", song: s };
 *   <Song>  = "track1" -> 1 | "track2" -> 2 | …;
 */
function buildTrailingSubstitute(width: number): string {
    const alts: string[] = [];
    for (let i = 0; i < width; i++) {
        alts.push(`track${i} -> ${i}`);
    }
    return [
        `<Start> = play $(s:<Song>) -> { kind: "play", song: s };`,
        `<Song> = ${alts.join("\n       | ")};`,
    ].join("\n");
}

function main(): void {
    const scenarios: Scenario[] = [
        {
            label: "pass-through chain (depth=8)",
            grammarName: "synthetic.grammar",
            grammarText: buildPassthroughChain(8),
            requests: [
                "target word here",
                "miss",
                "target word",
                "no match here",
            ],
        },
        {
            label: "wide common prefix (width=20)",
            grammarName: "synthetic.grammar",
            grammarText: buildWideCommonPrefix(20),
            requests: [
                "perform the action with item valuea0",
                "perform the action with item valuet0",
                "perform the action with item nothere",
                "perform the action with",
                "noise input that does not match",
            ],
        },
        {
            label: "wide common prefix (width=50)",
            grammarName: "synthetic.grammar",
            grammarText: buildWideCommonPrefix(50),
            requests: [
                "perform the action with item valuea0",
                "perform the action with item valuex0",
                "perform the action with item valuew1",
                "perform the action with item nothere",
                "noise input",
            ],
        },
        {
            label: "combined (depth=4 wrappers, width=20 prefix)",
            grammarName: "synthetic.grammar",
            grammarText: buildCombined(20),
            requests: [
                "perform the action with item valuea0",
                "perform the action with item valuek0",
                "perform the action with item nothere",
                "noise",
            ],
        },
        {
            label: "cross-scope-ref fork (width=10)",
            grammarName: "synthetic.grammar",
            grammarText: buildCrossScopeRefFork(10),
            requests: [
                "act on widget by 0 alice",
                "act on widget by 5 bob",
                "act on widget by 9 carol",
                "act on widget by 3 dave",
                "act on widget by 11 eve",
                "no match here",
            ],
        },
        {
            label: "cross-scope-ref fork (width=30)",
            grammarName: "synthetic.grammar",
            grammarText: buildCrossScopeRefFork(30),
            requests: [
                "act on widget by 0 alice",
                "act on widget by 15 bob",
                "act on widget by 29 carol",
                "act on widget by 7 dave",
                "act on widget by 99 eve",
                "noise",
            ],
        },
        // ─── Dispatch-targeted benchmarks ──────────────────────────
        // Wide alternation with distinct leading keywords - the
        // canonical case `dispatchifyAlternations` is designed to
        // accelerate.
        {
            label: "wide keyword dispatch (width=20)",
            grammarName: "synthetic.grammar",
            grammarText: buildWideKeywordDispatch(20),
            requests: [
                "verb0 the thing",
                "verb10 the thing",
                "verb19 the thing",
                "verb99 the thing", // miss: not a known verb
                "noise input that does not match",
            ],
        },
        {
            label: "wide keyword dispatch (width=50)",
            grammarName: "synthetic.grammar",
            grammarText: buildWideKeywordDispatch(50),
            requests: [
                "verb0 the thing",
                "verb25 the thing",
                "verb49 the thing",
                "verb99 the thing",
                "noise",
            ],
        },
        {
            label: "wide keyword dispatch (width=100)",
            grammarName: "synthetic.grammar",
            grammarText: buildWideKeywordDispatch(100),
            requests: [
                "verb0 the thing",
                "verb50 the thing",
                "verb99 the thing",
                "verb500 the thing",
                "noise",
            ],
        },
        // Bucketed dispatch: several distinct first tokens, multiple
        // alternatives per bucket - exercises dispatch + factoring
        // together.
        {
            label: "bucketed keyword dispatch (buckets=5, size=10)",
            grammarName: "synthetic.grammar",
            grammarText: buildBucketedKeywordDispatch(5, 10),
            requests: [
                "verb0 item0 now",
                "verb2 item5 now",
                "verb4 item9 now",
                "verb9 item0 now", // miss
                "noise",
            ],
        },
        {
            label: "bucketed keyword dispatch (buckets=20, size=5)",
            grammarName: "synthetic.grammar",
            grammarText: buildBucketedKeywordDispatch(20, 5),
            requests: [
                "verb0 item0 now",
                "verb10 item2 now",
                "verb19 item4 now",
                "verb99 item0 now", // miss
                "noise",
            ],
        },
        // ─── Trailing-RulesPart benchmarks (promoteTailRulesParts) ─
        // Pure-forwarding tail: parent has no value, trailing
        // subrule's value flows up via the implicit-default rule.
        // Promote turns the trailing RulesPart into a tail call
        // (skips parent frame push, drops the wrapper-binding
        // variable).
        {
            label: "trailing forward (width=20)",
            grammarName: "synthetic.grammar",
            grammarText: buildTrailingForward(20),
            requests: [
                "play track0",
                "play track10",
                "play track19",
                "play trackZ", // miss
                "noise",
            ],
        },
        {
            label: "trailing forward (width=50)",
            grammarName: "synthetic.grammar",
            grammarText: buildTrailingForward(50),
            requests: [
                "play track0",
                "play track25",
                "play track49",
                "play track99",
                "noise",
            ],
        },
        // Value-substitution tail: parent's value expression
        // references the subrule's bound variable.  Promote
        // materializes each member's effective value, substitutes
        // it into parent.value, and writes the result as the
        // member's new value.
        {
            label: "trailing substitute (width=20)",
            grammarName: "synthetic.grammar",
            grammarText: buildTrailingSubstitute(20),
            requests: [
                "play track0",
                "play track10",
                "play track19",
                "play trackZ", // miss
                "noise",
            ],
        },
        {
            label: "trailing substitute (width=50)",
            grammarName: "synthetic.grammar",
            grammarText: buildTrailingSubstitute(50),
            requests: [
                "play track0",
                "play track25",
                "play track49",
                "play track99",
                "noise",
            ],
        },
    ];
    runScenarios(scenarios);
}

main();
