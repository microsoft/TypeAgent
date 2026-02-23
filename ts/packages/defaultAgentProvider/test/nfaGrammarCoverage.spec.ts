// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * NFA Grammar Coverage Benchmark
 *
 * Measures how many ExplanationTestData constructions the NFA grammar matcher
 * can round-trip vs the original (character-based) grammar matcher. Outputs a
 * coverage table similar to `pnpm run cli data stat --all`, broken down by
 * data file.
 *
 * This test always passes — it is informational/diagnostic, not a hard gate.
 * Run `npm test -- --verbose` to see the printed table.
 */

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import {
    createSchemaInfoProvider,
    getCacheFactory,
    readExplanationTestData,
    getAllActionConfigProvider,
} from "agent-dispatcher/internal";
import { fromJsonActions, RequestAction } from "agent-cache";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";
import { glob } from "glob";
import {
    loadGrammarRulesNoThrow,
    matchGrammar,
    compileGrammarToNFA,
    matchGrammarWithNFA,
} from "action-grammar";
import { convertConstructionsToGrammar } from "agent-cache/grammar";
import path from "path";

// ── Data loading ─────────────────────────────────────────────────────────────

const dataFiles = ["test/data/explanations/**/v5/*.json"];
const filePaths = (await glob(dataFiles)).sort();

const schemaInfoProvider = createSchemaInfoProvider(
    (await getAllActionConfigProvider(getDefaultAppAgentProviders(undefined)))
        .provider,
);

// ── Stats types ──────────────────────────────────────────────────────────────

interface MatcherStats {
    matched: number;
    total: number;
    errors: number;
}

interface FileStats {
    old: MatcherStats;
    nfa: MatcherStats;
}

function emptyStats(): FileStats {
    return {
        old: { matched: 0, total: 0, errors: 0 },
        nfa: { matched: 0, total: 0, errors: 0 },
    };
}

// ── Coverage collection ───────────────────────────────────────────────────────

interface MissEntry {
    file: string;
    request: string;
    grammarText: string;
}

const statsByFile = new Map<string, FileStats>();
const totals = emptyStats();
const misses: MissEntry[] = [];

for (const filePath of filePaths) {
    const fileName = path.basename(filePath, ".json");
    const stats = emptyStats();
    statsByFile.set(fileName, stats);

    const data = await readExplanationTestData(filePath);

    for (const entry of data.entries) {
        const requestAction = new RequestAction(
            entry.request,
            fromJsonActions(entry.action),
        );

        // Build a construction from the stored explanation, then convert to
        // grammar text.  Mirrors the flow in grammar.spec.ts; entries that
        // fail construction are skipped (counted neither as match nor miss).
        let grammarText: string | undefined;
        try {
            const explainer = getCacheFactory().getExplainer(
                [data.schemaName],
                data.explainerName,
            );
            const construction = explainer.createConstruction!(
                requestAction,
                entry.explanation as object,
                { schemaInfoProvider },
            );
            const text = convertConstructionsToGrammar([construction]);
            grammarText = text !== "" ? text : undefined;
        } catch {
            // Construction failed — skip entry
        }

        if (grammarText === undefined) {
            continue;
        }

        const grammarErrors: string[] = [];
        const grammar = loadGrammarRulesNoThrow(
            "coverage",
            grammarText,
            grammarErrors,
        );

        if (grammar === undefined) {
            // Grammar text itself was invalid — count as error for both
            stats.old.errors++;
            stats.nfa.errors++;
            totals.old.errors++;
            totals.nfa.errors++;
            continue;
        }

        const request = requestAction.request;

        // Old (character-based) matcher
        stats.old.total++;
        totals.old.total++;
        try {
            if (matchGrammar(grammar, request).length > 0) {
                stats.old.matched++;
                totals.old.matched++;
            }
        } catch {
            stats.old.errors++;
            totals.old.errors++;
        }

        // NFA matcher
        stats.nfa.total++;
        totals.nfa.total++;
        try {
            const nfa = compileGrammarToNFA(grammar);
            if (matchGrammarWithNFA(grammar, nfa, request).length > 0) {
                stats.nfa.matched++;
                totals.nfa.matched++;
            } else {
                misses.push({ file: fileName, request, grammarText });
            }
        } catch {
            stats.nfa.errors++;
            totals.nfa.errors++;
        }
    }
}

// ── Table formatting ──────────────────────────────────────────────────────────

function pct(n: number, d: number): string {
    return d === 0 ? "   n/a" : `${((n / d) * 100).toFixed(1).padStart(5)}%`;
}

function fmtStats(s: MatcherStats): string {
    const errSuffix = s.errors > 0 ? ` (${s.errors} err)` : "";
    return `${String(s.matched).padStart(4)}/${String(s.total).padStart(4)} ${pct(s.matched, s.total)}${errSuffix}`;
}

function buildTable(): string {
    const COL1 = 30;
    const header =
        "File".padEnd(COL1) +
        " | Old Matcher            | NFA Matcher";
    const sep = "-".repeat(header.length);
    const lines = [sep, header, sep];

    for (const [file, s] of statsByFile) {
        lines.push(
            file.padEnd(COL1) +
                ` | ${fmtStats(s.old).padEnd(22)} | ${fmtStats(s.nfa)}`,
        );
    }

    lines.push(sep);
    lines.push(
        "TOTAL".padEnd(COL1) +
            ` | ${fmtStats(totals.old).padEnd(22)} | ${fmtStats(totals.nfa)}`,
    );
    lines.push(sep);
    return lines.join("\n");
}

// ── Test ──────────────────────────────────────────────────────────────────────

describe("NFA Grammar Coverage", () => {
    it("reports NFA match rate vs old matcher per action file (informational)", () => {
        console.log("\n" + buildTable() + "\n");
        if (misses.length > 0) {
            console.log(`NFA misses (${misses.length}):`);
            for (const m of misses) {
                console.log(`  [${m.file}] "${m.request}"\n    grammar: ${m.grammarText}`);
            }
        }

        // Structural assertions — not a coverage gate, just sanity checks.
        // NFA must process the same number of entries as the old matcher.
        expect(totals.nfa.total).toBe(totals.old.total);
        // Neither matcher should throw during normal operation.
        expect(totals.old.errors).toBe(0);
        expect(totals.nfa.errors).toBe(0);
    });
});
