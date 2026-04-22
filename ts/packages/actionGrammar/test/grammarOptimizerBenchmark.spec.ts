// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Optimizer benchmark — informational only.
 *
 * Measures matcher-time impact of each grammar optimization pass on real
 * grammars (player, list, calendar, browser, ...).  Each configuration is
 * compared against the unoptimized baseline.
 *
 * All assertions are informational.  This spec runs as part of the normal
 * test suite but produces no hard failures — only console output.
 *
 * To skip (e.g. on slow machines), set TYPEAGENT_SKIP_BENCHMARKS=1.
 */

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import {
    loadGrammarRulesNoThrow,
    LoadGrammarRulesOptions,
} from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { registerBuiltInEntities } from "../src/builtInEntities.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ITERATIONS = 500;
const SHOULD_SKIP = process.env.TYPEAGENT_SKIP_BENCHMARKS === "1";

function fileExists(p: string): boolean {
    try {
        fs.accessSync(p, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

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
    const visit = (parts: any[]) => {
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

function benchmark(
    label: string,
    grammarPath: string,
    requests: string[],
): void {
    if (!fileExists(grammarPath)) {
        console.log(`[skip] ${label}: grammar not found at ${grammarPath}`);
        return;
    }
    registerBuiltInEntities();
    const content = fs.readFileSync(grammarPath, "utf-8");
    const configs: { name: string; opts: LoadGrammarRulesOptions }[] = [
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

    console.log(`\n=== ${label} ===`);
    console.log(
        `| config    | RulesParts | match ms (${ITERATIONS}x) | speedup |`,
    );
    console.log(`|-----------|------------|----------------|---------|`);

    let baselineMs = 0;
    for (const cfg of configs) {
        const errors: string[] = [];
        const g = loadGrammarRulesNoThrow(
            path.basename(grammarPath),
            content,
            errors,
            undefined,
            cfg.opts,
        );
        if (!g) {
            console.log(`[error] ${cfg.name}: ${errors.join("; ")}`);
            continue;
        }
        const partCount = countRulesParts(g);
        // Warm-up — also validates that the optimized grammar can run.
        try {
            for (const r of requests) matchGrammar(g, r);
        } catch (e) {
            console.log(
                `[error] ${cfg.name} match failed: ${(e as Error).message}`,
            );
            continue;
        }
        // Timed.
        const ms = timeMs(() => {
            for (const r of requests) matchGrammar(g, r);
        }, ITERATIONS);
        if (cfg.name === "baseline") baselineMs = ms;
        const speedup = baselineMs > 0 ? baselineMs / ms : 1;
        console.log(
            `| ${cfg.name.padEnd(9)} | ${String(partCount).padStart(10)} | ${ms.toFixed(1).padStart(14)} | ${speedup.toFixed(2)}x`,
        );
    }
}

describe("Grammar Optimizer Benchmark", () => {
    (SHOULD_SKIP ? it.skip : it)("player", () => {
        benchmark(
            "player",
            path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            ),
            [
                "pause",
                "resume",
                "play Shake It Off by Taylor Swift",
                "select kitchen",
                "set volume to 50",
                "play the first track",
                "skip to the next track",
                "play some music",
            ],
        );
        expect(true).toBe(true);
    });

    (SHOULD_SKIP ? it.skip : it)("list", () => {
        benchmark(
            "list",
            path.resolve(__dirname, "../../../agents/list/src/listSchema.agr"),
            [
                "add apples to grocery list",
                "remove milk from grocery list",
                "create list shopping",
                "clear grocery list",
            ],
        );
        expect(true).toBe(true);
    });

    (SHOULD_SKIP ? it.skip : it)("calendar", () => {
        benchmark(
            "calendar",
            path.resolve(
                __dirname,
                "../../../agents/calendar/src/calendarSchema.agr",
            ),
            [
                "schedule meeting tomorrow at 3pm",
                "cancel my 2pm meeting",
                "show my calendar",
            ],
        );
        expect(true).toBe(true);
    });
});
