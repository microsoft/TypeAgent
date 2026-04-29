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

export const ITERATIONS = 500;

export const CONFIGS: {
    name: string;
    opts: LoadGrammarRulesOptions;
}[] = [
    { name: "base", opts: {} },
    {
        name: "inl",
        opts: { optimizations: { inlineSingleAlternatives: true } },
    },
    {
        name: "fac",
        opts: { optimizations: { factorCommonPrefixes: true } },
    },
    {
        // Adds tailFactoring on top of factor.  Lets the factorer
        // emit tail RulesParts at forks where members reference
        // prefix-bound canonicals (today's `cross-scope-ref`
        // bailouts), and prefers tail wrappers everywhere else
        // (smaller AST, one fewer matcher frame push per fork).
        name: "fac+tail",
        opts: {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        },
    },
    {
        // inline + factor + tailFactoring (no dispatch, no promote).
        name: "inl+fac+tail",
        opts: {
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
                tailFactoring: true,
            },
        },
    },
    {
        // factor + tailFactoring + promoteTailRulesParts.  Isolates
        // the interaction between prefix factoring (which synthesizes
        // wrappers whose trailing RulesPart is itself promotable) and
        // the in-place promote pass; comparing against `fac+tail`
        // shows promote's marginal impact on the post-factored AST.
        name: "fac+tail+promote",
        opts: {
            optimizations: {
                factorCommonPrefixes: true,
                tailFactoring: true,
                promoteTailRulesParts: true,
            },
        },
    },
    {
        // dispatchifyAlternations alone - measures the impact of
        // first-token dispatch in isolation.  At alternation forks
        // whose members start with distinct, statically-known tokens,
        // emits a dispatched `RulesPart` so the matcher does an O(1) hash
        // lookup instead of trying each member's leading regex in turn.
        name: "disp",
        opts: {
            optimizations: { dispatchifyAlternations: true },
        },
    },
    {
        // inline + factor + tailFactoring + dispatch.  Everything
        // in `all` *except* the tail-RulesPart promote pass, broken
        // out as its own column so the on/off impact of promote is
        // visible by comparing this column against `all`.
        name: "inl+fac+tail+disp",
        opts: {
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
                tailFactoring: true,
                dispatchifyAlternations: true,
            },
        },
    },
    {
        // Everything (matches `recommendedOptimizations`).
        name: "all",
        opts: {
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
                tailFactoring: true,
                dispatchifyAlternations: true,
                promoteTailRulesParts: true,
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

/**
 * One benchmark scenario: a grammar plus a list of input strings to
 * match against it.  `label` identifies the row in the combined
 * results table.  `grammarName` is passed to the loader (used in
 * error messages).
 */
export type Scenario = {
    label: string;
    grammarName: string;
    grammarText: string;
    requests: string[];
};

/**
 * Run every CONFIG against every scenario and print a single
 * combined table - one row per scenario, one column per config.
 *
 * The first data column is the baseline timing in ms; each
 * subsequent column shows that config's speedup vs. baseline
 * (`baseline_ms / config_ms`).  A trailing summary row reports the
 * geometric mean speedup of each config across all scenarios
 * (geometric mean is the right average for ratios - it equals
 * what each config "averages" as a multiplicative factor and is
 * symmetric for "2x faster" vs. "2x slower").
 */
export function runScenarios(scenarios: Scenario[]): void {
    // results[scenarioIdx][configIdx] = { ms, speedup } or null on
    // error/skip.  speedup is undefined for the baseline column.
    type Cell = { ms: number; speedup: number | undefined } | null;
    const results: Cell[][] = scenarios.map(() => CONFIGS.map(() => null));

    for (let s = 0; s < scenarios.length; s++) {
        const scenario = scenarios[s];
        let baselineMs = 0;
        for (let c = 0; c < CONFIGS.length; c++) {
            const cfg = CONFIGS[c];
            const errors: string[] = [];
            const grammar = loadGrammarRulesNoThrow(
                scenario.grammarName,
                scenario.grammarText,
                errors,
                undefined,
                cfg.opts,
            );
            if (!grammar) {
                console.error(
                    `[error] ${scenario.label} / ${cfg.name}: ${errors.join("; ")}`,
                );
                continue;
            }
            // Warm-up - also validates the optimized grammar runs.
            try {
                for (const r of scenario.requests) matchGrammar(grammar, r);
            } catch (e) {
                console.error(
                    `[error] ${scenario.label} / ${cfg.name} match failed: ${(e as Error).message}`,
                );
                continue;
            }
            const ms = timeMs(() => {
                for (const r of scenario.requests) matchGrammar(grammar, r);
            }, ITERATIONS);
            if (c === 0) baselineMs = ms;
            const speedup =
                c === 0 ? undefined : baselineMs > 0 ? baselineMs / ms : 1;
            results[s][c] = { ms, speedup };
        }
    }

    // Build table.  Header: scenario | <name>... .  Every data
    // column shows `ms (Nx)` (baseline's speedup is `1.00x` by
    // construction).
    const header: string[] = ["scenario", ...CONFIGS.map((c) => c.name)];

    const rows: string[][] = scenarios.map((scenario, s) => {
        const row: string[] = [scenario.label];
        for (let c = 0; c < CONFIGS.length; c++) {
            const cell = results[s][c];
            if (cell === null) {
                row.push("-");
                continue;
            }
            const speedup = cell.speedup ?? 1;
            row.push(`${cell.ms.toFixed(1)} (${colorSpeedup(speedup)})`);
        }
        return row;
    });

    // Geometric-mean speedup row.  Skips scenarios where a config
    // errored out (cell === null) so a single failure doesn't tank
    // the column average; the count of contributing scenarios is
    // not surfaced (kept simple - error rows are visible above).
    const summary: string[] = ["geomean speedup"];
    for (let c = 0; c < CONFIGS.length; c++) {
        if (c === 0) {
            summary.push("1.00x");
            continue;
        }
        let logSum = 0;
        let count = 0;
        for (let s = 0; s < scenarios.length; s++) {
            const cell = results[s][c];
            if (cell === null || cell.speedup === undefined) continue;
            logSum += Math.log(cell.speedup);
            count++;
        }
        if (count === 0) {
            summary.push("-");
            continue;
        }
        summary.push(colorSpeedup(Math.exp(logSum / count)));
    }
    rows.push(summary);

    printAligned(header, rows);
}
