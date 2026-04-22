// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared helpers for grammar optimizer benchmarks.
 */

import chalk from "chalk";
import {
    loadGrammarRulesNoThrow,
    LoadGrammarRulesOptions,
} from "../grammarLoader.js";
import { matchGrammar } from "../grammarMatcher.js";
import { GrammarPart } from "../grammarTypes.js";

export const ITERATIONS = 500;

export const CONFIGS: { name: string; opts: LoadGrammarRulesOptions }[] = [
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

// Speedup is colored once it moves more than 10% from baseline.
export function colorSpeedup(speedup: number): string {
    const text = `${speedup.toFixed(2)}x`.padStart(6);
    if (speedup > 1.1) return chalk.green(text);
    if (speedup < 0.9) return chalk.red(text);
    return text;
}

export function timeMs(fn: () => void, iterations: number): number {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    return performance.now() - start;
}

export function countRulesParts(
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

/**
 * Run all CONFIGS against the given grammar text and print a comparison
 * table.  `label` is the section heading; `grammarName` is passed to the
 * loader (used in error messages).
 */
export function runBenchmark(
    label: string,
    grammarName: string,
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
            grammarName,
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
        // Warm-up — also validates that the optimized grammar can run.
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
            `| ${cfg.name.padEnd(9)} | ${String(partCount).padStart(10)} | ${ms.toFixed(1).padStart(14)} | ${colorSpeedup(speedup)} |`,
        );
    }
}
