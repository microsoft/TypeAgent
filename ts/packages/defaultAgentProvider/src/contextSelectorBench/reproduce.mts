// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// One-command reproduction of the full contextSelector collision-resolution
// benchmark suite. Both arms write into a SINGLE consolidated markdown report
// (contextSelector-report.md), by default the tracked copy under
// docs/architecture/collision/ (override the directory with `--out <dir>`):
//
//   1. measureMetrics.mts — deterministic, offline. Writes the base report:
//      the deployed routing-lift of contextSelector layered on every silent
//      strategy fallback (first-match / score-rank / priority) plus the
//      per-strategy head-to-head over the combined 1000+-collision corpus.
//   2. compareLlm.mts — the LLM arm: contextSelector vs the full LLM resolution
//      path, replayed from llm-cache.json (an API key is needed only on a cache
//      miss). Upserts its section into the SAME report; best-effort, so if it
//      can't complete the deterministic report above is unaffected.
//
// Run (no build needed — tsx runs the sources directly):
//   npx tsx src/contextSelectorBench/reproduce.mts [--out <dir>]

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReportPath } from "./reportFile.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Forwarded to both arms (e.g. `--out <dir>`) so they share one report file.
const passthrough = process.argv.slice(2);

// Safeguard: cap each child's V8 heap so a regression that leaks memory OOM-kills
// itself at a small bounded heap instead of consuming system RAM. This suite's
// real peak is well under 1 GB (fixed ~1690-fixture corpora, a bounded 36-cell
// sweep, and a sequential fully-cached LLM arm), so 2 GB is >2x headroom while
// still failing fast if something unexpectedly balloons. Override with
// CS_BENCH_MAX_OLD_SPACE_MB (0 disables the cap).
const MAX_OLD_SPACE_MB = (() => {
    const raw = process.env.CS_BENCH_MAX_OLD_SPACE_MB;
    if (raw === undefined) return 2048;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 2048;
})();

function childEnv(): NodeJS.ProcessEnv {
    if (MAX_OLD_SPACE_MB === 0) return process.env;
    const cap = `--max-old-space-size=${MAX_OLD_SPACE_MB}`;
    const existing = process.env.NODE_OPTIONS ?? "";
    return {
        ...process.env,
        NODE_OPTIONS: existing ? `${existing} ${cap}` : cap,
    };
}

function run(script: string, args: string[]): number {
    const label = [script, ...args].join(" ");
    console.log(`\n=== contextSelector benchmark — ${label} ===`);
    const res = spawnSync("npx", ["tsx", path.join(HERE, script), ...args], {
        stdio: "inherit",
        // npx resolves to npx.cmd on Windows; a shell handles that.
        shell: process.platform === "win32",
        env: childEnv(),
    });
    return res.status ?? 1;
}

console.log(
    MAX_OLD_SPACE_MB === 0
        ? "contextSelector benchmark — child heap cap DISABLED (CS_BENCH_MAX_OLD_SPACE_MB=0)"
        : `contextSelector benchmark — child V8 heap capped at ${MAX_OLD_SPACE_MB} MB (override via CS_BENCH_MAX_OLD_SPACE_MB)`,
);

// 1. Deterministic report: deployed routing-lift + per-strategy comparison.
const metricsStatus = run("measureMetrics.mts", passthrough);
if (metricsStatus !== 0) {
    console.error(`\nmeasureMetrics.mts failed (exit ${metricsStatus}).`);
    process.exit(metricsStatus);
}

// 2. LLM comparison — best-effort (fully cached for the shipped corpus).
// Forward the same passthrough (notably `--out <dir>`) so it upserts its section
// into the same report; compareLlm ignores args it doesn't recognize.
const llmStatus = run("compareLlm.mts", passthrough);
if (llmStatus !== 0) {
    console.warn(
        `\ncompareLlm.mts did not complete (exit ${llmStatus}) — most likely an LLM cache miss with no configured key. The deterministic report above is unaffected.`,
    );
}

// 3. Format the report so the tracked copy stays prettier-clean (CI runs
// `prettier --check .`). The generator emits valid markdown but not
// prettier-normalized table alignment, so normalize it here rather than expecting
// every runner to remember a manual pass. Best-effort — a formatting failure does
// not invalidate the report content.
const reportPath = resolveReportPath();
console.log("\n=== contextSelector benchmark — prettier --write (report) ===");
const fmt = spawnSync("npx", ["prettier", "--write", reportPath], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: childEnv(),
});
if ((fmt.status ?? 1) !== 0) {
    console.warn(
        `\nprettier --write did not complete (exit ${fmt.status ?? 1}) — format ${reportPath} manually before committing.`,
    );
}

console.log("\n=== contextSelector benchmark reproduction complete ===");
console.log(`Consolidated report: ${reportPath}`);
