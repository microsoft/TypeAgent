// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DFA vs NFA trade-off benchmark
 *
 * Measures for real grammars (player, etc.):
 *
 * SPACE
 *   - NFA state count vs DFA state count
 *   - Serialized size (KB) of each structure
 *
 * TIME
 *   - Compilation: grammar → NFA, NFA → DFA
 *   - Match (N iterations):
 *       · NFA full match  — NFA threading + slot writes + action-value eval
 *       · DFA traversal   — pure state-machine walk, no slot ops, no value eval
 *       · Value overhead  — ratio NFA/DFA-traversal (how much value computation costs)
 *
 * All assertions are informational (expect(...).toBeDefined()).
 */

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { loadGrammarRulesNoThrow } from "../src/grammarLoader.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchNFA } from "../src/nfaInterpreter.js";
import { normalizeToken } from "../src/nfaMatcher.js";
import {
    compileNFAToDFA,
    matchDFAWithSplitting,
    tokenizeRequest,
    buildFirstTokenIndex,
    matchNFAWithIndex,
    type DFA,
    type FirstTokenIndex,
} from "../src/index.js";
import { registerBuiltInEntities } from "../src/builtInEntities.js";

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
 * Pure DFA state-machine traversal — no value computation, no phraseSet membership check.
 * Represents the theoretical minimum: follow transitions or wildcard, stop if stuck.
 * Used to isolate traversal cost from everything else.
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
        // Conservative phraseSet: assume any token could start a phrase
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

/**
 * Estimate serialized size of an object in KB (JSON proxy for heap footprint).
 * For the DFA we exclude the sourceNFA back-reference (it's a reference, not
 * unique data), so we get the size of the compiled DFA structure only.
 */
function sizeKb(obj: object): number {
    return JSON.stringify(obj).length / 1024;
}

// ─── Result types ────────────────────────────────────────────────────────────

interface SpaceResult {
    grammar: string;
    nfaStates: number;
    dfaStates: number;
    stateRatio: number; // dfaStates / nfaStates
    nfaSizeKb: number;
    dfaSizeKb: number; // DFA without sourceNFA
    dfaTotalKb: number; // DFA + NFA (what you pay if you want both)
    memRatio: number; // dfaSizeKb / nfaSizeKb
}

interface TimingResult {
    grammar: string;
    request: string;
    matched: boolean;
    nfaMatchMs: number; // NFA full match (threading + value eval)
    nfaIndexMs: number; // NFA with first-token index dispatch
    dfaTraverseMs: number; // pure DFA traversal (accept/reject only)
    dfaHybridMs: number; // DFA pre-filter + NFA only when accepted
    nfaMatchMsPerCall: number; // μs/call
    nfaIndexMsPerCall: number; // μs/call
    dfaTraverseMsPerCall: number; // μs/call
    dfaHybridMsPerCall: number; // μs/call
    indexSpeedup: number; // nfaMatchMs / nfaIndexMs
    hybridSpeedup: number; // nfaMatchMs / dfaHybridMs
}

interface CompileResult {
    grammar: string;
    nfaCompileMs: number;
    dfaCompileMs: number; // NFA→DFA step only
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

    console.log(
        `\n╔══ MATCH TIMING (${ITERATIONS} iterations) ═══════════════════╗`,
    );
    const header = [
        "Grammar",
        "Request",
        "Match?",
        "NFA μs/call",
        "NFA+idx μs/call",
        "DFA trav μs/call",
        "DFA hybrid μs/call",
        "Idx speedup",
        "Hybrid speedup",
    ];
    const data = rows.map((r) => [
        r.grammar,
        r.request.length > 30 ? r.request.slice(0, 27) + "..." : r.request,
        r.matched ? "✓" : "✗",
        r.nfaMatchMsPerCall.toFixed(2),
        r.nfaIndexMsPerCall.toFixed(2),
        r.dfaTraverseMsPerCall.toFixed(2),
        r.dfaHybridMsPerCall.toFixed(2),
        r.indexSpeedup.toFixed(1) + "x",
        r.hybridSpeedup.toFixed(1) + "x",
    ]);
    printAligned(header, data);

    const matched = rows.filter((r) => r.matched);
    const unmatched = rows.filter((r) => !r.matched);
    if (matched.length) {
        const avgIdx =
            matched.reduce((s, r) => s + r.indexSpeedup, 0) / matched.length;
        const avgHybrid =
            matched.reduce((s, r) => s + r.hybridSpeedup, 0) / matched.length;
        console.log(
            `  Avg speedup (matched):   idx=${avgIdx.toFixed(1)}x  hybrid=${avgHybrid.toFixed(1)}x`,
        );
    }
    if (unmatched.length) {
        const avgIdx =
            unmatched.reduce((s, r) => s + r.indexSpeedup, 0) /
            unmatched.length;
        const avgHybrid =
            unmatched.reduce((s, r) => s + r.hybridSpeedup, 0) /
            unmatched.length;
        console.log(
            `  Avg speedup (unmatched): idx=${avgIdx.toFixed(1)}x  hybrid=${avgHybrid.toFixed(1)}x`,
        );
    }
}

function printAligned(header: string[], rows: string[][]): void {
    const widths = header.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
    );
    const sep = widths.map((w) => "-".repeat(w)).join(" | ");
    const fmt = (row: string[]) =>
        row.map((c, i) => (c ?? "").padStart(widths[i])).join(" | ");
    console.log(fmt(header));
    console.log(sep);
    for (const row of rows) console.log(fmt(row));
    console.log();
}

// ─── Benchmark runner ────────────────────────────────────────────────────────

describe("DFA vs NFA Benchmark", () => {
    registerBuiltInEntities();

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
        // DFA structure only (exclude sourceNFA back-reference)
        const dfaOnly = { ...dfa!, sourceNFA: undefined };
        const dfaSizeKb = sizeKb(dfaOnly);
        // Total memory if you keep both NFA and DFA in RAM
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

            // NFA full match (threading + slot ops + value eval) — baseline
            const nfaMatchMs = timeMsN(
                () => matchNFA(nfa!, tokens, false),
                ITERATIONS,
            );

            // NFA with first-token index dispatch
            const nfaIndexMs = timeMsN(
                () => matchNFAWithIndex(nfa!, index!, tokens, false),
                ITERATIONS,
            );

            // Pure DFA traversal (accept/reject decision only, no value)
            const dfaTraverseMs = timeMsN(
                () => traverseDFAOnly(dfa!, tokens),
                ITERATIONS,
            );

            // DFA hybrid = matchDFAWithSplitting which now does:
            //   DFA pre-filter → fast reject OR DFA accept → NFA value computation
            const dfaHybridMs = timeMsN(
                () => matchDFAWithSplitting(dfa!, tokens),
                ITERATIONS,
            );

            const matched = matchNFA(nfa!, tokens, false).matched;

            timingResults.push({
                grammar: grammarName,
                request,
                matched,
                nfaMatchMs,
                nfaIndexMs,
                dfaTraverseMs,
                dfaHybridMs,
                nfaMatchMsPerCall: (nfaMatchMs / ITERATIONS) * 1000,
                nfaIndexMsPerCall: (nfaIndexMs / ITERATIONS) * 1000,
                dfaTraverseMsPerCall: (dfaTraverseMs / ITERATIONS) * 1000,
                dfaHybridMsPerCall: (dfaHybridMs / ITERATIONS) * 1000,
                indexSpeedup: nfaIndexMs > 0 ? nfaMatchMs / nfaIndexMs : 0,
                hybridSpeedup: dfaHybridMs > 0 ? nfaMatchMs / dfaHybridMs : 0,
            });
        }
    }

    afterAll(() => {
        printSpaceTable(spaceResults);
        printCompileTable(compileResults);
        printTimingTable(timingResults);
    });

    // ── Player grammar ────────────────────────────────────────────────────────
    describe("Player Grammar", () => {
        const playerGrammarPath = path.resolve(
            __dirname,
            "../../../agents/player/src/agent/playerSchema.agr",
        );

        // Mix of matching and non-matching requests to show value-computation
        // overhead in both cases.
        const testRequests = [
            // Literal-only (matched) — minimal value computation
            "pause",
            "resume",
            // Wildcard (matched) — slot writes + string join
            "play Shake It Off by Taylor Swift",
            "select kitchen",
            // Number entity (matched) — entity validation + slot write
            "set volume to 50",
            // Ordinal entity (matched)
            "play the first track",
            // Non-matching inputs — NFA threads die early
            "play some music",
            "skip to the next track",
        ];

        it("benchmarks NFA vs DFA on player grammar", () => {
            runBenchmark("player", playerGrammarPath, testRequests);
            expect(spaceResults.length).toBeGreaterThanOrEqual(0);
        });

        it("state count ratio is defined", () => {
            const r = spaceResults.find((s) => s.grammar === "player");
            if (r) {
                expect(r.stateRatio).toBeDefined();
                console.log(
                    `Player: NFA=${r.nfaStates} states (${r.nfaSizeKb.toFixed(1)} KB), ` +
                        `DFA=${r.dfaStates} states (${r.dfaSizeKb.toFixed(1)} KB), ` +
                        `state-ratio=${r.stateRatio.toFixed(2)}x`,
                );
            } else {
                expect(true).toBe(true); // grammar not available — skip
            }
        });
    });
});
