// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Multi-grid HTML report for `@collision optimize patterns`. Renders the
// three groupings produced by patternMiner:
//
//   1. Primary: FailurePattern × Mechanism (mixed across levers).
//   2. Secondary: per-lever FailurePattern × Mechanism drill-downs.
//   3. Tertiary: FailurePattern × Lever lever-effectiveness.
//
// Plus the classifier-agreement matrix and a header note about
// translator-only rescues (placeholder for the v1.1 grammar-lever
// addition — grammar-match and translator-probe scores aren't directly
// comparable).

import type {
    CellStats,
    ClassifierAgreement,
    PatternsReport,
} from "./patternMiner.js";

export interface BuildPatternsHTMLOpts {
    /** Minimum attempt count for a cell to render its stats. Cells below
     *  threshold render as `—`. Default 5. */
    minAttempts?: number;
    /** Surface cells whose classifier disagreement rate exceeds this
     *  fraction (0..1). Default 0.5. */
    surfaceDisagreement?: number;
}

export function buildPatternsHTML(
    report: PatternsReport,
    opts: BuildPatternsHTMLOpts = {},
): string {
    const minAttempts = opts.minAttempts ?? 5;
    const surfaceDisagreement = opts.surfaceDisagreement ?? 0.5;

    return `<!doctype html>
<html><head><meta charset="utf-8">
<title>optimize patterns</title>
<style>
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #222; max-width: 1200px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 6px; }
  h3 { font-size: 12px; margin: 16px 0 4px; color: #555; }
  .sub { font-size: 11px; color: #888; margin-bottom: 16px; }
  .note { background: #fff8e8; border-left: 3px solid #d9a300; padding: 6px 10px; margin: 12px 0; font-size: 11px; }
  table { border-collapse: collapse; font-size: 11px; margin: 4px 0 12px; min-width: 600px; }
  th, td { padding: 4px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  th { background: #f7f7f7; text-align: left; }
  td.cell { text-align: center; }
  .below { color: #aaa; }
  .high-win { background: #e6f5ec; color: #1c6b3a; font-weight: 600; }
  .meh { color: #555; }
  .low-win { color: #c44; }
  .disagree { background: #fff3f0; color: #c44; font-weight: 600; }
  .stat { font-size: 10px; color: #888; }
  details { margin: 8px 0; }
  summary { cursor: pointer; font-size: 12px; color: #555; }
</style></head>
<body>
<h1>@collision optimize patterns</h1>
<div class="sub">${esc(report.builtAt)} · ${report.totalAttempts} attempt(s) across ${report.totalRuns} run(s) · --min-attempts=${minAttempts} --surface-disagreement=${surfaceDisagreement}</div>

<div class="note">
  v1: all rescue counts come from the translator probe. When the grammar lever lands in v1.1, grammar-match rescues will not be directly comparable to translator-probe rescues — the patterns.json grouping will gain a probe-type axis at that point.
</div>

<h2>Primary — FailurePattern × Mechanism (aggregated across levers)</h2>
<div class="sub">Lever-agnostic. Answers "which mechanism works for which failure pattern?" Feeds the Phase 9 distiller.</div>
${renderGrid(report.byMechanism, minAttempts)}

<h2>Per-lever — FailurePattern × Mechanism drill-downs</h2>
<div class="sub">Sparsity by construction — e.g. <code>prune</code> only emits <code>deprecate</code>. Operator uses for lever-set tuning.</div>
${renderPerLeverGrids(report.byLeverMechanism, minAttempts)}

<h2>Tertiary — FailurePattern × Lever (lever effectiveness)</h2>
<div class="sub">Which lever is best at which failure pattern?</div>
${renderGrid(report.byLever, minAttempts)}

<h2>Classifier agreement (heuristic vs. LLM-refined)</h2>
<div class="sub">High disagreement on a refined pattern means the lexical heuristic and the LLM systematically disagree about classification. Worth checking the heuristic rules.</div>
${renderClassifierAgreement(report.classifierAgreement, surfaceDisagreement)}

</body></html>`;
}

// =============================================================================
// Grid renderer
// =============================================================================

function renderGrid(
    grid: Record<string, Record<string, CellStats>>,
    minAttempts: number,
): string {
    const rows = Object.keys(grid).sort();
    if (rows.length === 0) {
        return `<div class="sub">(no data yet — accumulate runs and re-run patterns)</div>`;
    }
    // Collect column keys across the whole grid for a stable header.
    const cols = new Set<string>();
    for (const r of rows) for (const c of Object.keys(grid[r]!)) cols.add(c);
    const colList = [...cols].sort();

    const head = `<tr><th></th>${colList.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
    const body = rows
        .map((r) => {
            const cells = colList
                .map((c) => {
                    const cell = grid[r]?.[c];
                    if (!cell) return `<td class="cell below">—</td>`;
                    if (cell.attempts < minAttempts) {
                        return `<td class="cell below" title="${cell.attempts} attempt(s) — below --min-attempts">—</td>`;
                    }
                    return renderCell(cell);
                })
                .join("");
            return `<tr><th>${esc(r)}</th>${cells}</tr>`;
        })
        .join("");
    return `<table>${head}${body}</table>`;
}

function renderPerLeverGrids(
    grids: Record<string, Record<string, Record<string, CellStats>>>,
    minAttempts: number,
): string {
    const levers = Object.keys(grids).sort();
    if (levers.length === 0) {
        return `<div class="sub">(no per-lever data yet)</div>`;
    }
    return levers
        .map(
            (lever) =>
                `<details open><summary>${esc(lever)}</summary>${renderGrid(
                    grids[lever]!,
                    minAttempts,
                )}</details>`,
        )
        .join("");
}

function renderCell(cell: CellStats): string {
    const winPct = (cell.winRate * 100).toFixed(0);
    const meanScore = cell.meanScore.toFixed(2);
    const regPct = (cell.regressionRate * 100).toFixed(0);
    const cls =
        cell.winRate >= 0.5
            ? "high-win"
            : cell.winRate >= 0.2
              ? "meh"
              : "low-win";
    return `<td class="cell ${cls}" title="${cell.wins}/${cell.attempts} wins; mean score ${meanScore}; regression rate ${regPct}%">${winPct}% <span class="stat">(n=${cell.attempts})</span></td>`;
}

// =============================================================================
// Classifier agreement
// =============================================================================

function renderClassifierAgreement(
    agreement: ClassifierAgreement,
    surfaceDisagreement: number,
): string {
    const patterns = Object.keys(agreement.perPattern).sort();
    if (patterns.length === 0) {
        return `<div class="sub">(no classifier data yet)</div>`;
    }
    const rows = patterns
        .map((p) => {
            const entry = agreement.perPattern[p]!;
            const disagree = (entry.disagreementRate * 100).toFixed(0);
            const cls =
                entry.disagreementRate >= surfaceDisagreement
                    ? "disagree"
                    : "meh";
            return `<tr><th>${esc(p)}</th><td class="cell ${cls}">${disagree}%<span class="stat"> (${entry.heuristicMatches}/${entry.attempts})</span></td></tr>`;
        })
        .join("");
    const overall = (agreement.overall.disagreementRate * 100).toFixed(0);
    return `<table>
      <thead><tr><th>refined pattern</th><th>disagreement rate (heuristic ≠ LLM)</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>overall</th><td class="cell meh">${overall}%<span class="stat"> (${agreement.overall.heuristicMatches}/${agreement.overall.attempts})</span></td></tr></tfoot>
    </table>`;
}

// =============================================================================
// Helpers
// =============================================================================

function esc(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
