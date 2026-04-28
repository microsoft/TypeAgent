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
        // Adds tailFactoring on top of factor.  Lets the factorer
        // emit tail RulesParts at forks where members reference
        // prefix-bound canonicals (today's `cross-scope-ref`
        // bailouts), and prefers tail wrappers everywhere else
        // (smaller AST, one fewer matcher frame push per fork).
        name: "factor+tail",
        opts: {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        },
    },
    {
        // dispatchifyAlternations alone - measures the impact of
        // first-token dispatch in isolation.  At alternation forks
        // whose members start with distinct, statically-known tokens,
        // emits a dispatched `RulesPart` so the matcher does an O(1) hash
        // lookup instead of trying each member's leading regex in turn.
        name: "dispatch",
        opts: {
            optimizations: { dispatchifyAlternations: true },
        },
    },
    {
        // All passes enabled: inline + factor + tailFactoring.
        name: "all",
        opts: {
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        },
    },
    {
        // All passes plus dispatch.
        name: "all+dispatch",
        opts: {
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
                tailFactoring: true,
                dispatchifyAlternations: true,
            },
        },
    },
];

// Speedup is colored once it moves more than 10% from baseline.
export function colorSpeedup(speedup: number): string {
    const text = `${speedup.toFixed(2)}x`;
    if (speedup > 1.1) return chalk.green(text);
    if (speedup < 0.9) return chalk.red(text);
    return text;
}

/**
 * Format a timing followed by its speedup in parentheses, padded to the
 * given visible width.  ANSI color codes from `colorSpeedup` are added
 * after padding so visible-width alignment is preserved.
 *
 * Example output: `   12.3 (1.45x)` (with the speedup colored).
 */
export function formatTimeWithSpeedup(
    ms: number,
    speedup: number,
    width: number = 0,
): string {
    const speedStr = `${speedup.toFixed(2)}x`;
    const plain = `${ms.toFixed(1)} (${speedStr})`;
    const padded = width > 0 ? plain.padStart(width) : plain;
    return padded.replace(speedStr, colorSpeedup(speedup));
}

export function timeMs(fn: () => void, iterations: number): number {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    return performance.now() - start;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Visible (ANSI-stripped) length of a string. */
export function visibleLen(s: string): number {
    return s.replace(ANSI_RE, "").length;
}

/**
 * Print a column-aligned table.  Each column is padded (right-aligned)
 * to the visible width of its widest cell, ignoring ANSI color escapes
 * so colored cells still align correctly.
 */
export function printAligned(header: string[], rows: string[][]): void {
    const widths = header.map((h, i) =>
        Math.max(visibleLen(h), ...rows.map((r) => visibleLen(r[i] ?? ""))),
    );
    const sep = widths.map((w) => "-".repeat(w)).join(" | ");
    const padStart = (s: string, w: number): string =>
        " ".repeat(Math.max(0, w - visibleLen(s))) + s;
    const fmt = (row: string[]) =>
        row.map((c, i) => padStart(c ?? "", widths[i])).join(" | ");
    console.log(fmt(header));
    console.log(sep);
    for (const row of rows) console.log(fmt(row));
    console.log();
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
                for (const r of p.alternatives) visit(r.parts);
            }
        }
    };
    for (const r of grammar.alternatives) visit(r.parts);
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
        `| config       | RulesParts | match ms (${ITERATIONS}x, speedup) |`,
    );
    console.log(`|--------------|-----------:|---------------------------:|`);
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
            `| ${cfg.name.padEnd(12)} | ${String(partCount).padStart(10)} | ${formatTimeWithSpeedup(ms, speedup, 26)} |`,
        );
    }
}
