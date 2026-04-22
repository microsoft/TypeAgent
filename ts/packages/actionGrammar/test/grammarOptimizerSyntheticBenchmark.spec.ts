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
 * Set TYPEAGENT_SKIP_BENCHMARKS=1 to skip.
 */

import {
    loadGrammarRulesNoThrow,
    LoadGrammarRulesOptions,
} from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { GrammarPart } from "../src/grammarTypes.js";

const ITERATIONS = 500;
const SHOULD_SKIP = process.env.TYPEAGENT_SKIP_BENCHMARKS === "1";

const CONFIGS: { name: string; opts: LoadGrammarRulesOptions }[] = [
    { name: "baseline", opts: {} },
    {
        name: "inline",
        opts: { optimizations: { inlineSingleAlternatives: true } },
    },
    {
        name: "factor",
        opts: { optimizations: { factorCommonPrefixes: true } },
    },
    {
        name: "both",
        opts: {
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
            },
        },
    },
];

function timeMs(fn: () => void, iterations: number): number {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    return performance.now() - start;
}

function countRulesParts(
    grammar: ReturnType<typeof loadGrammarRulesNoThrow>,
): number {
    if (!grammar) return 0;
    let count = 0;
    const visit = (parts: GrammarPart[]) => {
        for (const p of parts) {
            if (p.type === "rules") {
                count++;
                for (const r of p.rules) visit(r.parts);
            }
        }
    };
    for (const r of grammar.rules) visit(r.parts);
    return count;
}

function runBenchmark(
    label: string,
    grammarText: string,
    requests: string[],
): void {
    console.log(`\n=== ${label} ===`);
    console.log(
        `| config    | RulesParts | match ms (${ITERATIONS}x) | speedup |`,
    );
    console.log(`|-----------|-----------:|---------------:|--------:|`);
    let baselineMs = 0;
    for (const cfg of CONFIGS) {
        const errors: string[] = [];
        const grammar = loadGrammarRulesNoThrow(
            "synthetic.grammar",
            grammarText,
            errors,
            undefined,
            cfg.opts,
        );
        if (!grammar) {
            console.log(`[error] ${cfg.name}: ${errors.join("; ")}`);
            continue;
        }
        const partCount = countRulesParts(grammar);
        try {
            for (const r of requests) matchGrammar(grammar, r);
        } catch (e) {
            console.log(
                `[error] ${cfg.name} match failed: ${(e as Error).message}`,
            );
            continue;
        }
        const ms = timeMs(() => {
            for (const r of requests) matchGrammar(grammar, r);
        }, ITERATIONS);
        if (cfg.name === "baseline") baselineMs = ms;
        const speedup = baselineMs > 0 ? baselineMs / ms : 1;
        console.log(
            `| ${cfg.name.padEnd(9)} | ${String(partCount).padStart(10)} | ${ms.toFixed(1).padStart(14)} | ${speedup.toFixed(2).padStart(6)}x |`,
        );
    }
}

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

describe("Grammar Optimizer - Synthetic Benchmarks", () => {
    (SHOULD_SKIP ? it.skip : it)("pass-through chain (depth=8)", () => {
        const grammarText = buildPassthroughChain(8);
        runBenchmark(`pass-through chain (depth=8)`, grammarText, [
            "target word here",
            "miss",
            "target word",
            "no match here",
        ]);
        expect(true).toBe(true);
    });

    (SHOULD_SKIP ? it.skip : it)("wide common prefix (width=20)", () => {
        const grammarText = buildWideCommonPrefix(20);
        // Mix of matching & non-matching requests.
        const requests = [
            "perform the action with item valuea0",
            "perform the action with item valuet0",
            "perform the action with item nothere",
            "perform the action with",
            "noise input that does not match",
        ];
        runBenchmark(`wide common prefix (width=20)`, grammarText, requests);
        expect(true).toBe(true);
    });

    (SHOULD_SKIP ? it.skip : it)("wide common prefix (width=50)", () => {
        const grammarText = buildWideCommonPrefix(50);
        const requests = [
            "perform the action with item valuea0",
            "perform the action with item valuex0",
            "perform the action with item valuew1",
            "perform the action with item nothere",
            "noise input",
        ];
        runBenchmark(`wide common prefix (width=50)`, grammarText, requests);
        expect(true).toBe(true);
    });

    (SHOULD_SKIP ? it.skip : it)(
        "combined (depth=4 wrappers, width=20 prefix)",
        () => {
            const grammarText = buildCombined(20);
            const requests = [
                "perform the action with item valuea0",
                "perform the action with item valuek0",
                "perform the action with item nothere",
                "noise",
            ];
            runBenchmark(
                `combined (depth=4 wrappers, width=20 prefix)`,
                grammarText,
                requests,
            );
            expect(true).toBe(true);
        },
    );
});
