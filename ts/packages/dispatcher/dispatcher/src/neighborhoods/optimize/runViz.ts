// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Per-run index: one HTML page per `optimization-run-<ts>/` directory
// that lists every case with its summary stats and links into the
// per-case `case.html` browser.
//
// Sortable in-place by clicking column headers (vanilla JS, no deps).

import * as fs from "node:fs";
import * as path from "node:path";

import type { OptimizationRun } from "./types.js";
import { buildCaseHTML } from "./caseViz.js";

export interface BuildRunHTMLOpts {
    runDir: string;
}

export interface BuildRunHTMLResult {
    html: string;
    casesWritten: number;
    perCaseHTMLPaths: string[];
}

/**
 * Generate the run-level browse page AND every per-case page underneath
 * it. Returns the HTML for the run-level page; the operator opens this
 * one to walk the run.
 */
export function buildRunHTML(opts: BuildRunHTMLOpts): BuildRunHTMLResult {
    const runJsonPath = path.join(opts.runDir, "optimization-run.json");
    if (!fs.existsSync(runJsonPath)) {
        throw new Error(
            `buildRunHTML: optimization-run.json not found in ${opts.runDir}`,
        );
    }
    const run = JSON.parse(
        fs.readFileSync(runJsonPath, "utf-8"),
    ) as OptimizationRun;

    // Generate per-case HTML files.
    const casesDir = path.join(opts.runDir, "cases");
    const perCaseRows: CaseRowView[] = [];
    const perCaseHTMLPaths: string[] = [];
    if (fs.existsSync(casesDir)) {
        for (const caseSlug of fs.readdirSync(casesDir).sort()) {
            const caseDir = path.join(casesDir, caseSlug);
            if (!fs.statSync(caseDir).isDirectory()) continue;
            const caseJsonPath = path.join(caseDir, "case.json");
            if (!fs.existsSync(caseJsonPath)) continue;

            const result = buildCaseHTML({ caseDir });
            const htmlPath = path.join(caseDir, "case.html");
            fs.writeFileSync(htmlPath, result.html);
            perCaseHTMLPaths.push(htmlPath);

            const caseDesc = JSON.parse(
                fs.readFileSync(caseJsonPath, "utf-8"),
            );
            perCaseRows.push({
                slug: caseSlug,
                neighborhoodId: caseDesc.neighborhoodId,
                failurePattern: caseDesc.failurePattern,
                severityTier: caseDesc.severityTier,
                memberCount: caseDesc.members?.length ?? 0,
                attemptCount: result.attemptCount,
                bestScore: result.bestScore,
                winnerId: result.winnerAttemptId,
                caseHtmlRelative: path.posix.join(
                    "cases",
                    caseSlug,
                    "case.html",
                ),
            });
        }
    }

    const skippedCases = run.corpusCoverage?.skippedCases ?? [];
    const html = renderRunHTML(opts.runDir, run, perCaseRows, skippedCases);

    return {
        html,
        casesWritten: perCaseRows.length,
        perCaseHTMLPaths,
    };
}

/** Write `browse.html` into the run directory and all per-case pages. */
export function writeRunBrowseHTML(runDir: string): BuildRunHTMLResult {
    const result = buildRunHTML({ runDir });
    fs.writeFileSync(path.join(runDir, "browse.html"), result.html);
    return result;
}

// =============================================================================
// Internal
// =============================================================================

interface CaseRowView {
    slug: string;
    neighborhoodId: string;
    failurePattern: string;
    severityTier: string;
    memberCount: number;
    attemptCount: number;
    bestScore: number;
    winnerId: string | null;
    caseHtmlRelative: string;
}

function renderRunHTML(
    runDir: string,
    run: OptimizationRun,
    cases: CaseRowView[],
    skippedCases: { neighborhoodId: string; reason: string }[],
): string {
    const totalWinners = cases.filter((c) => c.winnerId !== null).length;
    const totalAttempts = cases.reduce((s, c) => s + c.attemptCount, 0);
    const positiveCases = cases.filter((c) => c.bestScore > 0).length;

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>run · ${esc(run.runId)}</title>
<style>
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #222; max-width: 1400px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 6px; }
  .sub { font-size: 11px; color: #888; margin-bottom: 12px; }
  table { border-collapse: collapse; font-size: 11px; margin: 8px 0; width: 100%; }
  th, td { padding: 4px 8px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  th { background: #f7f7f7; cursor: pointer; user-select: none; }
  th:hover { background: #efefef; }
  tr.has-winner { background: #f4fbf6; }
  tr.no-winner { color: #888; }
  .rescue { color: #2a8; font-weight: 600; }
  .regress { color: #c44; font-weight: 600; }
  .stat { font-size: 10px; color: #888; }
  a { color: #25e; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 12px 0; }
  .summary-card { background: #f9f9f9; padding: 10px; border-radius: 4px; }
  .summary-card .num { font-size: 20px; font-weight: 600; }
  .summary-card .label { font-size: 11px; color: #888; }
</style></head>
<body>

<h1>optimization-run-${esc(run.runId)}</h1>
<div class="sub">${esc(runDir)} · built ${esc(run.builtAt)}</div>

<div class="summary-grid">
  <div class="summary-card"><div class="num">${cases.length}</div><div class="label">cases run</div></div>
  <div class="summary-card"><div class="num">${totalWinners}</div><div class="label">cases with winner</div></div>
  <div class="summary-card"><div class="num">${positiveCases}</div><div class="label">cases with positive best-score</div></div>
  <div class="summary-card"><div class="num">${totalAttempts}</div><div class="label">total attempts</div></div>
</div>

<div class="sub">coverage: ${run.corpusCoverage?.reachableMass ?? 0} / ${run.corpusCoverage?.totalCollisionMass ?? 0} mass reachable</div>

<h2>Cases (click headers to sort)</h2>
${renderCasesTable(cases)}

${skippedCases.length > 0 ? renderSkippedCases(skippedCases) : ""}

<script>
// Click-to-sort. Captures the column index, toggles asc/desc.
(function() {
  document.querySelectorAll('table.sortable th').forEach((th, i) => {
    th.addEventListener('click', () => sortBy(th.closest('table'), i));
  });
  function sortBy(table, col) {
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
    th.dataset.dir = dir;
    rows.sort((a, b) => {
      const av = parseValue(a.children[col].textContent);
      const bv = parseValue(b.children[col].textContent);
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    rows.forEach(r => tbody.appendChild(r));
  }
  function parseValue(s) {
    const n = parseFloat(s);
    return isNaN(n) ? s.trim() : n;
  }
})();
</script>

</body></html>`;
}

function renderCasesTable(cases: CaseRowView[]): string {
    if (cases.length === 0) {
        return `<div class="sub">(no cases run)</div>`;
    }
    // Sort by bestScore desc for the initial render.
    const sorted = [...cases].sort((a, b) => b.bestScore - a.bestScore);
    const rows = sorted
        .map((c) => {
            const cls = c.winnerId ? "has-winner" : "no-winner";
            return (
                `<tr class="${cls}">` +
                `<td><a href="${esc(c.caseHtmlRelative)}">${esc(c.slug)}</a></td>` +
                `<td>${esc(c.failurePattern)}</td>` +
                `<td>${esc(c.severityTier)}</td>` +
                `<td>${c.memberCount}</td>` +
                `<td>${c.attemptCount}</td>` +
                `<td><b>${c.bestScore >= 0 ? "+" : ""}${c.bestScore}</b></td>` +
                `<td>${c.winnerId ? esc(c.winnerId) : "—"}</td>` +
                `</tr>`
            );
        })
        .join("");
    return `<table class="sortable">
      <thead><tr>
        <th>case slug</th>
        <th>failurePattern</th>
        <th>severityTier</th>
        <th>members</th>
        <th>attempts</th>
        <th>best score</th>
        <th>winner</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderSkippedCases(
    skipped: { neighborhoodId: string; reason: string }[],
): string {
    const rows = skipped
        .slice(0, 50)
        .map(
            (s) =>
                `<tr><td>${esc(s.neighborhoodId)}</td><td>${esc(s.reason)}</td></tr>`,
        )
        .join("");
    return `<h2>Skipped cases (${skipped.length})</h2>
<table>
  <thead><tr><th>neighborhoodId</th><th>reason</th></tr></thead>
  <tbody>${rows}</tbody>
</table>${skipped.length > 50 ? `<div class="sub">(showing first 50)</div>` : ""}`;
}

function esc(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
