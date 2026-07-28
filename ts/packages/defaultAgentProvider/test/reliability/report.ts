// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Aggregates the per-suite reliability tallies written by translateTestCommon.ts
// (when TRANSLATION_RELIABILITY_DIR is set) into a single suite-wide reliability
// doc: the mean number of translation tokens between flaky failures across all
// translation test suites. Higher = more reliable.
//
// Each run is also appended to reliability/history.json (kept in git) so the doc
// can chart the reliability trend over time. The charts are emitted as mermaid
// `xychart-beta` blocks, which GitHub renders inline in the markdown.
//
// Compiled to dist/test/reliability/report.js.
// Usage: node report.js <resultsDir> <outDocPath> [modelName]

import fs from "node:fs";
import path from "node:path";

// Per-suite tally written by translateTestCommon.ts (one JSON file per suite).
type SuiteTally = {
    name: string;
    attempts: number;
    failures: number;
    variations: number;
    tokens: number;
};

// One recorded run, appended to history.json so the doc can chart the trend.
// Raw counts are stored (not derived MTTF values) so past points recompute
// consistently if the MTTF formula changes.
type HistoryEntry = {
    generated: string;
    model: string;
    suites: number;
    attempts: number;
    failures: number;
    variations: number;
    tokens: number;
};

const HISTORY_FILE = "history.json";
// Most-recent runs shown in the history table and trend charts.
const HISTORY_SHOWN = 25;

function fmt(n: number): string {
    return n.toLocaleString("en-US");
}

// Mean tokens between events. With zero events in a run MTTF is unbounded, so use
// the run's token total as a lower bound to keep the value finite and chartable.
function mttfTokens(tokens: number, events: number): number {
    return events > 0 ? Math.round(tokens / events) : tokens;
}

// Prose form of the MTTF, spelling out the zero-event lower-bound case.
function mttfLabel(tokens: number, events: number): string {
    return events > 0
        ? `${fmt(Math.round(tokens / events))} tokens`
        : `no events this run (\u2265 ${fmt(tokens)} tokens)`;
}

// Compact table-cell form: the number, or "≥N" for the zero-event lower bound.
function mttfCell(tokens: number, events: number): string {
    return events > 0
        ? fmt(Math.round(tokens / events))
        : `\u2265 ${fmt(tokens)}`;
}

// A single-series mermaid line chart. GitHub renders `xychart-beta` fenced blocks
// inline, so the trend graphs directly in the markdown. xychart-beta has no
// legend, so each series is charted separately under its own title.
function lineChart(
    title: string,
    labels: string[],
    series: number[],
): string[] {
    const max = Math.max(1, ...series);
    const top = Math.ceil((max * 1.1) / 100000) * 100000 || 100000;
    return [
        "```mermaid",
        "xychart-beta",
        `    title "${title}"`,
        `    x-axis [${labels.join(", ")}]`,
        `    y-axis "Tokens between events" 0 --> ${top}`,
        `    line [${series.join(", ")}]`,
        "```",
    ];
}

function main(): void {
    const resultsDir = process.argv[2];
    const outDoc = process.argv[3];
    const modelName = process.argv[4];
    if (!resultsDir || !outDoc) {
        console.error(
            "Usage: node report.js <resultsDir> <outDocPath> [modelName]",
        );
        process.exit(1);
    }

    const files = fs.existsSync(resultsDir)
        ? fs.readdirSync(resultsDir).filter((f) => f.endsWith(".json"))
        : [];
    if (files.length === 0) {
        console.error(
            `No tally JSON files in '${resultsDir}'. Run the translate suite ` +
                `with TRANSLATION_RELIABILITY_DIR set to that directory first.`,
        );
        process.exit(1);
    }

    const suites: SuiteTally[] = files
        .map(
            (f) =>
                JSON.parse(
                    fs.readFileSync(path.join(resultsDir, f), "utf-8"),
                ) as SuiteTally,
        )
        .sort((a, b) => a.name.localeCompare(b.name));

    let attempts = 0;
    let failures = 0;
    let variations = 0;
    let tokens = 0;
    for (const s of suites) {
        attempts += s.attempts;
        failures += s.failures;
        variations += s.variations;
        tokens += s.tokens;
    }
    const perAttempt = attempts > 0 ? Math.round(tokens / attempts) : 0;
    const generated = new Date().toISOString();
    const model = modelName ?? "(default)";

    // Append this run to the persisted history.
    const historyPath = path.join(path.dirname(outDoc), HISTORY_FILE);
    const history: HistoryEntry[] = fs.existsSync(historyPath)
        ? (JSON.parse(fs.readFileSync(historyPath, "utf-8")) as HistoryEntry[])
        : [];
    history.push({
        generated,
        model,
        suites: suites.length,
        attempts,
        failures,
        variations,
        tokens,
    });
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");

    // Chart/table the most recent runs; ordinals tie chart x-axis to table rows.
    const recent = history.slice(-HISTORY_SHOWN);
    const startOrdinal = history.length - recent.length + 1;
    const labels = recent.map((_, i) => `"#${startOrdinal + i}"`);
    const failSeries = recent.map((h) => mttfTokens(h.tokens, h.failures));
    const varSeries = recent.map((h) => mttfTokens(h.tokens, h.variations));

    const lines: string[] = [
        "# Translation test reliability",
        "",
        "Suite-wide reliability of the live translation-stability tests",
        "(`packages/defaultAgentProvider/test/translate*.test.ts`), measured as the",
        "**mean number of translation tokens between flaky failures, across all suites**",
        "(MTTF-in-tokens; higher = more reliable).",
        "",
        "Auto-generated by `reliability/report.ts` (compiled to",
        "`dist/test/reliability/report.js`) - do not edit by hand.",
        "",
        "## Latest run",
        "",
        `- Generated: ${generated}`,
        `- Model: ${model}`,
        `- Suites: ${suites.length}`,
        `- Attempts (all suites): ${fmt(attempts)}`,
        `- Translation tokens (all suites): ${fmt(tokens)}`,
        `- Mean tokens / attempt: ${fmt(perAttempt)}`,
        "",
        "| Metric | Events | MTTF (tokens between) |",
        "|---|--:|--:|",
        `| Test failures (assertion red) | ${failures} | ${mttfLabel(tokens, failures)} |`,
        `| Outcome variations (model non-determinism) | ${variations} | ${mttfLabel(tokens, variations)} |`,
        "",
        "## Reliability trend",
        "",
        `Across the last ${recent.length} run(s) (of ${history.length} recorded). Each`,
        "point is one suite run; higher MTTF-in-tokens = more reliable. GitHub renders",
        "the charts inline; the table below carries the same data for other viewers.",
        "",
        ...lineChart(
            "Tokens between test failures (higher = more reliable)",
            labels,
            failSeries,
        ),
        "",
        ...lineChart(
            "Tokens between outcome variations (higher = more reliable)",
            labels,
            varSeries,
        ),
        "",
        "| # | Generated | Model | Attempts | Failures | Variations | Tokens | MTTF failures | MTTF variations |",
        "|--:|---|---|--:|--:|--:|--:|--:|--:|",
        ...recent.map((h, i) => {
            const n = startOrdinal + i;
            return (
                `| ${n} | ${h.generated} | ${h.model} | ${fmt(h.attempts)} | ` +
                `${h.failures} | ${h.variations} | ${fmt(h.tokens)} | ` +
                `${mttfCell(h.tokens, h.failures)} | ${mttfCell(h.tokens, h.variations)} |`
            );
        }),
        "",
        "## Per-suite (latest run)",
        "",
        "| Suite | Attempts | Failures | Variations | Tokens |",
        "|---|--:|--:|--:|--:|",
        ...suites.map(
            (s) =>
                `| ${s.name} | ${fmt(s.attempts)} | ${s.failures} | ${s.variations} | ${fmt(s.tokens)} |`,
        ),
        "",
        "## What the numbers mean",
        "",
        "- **Test failures** are attempts where the assertion went red (the suite's real",
        "  reliability - a flaky failure the CI would surface).",
        "- **Outcome variations** are attempts whose action signature differed from the",
        "  modal signature for the same request. This is the leading indicator of",
        "  flakiness: it counts run-to-run model non-determinism even when the assertion",
        "  tolerated it (e.g. an `anyof` clarify or a `duplicateOfPrevious` extra action).",
        "- Only the LLM **translation** step's tokens are counted; grammar/cache-resolved",
        "  attempts consume no translation tokens and are deterministic, so they neither",
        "  add tokens nor cause flaky failures.",
        "- When a run has zero events, MTTF is unbounded; the charts and `≥` cells use",
        "  the run's token total as a lower bound.",
        "",
        "## Regenerate",
        "",
        "From `ts/`:",
        "",
        "```powershell",
        '$env:TRANSLATION_RELIABILITY_DIR = "$PWD/tmp/reliability"',
        "Remove-Item $env:TRANSLATION_RELIABILITY_DIR -Recurse -Force -ErrorAction SilentlyContinue",
        "pnpm --filter default-agent-provider build",
        "Push-Location packages/defaultAgentProvider",
        "pnpm run jest-esm --testPathPattern=translate --forceExit",
        "Pop-Location",
        "node packages/defaultAgentProvider/dist/test/reliability/report.js tmp/reliability packages/defaultAgentProvider/test/reliability/README.md <model>",
        "Remove-Item Env:\\TRANSLATION_RELIABILITY_DIR",
        "```",
        "",
        "Each run appends one point to `reliability/history.json` (kept in git) and",
        "re-renders the charts above.",
        "",
    ];

    fs.mkdirSync(path.dirname(outDoc), { recursive: true });
    fs.writeFileSync(outDoc, lines.join("\n"));

    console.log(`Wrote ${outDoc}`);
    console.log(
        `suites=${suites.length} attempts=${attempts} failures=${failures} ` +
            `variations=${variations} tokens=${tokens}`,
    );
    console.log(
        `MTTF(failures)=${mttfLabel(tokens, failures)}  ` +
            `MTTF(variations)=${mttfLabel(tokens, variations)}`,
    );
    console.log(`history: ${history.length} run(s) -> ${historyPath}`);
}

main();
