// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Self-contained HTML viz for `@collision optimize validate` output.
// Mirrors the style of `translationDiffViz` (monospace, greys, red for
// regressions, green for rescues) but lives in dispatcher because
// optimize/ can't import upstream from defaultAgentProvider.

import type {
    ImpactPayload,
    ImpactTransitionRow,
    WinnerImpact,
} from "./impactPayload.js";

export function buildImpactHTML(payload: ImpactPayload): string {
    const t = payload.transitions;
    const winners = payload.winners;
    const flagged = winners.filter((w) => w.causedRegression);

    return `<!doctype html>
<html><head><meta charset="utf-8">
<title>optimization-impact</title>
<style>
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #222; max-width: 1200px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .sub { font-size: 11px; color: #888; margin-bottom: 16px; }
  table { border-collapse: collapse; font-size: 11px; margin: 8px 0 24px; width: 100%; }
  th, td { padding: 4px 8px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  th { background: #f7f7f7; }
  .rescue   { color: #2a8; font-weight: 600; }
  .regress  { color: #c44; font-weight: 600; }
  .stable   { color: #888; }
  .total    { font-weight: 600; }
  .flag     { background: #fff3f0; padding: 2px 6px; border-radius: 3px; font-size: 11px; color: #c44; }
  .matrix th, .matrix td { text-align: center; min-width: 70px; }
  .phrase td { font-size: 10px; }
  .phrase td.phrase-text { font-size: 11px; max-width: 480px; overflow-wrap: anywhere; }
  .schema-cell { color: #555; }
</style></head>
<body>
<h1>optimization-impact</h1>
<div class="sub">${esc(payload.builtAt)} · baseline=<code>${esc(payload.inputs.baseline)}</code> · candidate=<code>${esc(payload.inputs.candidate)}</code></div>

<h2 style="font-size:14px;margin-top:12px;">Overall</h2>
<table>
  <tr><th>total joined</th><td class="total">${t.total}</td></tr>
  <tr><th>rescued</th><td class="rescue">${t.rescued}</td></tr>
  <tr><th>regressed</th><td class="regress">${t.regressed}</td></tr>
  <tr><th>clean stable</th><td class="stable">${t.cleanStable}</td></tr>
  <tr><th>still broken</th><td>${t.stillBroken}</td></tr>
  <tr><th>still clarify</th><td>${t.stillClarify}</td></tr>
  <tr><th>other</th><td>${t.other}</td></tr>
</table>

<h2 style="font-size:14px;">Winners (${winners.length})${flagged.length > 0 ? ` <span class="flag">${flagged.length} cross-neighborhood regression(s) — review before applying</span>` : ""}</h2>
${renderWinnersTable(winners)}

<h2 style="font-size:14px;">Transition matrix (baseline → candidate)</h2>
${renderTransitionMatrix(payload)}

<h2 style="font-size:14px;">Per-schema rescue/regression</h2>
${renderPerSchemaTable(payload)}

<h2 style="font-size:14px;">Phrase rows (${payload.rows.length}${payload.rows.length === 5000 ? ", truncated" : ""})</h2>
${renderPhraseRows(payload.rows)}

</body></html>`;
}

function renderWinnersTable(winners: WinnerImpact[]): string {
    if (winners.length === 0) {
        return `<div class="sub">No winners — every case produced no positive-score hypothesis within the depth budget.</div>`;
    }
    // Sort by localNet desc so the most useful (or least harmful)
    // winners surface at the top.
    const sorted = [...winners].sort((a, b) => b.localNet - a.localNet);
    const rows = sorted
        .map(
            (w) =>
                `<tr${w.causedRegression ? ` class="flagged"` : ""}>` +
                `<td>${esc(w.attemptId)}</td>` +
                `<td>${esc(w.caseId)}</td>` +
                `<td>${esc(w.schemasTouched.join(", "))}</td>` +
                `<td class="rescue">+${w.localRescues}</td>` +
                `<td class="regress">-${w.localRegressions}</td>` +
                `<td class="regress">-${w.causedRegressions}</td>` +
                `<td>${w.localNet >= 0 ? "+" : ""}${w.localNet}</td>` +
                `<td>${w.causedRegression ? `<span class="flag">REVIEW</span>` : ""}</td>` +
                `</tr>`,
        )
        .join("");
    return `<table>
      <thead><tr><th>attemptId</th><th>caseId</th><th>schemas</th><th>local rescues</th><th>local regressions</th><th>caused regressions</th><th>local net</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="sub" style="font-size:10px; margin-top:4px;">
      <b>local rescues/regressions</b> = phrases whose expectedSchema is in this winner's schemas.<br>
      <b>caused regressions</b> = regressions where the candidate routed to one of this winner's schemas — the strongest "this winner pulled the phrase into the wrong target" signal.<br>
      <b>local net</b> = localRescues − localRegressions − causedRegressions. Sort order. Negative = net-harmful.
    </div>`;
}

function renderTransitionMatrix(payload: ImpactPayload): string {
    const outs = [
        "CLEAN",
        "MISROUTE",
        "CLARIFY",
        "INVALID",
        "ERROR",
    ] as const;
    const head = `<tr><th></th>${outs.map((o) => `<th>${o}</th>`).join("")}</tr>`;
    const body = outs
        .map((b) => {
            const cells = outs
                .map((c) => {
                    const n = payload.transitionMatrix[b][c];
                    const cls =
                        b === "CLEAN" && c !== "CLEAN" && n > 0
                            ? "regress"
                            : b !== "CLEAN" && c === "CLEAN" && n > 0
                              ? "rescue"
                              : "stable";
                    return `<td class="${cls}">${n}</td>`;
                })
                .join("");
            return `<tr><th>${b}</th>${cells}</tr>`;
        })
        .join("");
    return `<table class="matrix">${head}${body}</table>`;
}

function renderPerSchemaTable(payload: ImpactPayload): string {
    if (payload.bySchema.length === 0) return "<p>(no rows)</p>";
    const rows = payload.bySchema
        .map(
            (s) =>
                `<tr>` +
                `<td class="schema-cell">${esc(s.schema)}</td>` +
                `<td class="rescue">+${s.rescued}</td>` +
                `<td class="regress">-${s.regressed}</td>` +
                `<td>${s.candidate.CLEAN}/${s.baseline.CLEAN + s.baseline.MISROUTE + s.baseline.CLARIFY + s.baseline.INVALID + s.baseline.ERROR}</td>` +
                `</tr>`,
        )
        .join("");
    return `<table>
      <thead><tr><th>schema</th><th>rescued</th><th>regressed</th><th>candidate CLEAN / total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderPhraseRows(rows: ImpactTransitionRow[]): string {
    if (rows.length === 0) return "<p>(no phrases)</p>";
    // Show only rescue + regression rows; the operator rarely needs the
    // clean-stable rows in this view.
    const interesting = rows.filter(
        (r) =>
            r.transitionClass === "rescue" ||
            r.transitionClass === "regression",
    );
    if (interesting.length === 0) {
        return `<div class="sub">No rescue or regression rows; all transitions were stable or unchanged.</div>`;
    }
    const body = interesting
        .map((r) => {
            const cls =
                r.transitionClass === "rescue"
                    ? "rescue"
                    : r.transitionClass === "regression"
                      ? "regress"
                      : "stable";
            const expected = `${r.expectedSchema}.${r.expectedAction}`;
            const baseline = r.baseline.chosenSchema
                ? `${r.baseline.chosenSchema}.${r.baseline.chosenAction ?? "?"}`
                : "—";
            const candidate = r.candidate.chosenSchema
                ? `${r.candidate.chosenSchema}.${r.candidate.chosenAction ?? "?"}`
                : "—";
            return (
                `<tr class="phrase">` +
                `<td class="${cls}">${r.transitionClass}</td>` +
                `<td class="phrase-text">${esc(r.phraseText)}</td>` +
                `<td class="schema-cell">${esc(expected)}</td>` +
                `<td>${esc(baseline)} → ${esc(candidate)}</td>` +
                `</tr>`
            );
        })
        .join("");
    return `<table>
      <thead><tr><th>class</th><th>phrase</th><th>expected</th><th>baseline → candidate</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function esc(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
