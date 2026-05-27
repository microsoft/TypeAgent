// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Per-case attempt browser. Reads a case directory's `case.json` and the
// `attempts/<id>/{proposal,evaluation}.json` files, generates one self-
// contained `case.html` that lets the operator:
//
//   - See the case context (members, failure pattern, severity, sample
//     phrases)
//   - Sort attempts by score / lever / mechanism
//   - Click into any attempt to see its proposed edit (old vs. new
//     side-by-side reconstructed from the proposal payload)
//   - Compare attempts within the case visually
//
// No external CSS/JS. Uses native <details> for expand/collapse.

import * as fs from "node:fs";
import * as path from "node:path";

import type { CaseDescription, Hypothesis } from "./types.js";

// =============================================================================
// Types
// =============================================================================

interface ProposalFile {
    schemaVersion: 1;
    id: string;
    lever: string;
    depth: number;
    rationale: { free: string };
    mechanism: string;
    guidelineHook: string | null;
    diffSummary?: {
        addedLines?: number;
        removedLines?: number;
        touchesIdentityLine?: boolean;
        addsAntiExample?: boolean;
    };
    payload?: unknown;
    priorAttempts?: unknown[];
    dryRun?: boolean;
}

interface EvaluationFile {
    schemaVersion: 1;
    probeType: string;
    rescues: number;
    regressions: number;
    netDelta: number;
    score: number;
    regressionPhrases: string[];
    applyError?: string;
    dryRun?: boolean;
}

interface WinnerFile {
    attemptId?: string | null;
    score?: number | null;
    rationale?: string;
    // Or the full AttemptRecord shape when score > 0.
    hypothesis?: Hypothesis;
    evaluation?: EvaluationFile;
}

interface AttemptView {
    id: string;
    dir: string;
    proposal: ProposalFile;
    evaluation: EvaluationFile;
}

// =============================================================================
// Public API
// =============================================================================

export interface BuildCaseHTMLOpts {
    caseDir: string;
}

export interface BuildCaseHTMLResult {
    html: string;
    winnerAttemptId: string | null;
    attemptCount: number;
    bestScore: number;
}

export function buildCaseHTML(
    opts: BuildCaseHTMLOpts,
): BuildCaseHTMLResult {
    const caseDesc = readCaseDescription(opts.caseDir);
    const attempts = readAttempts(opts.caseDir);
    const winner = readWinner(opts.caseDir);

    const winnerAttemptId =
        winner?.attemptId ?? winner?.hypothesis?.id ?? null;
    const bestScore = attempts.reduce(
        (best, a) => Math.max(best, a.evaluation.score),
        -Infinity,
    );

    const html = renderHTML(caseDesc, attempts, winnerAttemptId, opts.caseDir);
    return {
        html,
        winnerAttemptId,
        attemptCount: attempts.length,
        bestScore: Number.isFinite(bestScore) ? bestScore : 0,
    };
}

/** Convenience: write `case.html` into the case directory. */
export function writeCaseHTML(caseDir: string): BuildCaseHTMLResult {
    const result = buildCaseHTML({ caseDir });
    fs.writeFileSync(path.join(caseDir, "case.html"), result.html);
    return result;
}

// =============================================================================
// Loaders
// =============================================================================

function readCaseDescription(caseDir: string): CaseDescription {
    const p = path.join(caseDir, "case.json");
    if (!fs.existsSync(p)) {
        throw new Error(`buildCaseHTML: case.json not found at ${p}`);
    }
    return JSON.parse(fs.readFileSync(p, "utf-8")) as CaseDescription;
}

function readAttempts(caseDir: string): AttemptView[] {
    const attemptsDir = path.join(caseDir, "attempts");
    if (!fs.existsSync(attemptsDir)) return [];
    const out: AttemptView[] = [];
    for (const id of fs.readdirSync(attemptsDir)) {
        const dir = path.join(attemptsDir, id);
        const proposalPath = path.join(dir, "proposal.json");
        const evaluationPath = path.join(dir, "evaluation.json");
        if (!fs.existsSync(proposalPath)) continue;
        const proposal = JSON.parse(
            fs.readFileSync(proposalPath, "utf-8"),
        ) as ProposalFile;
        const evaluation = fs.existsSync(evaluationPath)
            ? (JSON.parse(
                  fs.readFileSync(evaluationPath, "utf-8"),
              ) as EvaluationFile)
            : ({
                  schemaVersion: 1,
                  probeType: "translator",
                  rescues: 0,
                  regressions: 0,
                  netDelta: 0,
                  score: 0,
                  regressionPhrases: [],
              } as EvaluationFile);
        out.push({ id, dir, proposal, evaluation });
    }
    return out;
}

function readWinner(caseDir: string): WinnerFile | null {
    const p = path.join(caseDir, "winner.json");
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, "utf-8")) as WinnerFile;
    } catch {
        return null;
    }
}

// =============================================================================
// Diff reconstruction
// =============================================================================

interface DiffView {
    label: string;
    before: string;
    after: string;
}

/**
 * Reconstruct the proposed edit from the proposal payload + case
 * description. Returns a {before, after} pair the viz can render
 * side-by-side. Pure function — no I/O.
 */
function reconstructDiff(
    caseDesc: CaseDescription,
    proposal: ProposalFile,
): DiffView | null {
    if (proposal.dryRun) return null;
    const payload = proposal.payload as any;
    if (!payload || typeof payload !== "object") return null;

    switch (proposal.lever) {
        case "jsdoc": {
            const key = `${payload.targetSchema}.${payload.targetAction}`;
            const before =
                caseDesc.currentJSDoc[key] ??
                caseDesc.currentPasDescriptions[key] ??
                "(no current documentation)";
            return {
                label: `JSDoc/description for ${key}`,
                before,
                after: payload.newText ?? "(empty)",
            };
        }
        case "manifest": {
            const before =
                caseDesc.currentManifestDescriptions[payload.targetSchema] ??
                "(no current description)";
            return {
                label: `Manifest description for ${payload.targetSchema}`,
                before,
                after: payload.newDescription ?? "(empty)",
            };
        }
        case "fewshot": {
            const key = `${payload.targetSchema}.${payload.targetAction}`;
            const before =
                caseDesc.currentJSDoc[key] ??
                caseDesc.currentPasDescriptions[key] ??
                "(no current documentation)";
            const examples = Array.isArray(payload.examples)
                ? payload.examples
                      .map(
                          (e: any) =>
                              `User: ${e?.user ?? "(?)"}\nAgent: ${e?.agent ?? "(?)"}`,
                      )
                      .join("\n\n")
                : "(no examples)";
            return {
                label: `Examples appended to ${key}`,
                before,
                after: `${examples}\n\n${before}`,
            };
        }
        case "prune": {
            return {
                label: `Deprecation of ${payload.targetSchema}.${payload.targetAction}`,
                before: "(active)",
                after: `@deprecated ${payload.reason ?? "(no reason)"}`,
            };
        }
        default:
            return null;
    }
}

// =============================================================================
// HTML rendering
// =============================================================================

function renderHTML(
    caseDesc: CaseDescription,
    attempts: AttemptView[],
    winnerId: string | null,
    caseDir: string,
): string {
    const sorted = [...attempts].sort(
        (a, b) => b.evaluation.score - a.evaluation.score,
    );
    const slug = path.basename(caseDir);
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>case · ${esc(slug)}</title>
<style>
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #222; max-width: 1400px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 6px; }
  h3 { font-size: 12px; margin: 12px 0 6px; color: #555; }
  .sub { font-size: 11px; color: #888; margin-bottom: 12px; }
  table { border-collapse: collapse; font-size: 11px; margin: 8px 0; width: 100%; }
  th, td { padding: 4px 8px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  th { background: #f7f7f7; }
  tr.winner { background: #e6f5ec; }
  tr.has-error { color: #888; font-style: italic; }
  .rescue   { color: #2a8; font-weight: 600; }
  .regress  { color: #c44; font-weight: 600; }
  .badge    { padding: 1px 6px; border-radius: 3px; font-size: 10px; background: #eef; }
  .badge.winner { background: #d6efd2; color: #1c6b3a; }
  .badge.error  { background: #ffe2dc; color: #c44; }
  .badge.dry    { background: #eee; color: #555; }
  details { margin: 8px 0; }
  summary { cursor: pointer; font-size: 12px; padding: 4px 0; }
  summary:hover { background: #f4f4f4; }
  .diff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; }
  .diff-cell { background: #fbfbfb; border: 1px solid #eee; padding: 8px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; max-height: 320px; overflow-y: auto; }
  .diff-cell h4 { margin: 0 0 4px; font-size: 11px; color: #555; }
  .diff-cell.before { background: #fff8f0; }
  .diff-cell.after  { background: #f0fff5; }
  .phrase-list li { margin: 2px 0; }
  pre.payload { background: #f7f7f7; padding: 8px; font-size: 10px; max-height: 200px; overflow-y: auto; border: 1px solid #eee; }
  .filter-row { margin: 8px 0; }
  .filter-row label { margin-right: 12px; font-size: 11px; }
  .controls { margin: 8px 0; font-size: 11px; color: #555; }
</style></head>
<body>

<h1>${esc(slug)}</h1>
<div class="sub">${esc(caseDir)}</div>

${renderCaseSection(caseDesc)}

<h2>Attempts (${sorted.length})</h2>
${renderAttemptsTable(sorted, winnerId)}

<h2>Attempt details</h2>
<div class="controls">Click any row above (or expand below) to see the proposed edit. Within each attempt, the BEFORE/AFTER block reconstructs what the lever asked the LLM to change.</div>
${sorted.map((a) => renderAttemptDetail(a, winnerId, caseDesc)).join("\n")}

</body></html>`;
}

function renderCaseSection(caseDesc: CaseDescription): string {
    const memberRows = caseDesc.members
        .map(
            (m) =>
                `<tr><td>${esc(m.schemaName)}</td><td>${esc(m.actionName)}</td></tr>`,
        )
        .join("");
    const misroutes = caseDesc.misroutePhrases
        .slice(0, 12)
        .map(
            (p) =>
                `<li>"${esc(p.phraseText)}" — baseline routed <code>${esc(
                    p.chosenSchema ?? "?",
                )}.${esc(p.chosenAction ?? "?")}</code> (expected ${esc(
                    p.expectedSchema,
                )}.${esc(p.expectedAction)})</li>`,
        )
        .join("");
    return `<details open><summary>Case context</summary>

<h3>Members</h3>
<table>
  <thead><tr><th>schemaName</th><th>actionName</th></tr></thead>
  <tbody>${memberRows}</tbody>
</table>

<h3>Classification</h3>
<table>
  <tr><th>failurePattern</th><td>${esc(caseDesc.failurePattern)} (heuristic: ${esc(caseDesc.failurePatternHeuristic)})</td></tr>
  <tr><th>severityTier</th><td>${esc(caseDesc.severityTier)}</td></tr>
  <tr><th>neighborhoodId</th><td>${esc(caseDesc.neighborhoodId)}</td></tr>
</table>

<h3>Sample misroute phrases (${caseDesc.misroutePhrases.length} total)</h3>
<ul class="phrase-list">${misroutes || "<li>(none)</li>"}</ul>

</details>`;
}

function renderAttemptsTable(
    attempts: AttemptView[],
    winnerId: string | null,
): string {
    if (attempts.length === 0) {
        return `<div class="sub">(no attempts)</div>`;
    }
    const rows = attempts
        .map((a) => {
            const isWinner = a.id === winnerId;
            const hasError = !!a.evaluation.applyError;
            const cls = [
                isWinner ? "winner" : "",
                hasError ? "has-error" : "",
            ]
                .filter(Boolean)
                .join(" ");
            const badges: string[] = [];
            if (isWinner) badges.push(`<span class="badge winner">WIN</span>`);
            if (a.proposal.dryRun)
                badges.push(`<span class="badge dry">DRY</span>`);
            if (hasError)
                badges.push(`<span class="badge error">ERR</span>`);
            return (
                `<tr class="${cls}">` +
                `<td><a href="#${esc(a.id)}">${esc(a.id)}</a></td>` +
                `<td>${esc(a.proposal.lever)}</td>` +
                `<td>${esc(a.proposal.mechanism)}</td>` +
                `<td>${esc(String(a.proposal.depth))}</td>` +
                `<td class="rescue">+${a.evaluation.rescues}</td>` +
                `<td class="regress">-${a.evaluation.regressions}</td>` +
                `<td><b>${a.evaluation.score >= 0 ? "+" : ""}${a.evaluation.score}</b></td>` +
                `<td>${badges.join(" ")}</td>` +
                `</tr>`
            );
        })
        .join("");
    return `<table>
      <thead><tr><th>id</th><th>lever</th><th>mechanism</th><th>depth</th><th>rescues</th><th>regressions</th><th>score</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAttemptDetail(
    a: AttemptView,
    winnerId: string | null,
    caseDesc: CaseDescription,
): string {
    const isWinner = a.id === winnerId;
    const diff = reconstructDiff(caseDesc, a.proposal);
    const errorBlock = a.evaluation.applyError
        ? `<div class="diff-cell" style="border-color:#fcc; background:#fff5f3;"><h4>Apply error</h4>${esc(a.evaluation.applyError)}</div>`
        : "";
    const diffBlock = diff
        ? `<h3>${esc(diff.label)}</h3>
<div class="diff-grid">
  <div class="diff-cell before"><h4>BEFORE</h4>${esc(diff.before)}</div>
  <div class="diff-cell after"><h4>AFTER</h4>${esc(diff.after)}</div>
</div>`
        : `<div class="sub">(no diff to render — dry-run or unknown lever)</div>`;
    const regressions =
        a.evaluation.regressionPhrases.length > 0
            ? `<h3>Regression phrases (${a.evaluation.regressionPhrases.length})</h3>
<ul class="phrase-list">${a.evaluation.regressionPhrases
                  .slice(0, 20)
                  .map((p) => `<li>"${esc(p)}"</li>`)
                  .join("")}</ul>`
            : "";
    return `<details${isWinner ? " open" : ""} id="${esc(a.id)}">
<summary>${esc(a.id)} · ${esc(a.proposal.lever)}/${esc(a.proposal.mechanism)} · score=${a.evaluation.score} · rescues=${a.evaluation.rescues} regressions=${a.evaluation.regressions}${isWinner ? " · WINNER" : ""}${a.evaluation.applyError ? " · APPLY ERROR" : ""}</summary>

<h3>Rationale</h3>
<div>${esc(a.proposal.rationale?.free ?? "(none)")}</div>

${diffBlock}

${errorBlock}

${regressions}

<details><summary>Raw proposal.json payload</summary>
<pre class="payload">${esc(JSON.stringify(a.proposal.payload ?? {}, undefined, 2))}</pre>
</details>

</details>`;
}

function esc(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
