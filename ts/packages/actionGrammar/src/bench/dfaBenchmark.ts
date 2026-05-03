// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DFA vs NFA trade-off benchmark - informational only.
 *
 * Measures for real grammars (player, list, desktop, calendar, weather,
 * browser):
 *
 * SPACE
 *   - NFA state count vs DFA state count
 *   - Serialized size (KB) of each structure
 *
 * TIME
 *   - Compilation: grammar -> NFA, NFA -> DFA
 *   - Match (N iterations):
 *       . AST-walker matchGrammar (no optimizations vs all recommended)
 *       . NFA full match  - NFA threading + slot writes + action-value eval
 *       . NFA + first-token index dispatch
 *       . Pure DFA traversal (accept/reject only)
 *       . DFA hybrid (DFA pre-filter, NFA value computation)
 *       . DFA AST (DFA traversal + bottom-up value eval)
 *
 * Run with: `pnpm run bench:dfa` (from this package directory).
 */

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { loadGrammarRulesNoThrow } from "../grammarLoader.js";
import { compileGrammarToNFA } from "../nfaCompiler.js";
import { matchNFA } from "../nfaInterpreter.js";
import { normalizeToken } from "../nfaMatcher.js";
import { matchGrammar } from "../grammarMatcher.js";
import { recommendedOptimizations } from "../grammarOptimizer.js";
import {
    compileNFAToDFA,
    matchDFAWithSplitting,
    matchDFAToASTWithSplitting,
    evaluateMatchAST,
    tokenizeRequest,
    buildFirstTokenIndex,
    matchNFAWithIndex,
    type DFA,
    type FirstTokenIndex,
} from "../index.js";
import { registerBuiltInEntities } from "../builtInEntities.js";
import { colorSpeedup, printAligned } from "./benchUtil.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ITERATIONS = 1000;

function fileExists(filePath: string): boolean {
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

function timeMs(fn: () => void): number {
    const start = performance.now();
    fn();
    return performance.now() - start;
}

function timeMsN(fn: () => void, n: number): number {
    const start = performance.now();
    for (let i = 0; i < n; i++) fn();
    return performance.now() - start;
}

/**
 * Pure DFA state-machine traversal - no value computation, no phraseSet
 * membership check.  Represents the theoretical minimum: follow transitions
 * or wildcard, stop if stuck.  Used to isolate traversal cost from
 * everything else.
 */
function traverseDFAOnly(dfa: DFA, tokens: string[]): boolean {
    let stateId = dfa.startState;
    for (const raw of tokens) {
        const token = normalizeToken(raw);
        const state = dfa.states[stateId];
        if (!state) return false;
        let next: number | undefined;
        for (const t of state.transitions) {
            if (t.token === token) {
                next = t.to;
                break;
            }
        }
        if (next === undefined && state.phraseSetTransitions?.length) {
            next = state.phraseSetTransitions[0].to;
        }
        if (next === undefined && state.wildcardTransition) {
            next = state.wildcardTransition.to;
        }
        if (next === undefined) return false;
        stateId = next;
    }
    return dfa.states[stateId]?.accepting ?? false;
}

function sizeKb(obj: object): number {
    return JSON.stringify(obj).length / 1024;
}

// ─── Result types ────────────────────────────────────────────────────────────

interface SpaceResult {
    grammar: string;
    nfaStates: number;
    dfaStates: number;
    stateRatio: number;
    nfaSizeKb: number;
    dfaSizeKb: number;
    dfaTotalKb: number;
    memRatio: number;
}

interface TimingResult {
    grammar: string;
    request: string;
    matched: boolean;
    matchNoOptMs: number;
    matchOptMs: number;
    nfaMatchMs: number;
    nfaIndexMs: number;
    dfaTraverseMs: number;
    dfaHybridMs: number;
    dfaASTMs: number;
    matchNoOptMsPerCall: number;
    matchOptMsPerCall: number;
    nfaMatchMsPerCall: number;
    nfaIndexMsPerCall: number;
    dfaTraverseMsPerCall: number;
    dfaHybridMsPerCall: number;
    dfaASTMsPerCall: number;
    optSpeedup: number;
    indexSpeedup: number;
    hybridSpeedup: number;
    astSpeedup: number;
}

interface CompileResult {
    grammar: string;
    nfaCompileMs: number;
    dfaCompileMs: number;
    totalCompileMs: number;
}

// ─── Printing ────────────────────────────────────────────────────────────────

function printSpaceTable(rows: SpaceResult[]): void {
    if (!rows.length) return;

    console.log("\n╔══ SPACE ══════════════════════════════════════════════╗");
    const header = [
        "Grammar",
        "NFA states",
        "DFA states",
        "State ratio",
        "NFA (KB)",
        "DFA (KB)",
        "NFA+DFA (KB)",
        "Mem ratio",
    ];
    const data = rows.map((r) => [
        r.grammar,
        String(r.nfaStates),
        String(r.dfaStates),
        r.stateRatio.toFixed(2) + "x",
        r.nfaSizeKb.toFixed(1),
        r.dfaSizeKb.toFixed(1),
        r.dfaTotalKb.toFixed(1),
        r.memRatio.toFixed(2) + "x",
    ]);
    printAligned(header, data);
}

function printCompileTable(rows: CompileResult[]): void {
    if (!rows.length) return;

    console.log("\n╔══ COMPILATION TIME ════════════════════════════════════╗");
    const header = [
        "Grammar",
        "NFA compile (ms)",
        "DFA compile (ms)",
        "Total (ms)",
        "DFA overhead",
    ];
    const data = rows.map((r) => [
        r.grammar,
        r.nfaCompileMs.toFixed(2),
        r.dfaCompileMs.toFixed(2),
        r.totalCompileMs.toFixed(2),
        (r.dfaCompileMs / r.nfaCompileMs).toFixed(2) + "x",
    ]);
    printAligned(header, data);
}

function printTimingTable(rows: TimingResult[]): void {
    if (!rows.length) return;

    // Format "12.34 (1.5x)" with the speedup colored.  Padding is applied
    // by the table's printAligned which strips ANSI when measuring width.
    const fmt = (us: number, speedup: number): string =>
        `${us.toFixed(2)} (${colorSpeedup(speedup)})`;

    console.log(
        `\n╔══ MATCH TIMING (${ITERATIONS} iterations) ═══════════════════╗`,
    );
    const header = [
        "Grammar",
        "Request",
        "Match?",
        "AST no-opt μs/call",
        "AST opt μs/call",
        "NFA μs/call",
        "NFA+idx μs/call",
        "DFA trav μs/call",
        "DFA hybrid μs/call",
        "DFA AST μs/call",
    ];
    const data = rows.map((r) => [
        r.grammar,
        r.request.length > 30 ? r.request.slice(0, 27) + "..." : r.request,
        r.matched ? "✓" : "✗",
        r.matchNoOptMsPerCall.toFixed(2),
        fmt(r.matchOptMsPerCall, r.optSpeedup),
        r.nfaMatchMsPerCall.toFixed(2),
        fmt(r.nfaIndexMsPerCall, r.indexSpeedup),
        r.dfaTraverseMsPerCall.toFixed(2),
        fmt(r.dfaHybridMsPerCall, r.hybridSpeedup),
        fmt(r.dfaASTMsPerCall, r.astSpeedup),
    ]);
    printAligned(header, data);

    const matched = rows.filter((r) => r.matched);
    const unmatched = rows.filter((r) => !r.matched);
    const fmtAvg = (s: number) => colorSpeedup(s);
    if (matched.length) {
        const avgOpt =
            matched.reduce((s, r) => s + r.optSpeedup, 0) / matched.length;
        const avgIdx =
            matched.reduce((s, r) => s + r.indexSpeedup, 0) / matched.length;
        const avgHybrid =
            matched.reduce((s, r) => s + r.hybridSpeedup, 0) / matched.length;
        const avgAST =
            matched.reduce((s, r) => s + r.astSpeedup, 0) / matched.length;
        console.log(
            `  Avg speedup (matched):   opt=${fmtAvg(avgOpt)}  idx=${fmtAvg(avgIdx)}  hybrid=${fmtAvg(avgHybrid)}  ast=${fmtAvg(avgAST)}`,
        );
    }
    if (unmatched.length) {
        const avgOpt =
            unmatched.reduce((s, r) => s + r.optSpeedup, 0) / unmatched.length;
        const avgIdx =
            unmatched.reduce((s, r) => s + r.indexSpeedup, 0) /
            unmatched.length;
        const avgHybrid =
            unmatched.reduce((s, r) => s + r.hybridSpeedup, 0) /
            unmatched.length;
        const avgAST =
            unmatched.reduce((s, r) => s + r.astSpeedup, 0) / unmatched.length;
        console.log(
            `  Avg speedup (unmatched): opt=${fmtAvg(avgOpt)}  idx=${fmtAvg(avgIdx)}  hybrid=${fmtAvg(avgHybrid)}  ast=${fmtAvg(avgAST)}`,
        );
    }
}

/**
 * Compare the three "produces an AST / typed match value" variants:
 *   - AST opt  (matchGrammar with all recommended optimizations)
 *   - NFA+idx  (NFA threading with first-token index dispatch)
 *   - DFA AST  (DFA traversal + bottom-up value evaluation)
 *
 * For each row, the median of the three is taken as the baseline (1.00x)
 * and the other two are shown as `time (Nx)` where N = median / current.
 * Speedups above the green threshold in `colorSpeedup` are colored green;
 * speedups below the red threshold are colored red.
 */
function printASTComparisonTable(rows: TimingResult[]): void {
    if (!rows.length) return;

    console.log(`\n╔══ AST-PRODUCING VARIANTS (median = 1.00x baseline) ════╗`);
    const header = [
        "Grammar",
        "Request",
        "Match?",
        "AST opt μs/call",
        "NFA+idx μs/call",
        "DFA AST μs/call",
    ];

    const fmt = (us: number, speedup: number, isBase: boolean): string => {
        const usStr = us.toFixed(2);
        if (isBase) return `${usStr} (1.00x)`;
        return `${usStr} (${colorSpeedup(speedup)})`;
    };

    const data = rows.map((r) => {
        const values = [
            r.matchOptMsPerCall,
            r.nfaIndexMsPerCall,
            r.dfaASTMsPerCall,
        ];
        const sorted = [...values].sort((a, b) => a - b);
        const median = sorted[1];
        return [
            r.grammar,
            r.request.length > 30 ? r.request.slice(0, 27) + "..." : r.request,
            r.matched ? "✓" : "✗",
            fmt(values[0], median / values[0], values[0] === median),
            fmt(values[1], median / values[1], values[1] === median),
            fmt(values[2], median / values[2], values[2] === median),
        ];
    });
    printAligned(header, data);
}

function printCrossGrammarSummary(rows: SpaceResult[]): void {
    if (!rows.length) return;
    console.log("\n╔══ CROSS-GRAMMAR SUMMARY ═══════════════════════════════╗");
    const header = [
        "Grammar",
        "NFA states",
        "DFA states",
        "State ratio",
        "NFA (KB)",
        "DFA (KB)",
        "Total (KB)",
    ];
    const data = rows.map((r) => [
        r.grammar,
        String(r.nfaStates),
        String(r.dfaStates),
        r.stateRatio.toFixed(2) + "x",
        r.nfaSizeKb.toFixed(1),
        r.dfaSizeKb.toFixed(1),
        r.dfaTotalKb.toFixed(1),
    ]);
    printAligned(header, data);
}

// ─── Benchmark runner ────────────────────────────────────────────────────────

const spaceResults: SpaceResult[] = [];
const compileResults: CompileResult[] = [];
const timingResults: TimingResult[] = [];

function runBenchmark(
    grammarName: string,
    grammarPath: string,
    testRequests: string[],
): void {
    if (!fileExists(grammarPath)) {
        console.log(`Skipping ${grammarName}: grammar file not found`);
        return;
    }

    const content = fs.readFileSync(grammarPath, "utf-8");
    const errors: string[] = [];
    const grammar = loadGrammarRulesNoThrow(
        path.basename(grammarPath),
        content,
        errors,
    );
    if (!grammar || errors.length > 0) {
        console.log(`Skipping ${grammarName}: ${errors.join(", ")}`);
        return;
    }

    // ── AST-walker grammar variants ───────────────────────────────────
    // Two extra grammar instances for the AST-walking matcher
    // (`matchGrammar`): no optimizations vs all recommended
    // optimizations (inline + factor + tailFactoring + dispatch).
    const noOptErrors: string[] = [];
    const grammarNoOpt = loadGrammarRulesNoThrow(
        path.basename(grammarPath),
        content,
        noOptErrors,
        undefined,
        { optimizations: {} },
    );
    const optErrors: string[] = [];
    const grammarOpt = loadGrammarRulesNoThrow(
        path.basename(grammarPath),
        content,
        optErrors,
        undefined,
        { optimizations: recommendedOptimizations },
    );
    if (!grammarNoOpt || !grammarOpt) {
        console.log(
            `Skipping ${grammarName} AST variants: ` +
                [...noOptErrors, ...optErrors].join(", "),
        );
    }

    // ── Compilation ───────────────────────────────────────────────────
    let nfa: ReturnType<typeof compileGrammarToNFA>;
    const nfaCompileMs = timeMs(
        () => (nfa = compileGrammarToNFA(grammar, grammarName)),
    );

    let dfa: ReturnType<typeof compileNFAToDFA>;
    const dfaCompileMs = timeMs(
        () => (dfa = compileNFAToDFA(nfa!, grammarName)),
    );

    compileResults.push({
        grammar: grammarName,
        nfaCompileMs,
        dfaCompileMs,
        totalCompileMs: nfaCompileMs + dfaCompileMs,
    });

    // ── Space ─────────────────────────────────────────────────────────
    const nfaSizeKb = sizeKb(nfa!);
    const dfaOnly = { ...dfa!, sourceNFA: undefined };
    const dfaSizeKb = sizeKb(dfaOnly);
    const dfaTotalKb = nfaSizeKb + dfaSizeKb;

    spaceResults.push({
        grammar: grammarName,
        nfaStates: nfa!.states.length,
        dfaStates: dfa!.states.length,
        stateRatio: dfa!.states.length / nfa!.states.length,
        nfaSizeKb,
        dfaSizeKb,
        dfaTotalKb,
        memRatio: dfaSizeKb / nfaSizeKb,
    });

    // ── Build first-token index ───────────────────────────────────────
    let index: FirstTokenIndex;
    const indexBuildMs = timeMs(() => (index = buildFirstTokenIndex(nfa!)));
    console.log(
        `  ${grammarName} index: ${index!.tokenMap.size} first-token entries, ` +
            `hasWildcardStart=${index!.hasWildcardStart}, built in ${indexBuildMs.toFixed(2)} ms`,
    );

    // ── Per-request timing ────────────────────────────────────────────
    for (const request of testRequests) {
        const tokens = tokenizeRequest(request);

        // Warm up JIT
        matchNFA(nfa!, tokens, false);
        matchNFAWithIndex(nfa!, index!, tokens, false);
        matchDFAWithSplitting(dfa!, tokens);
        traverseDFAOnly(dfa!, tokens);
        {
            const r = matchDFAToASTWithSplitting(dfa!, tokens);
            if (r.ast) evaluateMatchAST(r.ast, grammar);
        }
        if (grammarNoOpt) matchGrammar(grammarNoOpt, request);
        if (grammarOpt) matchGrammar(grammarOpt, request);

        const matchNoOptMs = grammarNoOpt
            ? timeMsN(() => matchGrammar(grammarNoOpt, request), ITERATIONS)
            : 0;

        const matchOptMs = grammarOpt
            ? timeMsN(() => matchGrammar(grammarOpt, request), ITERATIONS)
            : 0;

        const nfaMatchMs = timeMsN(
            () => matchNFA(nfa!, tokens, false),
            ITERATIONS,
        );

        const nfaIndexMs = timeMsN(
            () => matchNFAWithIndex(nfa!, index!, tokens, false),
            ITERATIONS,
        );

        const dfaTraverseMs = timeMsN(
            () => traverseDFAOnly(dfa!, tokens),
            ITERATIONS,
        );

        const dfaHybridMs = timeMsN(
            () => matchDFAWithSplitting(dfa!, tokens),
            ITERATIONS,
        );

        const dfaASTMs = timeMsN(() => {
            const r = matchDFAToASTWithSplitting(dfa!, tokens);
            if (r.ast) evaluateMatchAST(r.ast, grammar);
        }, ITERATIONS);

        const matched = matchNFA(nfa!, tokens, false).matched;

        timingResults.push({
            grammar: grammarName,
            request,
            matched,
            matchNoOptMs,
            matchOptMs,
            nfaMatchMs,
            nfaIndexMs,
            dfaTraverseMs,
            dfaHybridMs,
            dfaASTMs,
            matchNoOptMsPerCall: (matchNoOptMs / ITERATIONS) * 1000,
            matchOptMsPerCall: (matchOptMs / ITERATIONS) * 1000,
            nfaMatchMsPerCall: (nfaMatchMs / ITERATIONS) * 1000,
            nfaIndexMsPerCall: (nfaIndexMs / ITERATIONS) * 1000,
            dfaTraverseMsPerCall: (dfaTraverseMs / ITERATIONS) * 1000,
            dfaHybridMsPerCall: (dfaHybridMs / ITERATIONS) * 1000,
            dfaASTMsPerCall: (dfaASTMs / ITERATIONS) * 1000,
            optSpeedup: matchOptMs > 0 ? matchNoOptMs / matchOptMs : 0,
            indexSpeedup: nfaIndexMs > 0 ? nfaMatchMs / nfaIndexMs : 0,
            hybridSpeedup: dfaHybridMs > 0 ? nfaMatchMs / dfaHybridMs : 0,
            astSpeedup: dfaASTMs > 0 ? nfaMatchMs / dfaASTMs : 0,
        });
    }
}

// ─── Grammars ────────────────────────────────────────────────────────────────
//
// Paths are resolved relative to this file's compiled location
// (`dist/bench/`).  They point at sibling agent packages via
// `../../../agents/<name>/...` and assume the standard `packages/`
// layout in the workspace.  Missing grammar files are skipped
// silently (see `runBenchmark`'s `fileExists` check) so partial
// checkouts still produce a partial table.

interface GrammarSpec {
    name: string;
    path: string;
    requests: string[];
}

const GRAMMARS: GrammarSpec[] = [
    {
        name: "player",
        path: path.resolve(
            __dirname,
            "../../../agents/player/src/agent/playerSchema.agr",
        ),
        requests: [
            "pause",
            "resume",
            "play Shake It Off by Taylor Swift",
            "select kitchen",
            "set volume to 50",
            "play the first track",
            "play some music",
            "skip to the next track",
        ],
    },
    {
        name: "list",
        path: path.resolve(
            __dirname,
            "../../../agents/list/src/listSchema.agr",
        ),
        requests: [
            "add milk to my shopping list",
            "add eggs and bread to the grocery list",
            "remove bananas from my shopping list",
            "create a new todo list",
            "what's on the shopping list",
            "show me my grocery list",
            "clear my todo list",
            "buy some groceries",
            "rename the todo list",
        ],
    },
    {
        name: "desktop",
        path: path.resolve(
            __dirname,
            "../../../agents/desktop/src/desktopSchema.agr",
        ),
        requests: [
            "open chrome",
            "launch visual studio code",
            "close notepad",
            "maximize excel",
            "tile notepad and calculator",
            "set volume to 75",
            "mute",
            "enable dark mode",
            "connect to home wifi",
            "increase brightness",
            "install visual studio",
            "shutdown the computer",
        ],
    },
    {
        name: "calendar",
        path: path.resolve(
            __dirname,
            "../../../agents/calendar/src/calendarSchema.agr",
        ),
        requests: [
            "schedule a team meeting for Friday at 2pm in conference room B with Alice",
            "set up lunch with clients on Monday at noon",
            "find all events on Tuesday that include Bob",
            "show me meetings about Q1 planning scheduled for next week",
            "include Charlie in the project review",
            "what do I have scheduled for today",
            "what's happening this week",
            "delete my calendar event",
            "reschedule the meeting",
        ],
    },
    {
        name: "weather",
        path: path.resolve(
            __dirname,
            "../../../agents/weather/src/weatherSchema.agr",
        ),
        requests: [
            "what's the weather like in New York",
            "current weather in London",
            "forecast for Chicago for the next 5 days in celsius",
            "weather forecast for Seattle",
            "weather alerts for Miami",
            "can you check the current conditions in Tokyo",
            "when will it rain in Boston",
            "what's the temperature",
        ],
    },
    {
        name: "browser",
        path: path.resolve(
            __dirname,
            "../../../agents/browser/src/agent/browserSchema.agr",
        ),
        requests: [
            "open google.com",
            "navigate to github.com",
            "close the tab",
            "close all tabs",
            "go back",
            "refresh the page",
            "click on the sign up link",
            "switch to tab 3",
            "zoom in",
            "take a screenshot",
            "bookmark this page",
            "print the page",
        ],
    },
];

function main(): void {
    registerBuiltInEntities();

    for (const g of GRAMMARS) {
        runBenchmark(g.name, g.path, g.requests);
    }

    printSpaceTable(spaceResults);
    printCompileTable(compileResults);
    printTimingTable(timingResults);
    printASTComparisonTable(timingResults);
    printCrossGrammarSummary(spaceResults);
}

main();
