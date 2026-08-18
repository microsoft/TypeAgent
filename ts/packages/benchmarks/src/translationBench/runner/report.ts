// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CollisionStrategy } from "agent-dispatcher/internal";
import type {
    TranslationBenchBenchmark,
    TranslationBenchSourcePin,
} from "../synthesizer/benchmark.js";
import type {
    TranslationBenchBreakdown,
    TranslationBenchPricing,
    TranslationBenchRow,
    TranslationBenchRunResult,
    TranslationBenchSuite,
    TranslationBenchSummary,
} from "./runner.js";
import {
    aggregateTranslationBenchExplainerResults,
    type TranslationBenchExplainerAggregate,
    type TranslationBenchExplainerCaseResult,
} from "./explainer.js";
import {
    getTranslationBenchCatalogCensus,
    type TranslationBenchCatalogCensus,
} from "./scale.js";

export interface TranslationBenchExplainerReport {
    summary: TranslationBenchExplainerAggregate;
    byModel: { key: string; summary: TranslationBenchExplainerAggregate }[];
    rows: TranslationBenchExplainerCaseResult[];
}

function sourcePinFromBenchmark(
    benchmark: TranslationBenchBenchmark,
): TranslationBenchSourcePin {
    const lineage = benchmark.cases[0]?.seed.lineage;
    if (lineage === undefined) {
        throw new Error("Cannot derive source pin from an empty benchmark");
    }
    return {
        dataset: lineage.dataset,
        revision: lineage.revision,
        config: lineage.config,
        split: lineage.split,
        sourceUrl: lineage.sourceUrl,
        // Full-file pin is recorded on construction as sourceManifestHash
        // (hash of the operator manifest). Surface it here for operators.
        sourceFileHash:
            benchmark.metadata.construction.sourceManifestHash ??
            "0".repeat(64),
    };
}

export interface TranslationBenchReport {
    version: 1;
    suiteName: string;
    settings: {
        models: string[];
        scenarios?: TranslationBenchRunResult["settings"]["scenarios"];
        strategy: CollisionStrategy;
        concurrency: number;
        streaming: false;
        activeSchemaMode?: "case-pinned";
        schemaSwitching?: true;
        attachments?: false;
        userContext?: boolean;
        activityContext?: boolean;
        sourceManifestHash: string;
        translation?: Record<string, unknown>;
        execution?: Record<string, unknown>;
        collision?: Record<string, unknown>;
    };
    schemaHashes: Record<string, string>;
    catalog?: TranslationBenchCatalogCensus;
    pricing: Record<string, TranslationBenchPricing>;
    summary: TranslationBenchSummary;
    byModel: TranslationBenchBreakdown[];
    byScenario: TranslationBenchBreakdown[];
    byActionCount: TranslationBenchBreakdown[];
    byAction?: TranslationBenchBreakdown[];
    byDimension: TranslationBenchBreakdown[];
    byShape: TranslationBenchBreakdown[];
    rows: TranslationBenchRow[];
    explainer?: TranslationBenchExplainerReport;
    provenance?: {
        source: TranslationBenchSourcePin;
        disclosure: string;
        construction: TranslationBenchBenchmark["metadata"]["construction"];
        approval: TranslationBenchBenchmark["metadata"]["approval"];
        decisions: {
            candidates: number;
            scored: number;
            skipped: number;
            shapeOnly: number;
            scoredRate: number;
        };
    };
}

export function createTranslationBenchReport(
    suite: TranslationBenchSuite,
    result: TranslationBenchRunResult,
    explainerRows: TranslationBenchExplainerCaseResult[] = [],
    benchmark?: TranslationBenchBenchmark,
): TranslationBenchReport {
    const decisionLedger =
        benchmark?.metadata.construction.decisionLedger ?? [];
    const scored = decisionLedger.filter(
        (entry) => entry.decision === "score",
    ).length;
    return {
        version: 1,
        suiteName: suite.name,
        settings: result.settings,
        schemaHashes: result.schemaHashes,
        ...(benchmark !== undefined
            ? {
                  catalog: getTranslationBenchCatalogCensus(
                      benchmark.metadata.schemas,
                  ),
              }
            : {}),
        pricing: suite.pricing ?? {},
        summary: result.summary,
        byModel: result.byModel,
        byScenario: result.byScenario,
        byActionCount: result.byActionCount,
        byAction: result.byAction,
        byDimension: result.byDimension,
        byShape: result.byShape,
        rows: result.rows,
        ...(benchmark !== undefined
            ? {
                  provenance: {
                      source: sourcePinFromBenchmark(benchmark),
                      disclosure:
                          "Pinned source is operator-supplied (see local/ or data/). Synthetic conversation roles are not evidence of human authorship. Mapped TypeAgent subsets are not directly comparable to upstream tool-calling leaderboards.",
                      construction: structuredClone(
                          benchmark.metadata.construction,
                      ),
                      approval: structuredClone(benchmark.metadata.approval),
                      decisions: {
                          candidates: decisionLedger.length,
                          scored,
                          skipped: decisionLedger.filter(
                              (entry) => entry.decision === "skip",
                          ).length,
                          shapeOnly: decisionLedger.filter(
                              (entry) => entry.decision === "shapeOnly",
                          ).length,
                          scoredRate:
                              decisionLedger.length === 0
                                  ? 0
                                  : scored / decisionLedger.length,
                      },
                  },
              }
            : {}),
        ...(explainerRows.length > 0
            ? {
                  explainer: {
                      summary:
                          aggregateTranslationBenchExplainerResults(
                              explainerRows,
                          ),
                      byModel: [
                          ...new Set(explainerRows.map((row) => row.model)),
                      ]
                          .sort()
                          .map((model) => ({
                              key: model,
                              summary:
                                  aggregateTranslationBenchExplainerResults(
                                      explainerRows.filter(
                                          (row) => row.model === model,
                                      ),
                                  ),
                          })),
                      rows: explainerRows,
                  },
              }
            : {}),
    };
}

function esc(value: unknown): string {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function percent(value: number | undefined): string {
    return value === undefined ? "N/A" : `${(value * 100).toFixed(1)}%`;
}

function integer(value: number | undefined): string {
    return value === undefined
        ? "N/A"
        : Math.round(value)
              .toString()
              .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function cost(value: number | undefined): string {
    return value === undefined ? "N/A" : `$${value.toFixed(6)}`;
}

const SUMMARY_METRIC_HEADERS =
    "<th>Passed</th><th>Pass rate</th><th>Exact rate</th><th>Schema-valid</th><th>Tool score</th><th>Param score</th><th>FNR</th><th>FPR</th><th>Errors</th><th>P50 / P95 ms</th><th>Prompt</th><th>Cached</th><th>Reasoning</th><th>Output</th><th>Cost</th>";

function summaryCells(summary: TranslationBenchSummary): string {
    return [
        `${summary.passedCases}/${summary.totalCases}`,
        percent(summary.passRate),
        percent(summary.exactPassRate),
        percent(summary.schemaValidRate),
        percent(summary.toolScore),
        percent(summary.paramScore),
        percent(summary.falseNegativeRate),
        percent(summary.falsePositiveRate),
        String(summary.errors),
        `${Math.round(summary.p50LatencyMs)} / ${Math.round(summary.p95LatencyMs)}`,
        integer(summary.usage.promptTokens),
        integer(summary.usage.cachedTokens),
        integer(summary.usage.reasoningTokens),
        integer(summary.usage.completionTokens),
        cost(summary.usage.estimatedCostUsd),
    ]
        .map((value) => `<td>${esc(value)}</td>`)
        .join("");
}

function summaryTable(firstHeader: string, rowsHtml: string): string {
    return `<table><thead><tr><th>${esc(firstHeader)}</th>${SUMMARY_METRIC_HEADERS}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function headlineTable(report: TranslationBenchReport): string {
    const summaries = new Map(
        report.byModel.map((entry) => [entry.key, entry.summary]),
    );
    const rows = report.settings.models
        .map((model) => {
            const summary = summaries.get(model);
            return summary
                ? `<tr><th>${esc(model)}</th>${summaryCells(summary)}</tr>`
                : `<tr><th>${esc(model)}</th><td colspan="15">No rows</td></tr>`;
        })
        .join("");
    return summaryTable("Model", rows);
}

function actionReliabilityTable(report: TranslationBenchReport): string {
    const byAction = report.byAction ?? [];
    if (byAction.length === 0) {
        return "<p>No per-action breakdown (empty run or multi-only rows).</p>";
    }
    // Small lists stay as plain tables; large runs virtualize.
    if (byAction.length <= 40) {
        const rows = byAction
            .map(
                (entry) =>
                    `<tr><th>${esc(entry.key)}</th>${summaryCells(entry.summary)}</tr>`,
            )
            .join("");
        return summaryTable("Action", rows);
    }
    return virtualSummaryBreakdown(
        "Action reliability",
        "Action",
        byAction,
        "translation-bench-by-action-json",
    );
}

function shapeTable(report: TranslationBenchReport): string {
    const rows = report.byShape
        .map(
            (entry) =>
                `<tr><th>${esc(entry.key)}</th>${summaryCells(entry.summary)}</tr>`,
        )
        .join("");
    return summaryTable("Action shape", rows);
}

function scenarioTable(report: TranslationBenchReport): string {
    const rows = report.byScenario
        .map(
            (entry) =>
                `<tr><th>${esc(entry.key)}</th>${summaryCells(entry.summary)}</tr>`,
        )
        .join("");
    return summaryTable("Model × scenario", rows);
}

function actionCountTable(report: TranslationBenchReport): string {
    const rows = report.byActionCount
        .map(
            (entry) =>
                `<tr><th>${esc(entry.key)}</th>${summaryCells(entry.summary)}</tr>`,
        )
        .join("");
    return summaryTable("Model × action count (active × expected)", rows);
}

function dimensionTable(report: TranslationBenchReport): string {
    if (report.byDimension.length === 0) {
        return "<p>No builder-dimension breakdown.</p>";
    }
    if (report.byDimension.length <= 40) {
        const rows = report.byDimension
            .map(
                (entry) =>
                    `<tr><th>${esc(entry.key)}</th>${summaryCells(entry.summary)}</tr>`,
            )
            .join("");
        return summaryTable("Model × builder dimension", rows);
    }
    return virtualSummaryBreakdown(
        "Model × builder dimension",
        "Model × builder dimension",
        report.byDimension,
        "translation-bench-by-dimension-json",
    );
}

function diagnosticCells(
    diagnostics: TranslationBenchSummary["diagnostics"],
    totalCases: number,
): string {
    return [
        diagnostics.wrongRouteOrAction,
        diagnostics.missingRequiredParameter,
        diagnostics.extraneousParameter,
        diagnostics.wrongParameterType,
        diagnostics.wrongValue,
        diagnostics.invalidJsonOrTranslationFailure,
    ]
        .map((value) => {
            const rate = totalCases === 0 ? 0 : value / Math.max(totalCases, 1);
            return `<td>${esc(value)} <span class="diag-rate">(${esc(percent(rate))})</span></td>`;
        })
        .join("");
}

function diagnosticsTable(report: TranslationBenchReport): string {
    const translationRows = report.byModel
        .map(
            (entry) =>
                `<tr><th>Translation · ${esc(entry.key)}</th>${diagnosticCells(entry.summary.diagnostics, entry.summary.totalCases)}</tr>`,
        )
        .join("");
    const explainerRows =
        report.explainer?.byModel
            .map(
                (entry) =>
                    `<tr><th>Explainer · ${esc(entry.key)}</th>${diagnosticCells(entry.summary.diagnostics, entry.summary.totalCases)}</tr>`,
            )
            .join("") ?? "";
    return `<table><thead><tr><th>Phase · model</th><th>Wrong route/action</th><th>Missing required parameter</th><th>Extraneous parameter</th><th>Wrong parameter type</th><th>Wrong value</th><th>Invalid JSON / translation failure</th></tr></thead><tbody>${translationRows}${explainerRows}</tbody></table><p class="diag-note">Failure taxonomy cells show raw counts and rate over that phase's cases (honest denominators; not invented 100k-scale curves).</p>`;
}

function actionList(
    actions: TranslationBenchRow["expectedActions"],
    emptyLabel: string,
): string {
    if (actions.length === 0) {
        return `<p class="row-trace-empty">${esc(emptyLabel)}</p>`;
    }
    return `<ol class="row-trace-actions">${actions
        .map(
            (action) =>
                `<li><code>${esc(`${action.schemaName}.${action.actionName}`)}</code><pre>${esc(JSON.stringify(action.parameters ?? {}, null, 2))}</pre></li>`,
        )
        .join("")}</ol>`;
}

function diagnosticList(score: TranslationBenchRow["score"]): string {
    const labels: [keyof typeof score.diagnostics, string][] = [
        ["wrongRouteOrAction", "Wrong route or action"],
        ["missingRequiredParameter", "Missing required parameter"],
        ["extraneousParameter", "Extraneous parameter"],
        ["wrongParameterType", "Wrong parameter type"],
        ["wrongValue", "Wrong value"],
        ["invalidJsonOrTranslationFailure", "Invalid JSON or translation"],
    ];
    const diagnostics = labels.filter(([key]) => score.diagnostics[key] > 0);
    if (diagnostics.length === 0) {
        return '<p class="row-trace-empty">No diagnostic flags</p>';
    }
    return `<ul class="row-trace-diagnostics">${diagnostics
        .map(
            ([key, label]) =>
                `<li>${esc(label)} <strong>${esc(score.diagnostics[key])}</strong></li>`,
        )
        .join("")}</ul>`;
}

/** Compact row payload for client-side virtualization (avoids 6k DOM nodes). */
type CompactTraceRow = {
    status: "PASS" | "FAIL" | "ERROR";
    model: string;
    scenarioId: string;
    caseId: string;
    utterance: string;
    expectedActions: TranslationBenchRow["expectedActions"];
    chosenActions: TranslationBenchRow["chosenActions"];
    score: TranslationBenchRow["score"];
    error?: string;
    elapsedMs: number;
    activeActionCount: number;
    shapeKey: string;
    usage: TranslationBenchRow["usage"];
    lineage: {
        dataset: string;
        rowId: string;
        sourceUrl: string;
        sourcePart?: string;
    };
};

function rowStatus(row: TranslationBenchRow): CompactTraceRow["status"] {
    return row.error ? "ERROR" : row.score.passed ? "PASS" : "FAIL";
}

function compactTraceRow(row: TranslationBenchRow): CompactTraceRow {
    return {
        status: rowStatus(row),
        model: row.model,
        scenarioId: row.scenarioId,
        caseId: row.caseId,
        utterance: row.utterance,
        expectedActions: row.expectedActions,
        chosenActions: row.chosenActions,
        score: row.score,
        ...(row.error === undefined ? {} : { error: row.error }),
        elapsedMs: row.elapsedMs,
        activeActionCount: row.activeActionCount,
        shapeKey: row.shape.key,
        usage: row.usage,
        lineage: {
            dataset: row.lineage.dataset,
            rowId: row.lineage.rowId,
            sourceUrl: row.lineage.sourceUrl,
            ...(row.lineage.sourcePart === undefined
                ? {}
                : { sourcePart: row.lineage.sourcePart }),
        },
    };
}

/** JSON embed safe for `<script type="application/json">` (no `</script>` breakout). */
function embedJson(id: string, data: unknown): string {
    const json = JSON.stringify(data).replaceAll("</", "<\\/");
    return `<script type="application/json" id="${esc(id)}">${json}</script>`;
}

function singleRowTrace(report: TranslationBenchReport): string {
    if (report.rows.length === 0) return "<p>No translation rows.</p>";
    const compact = report.rows.map(compactTraceRow);
    // One host panel; options + detail HTML built client-side from compact JSON.
    return `${embedJson("translation-bench-rows-json", compact)}
<div class="row-trace-picker">
<label for="translation-bench-row-filter">Filter</label>
<input id="translation-bench-row-filter" type="search" placeholder="PASS/FAIL · model · case id · utterance" style="min-width:min(100%,320px);padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--fg)"/>
<label for="translation-bench-row-select">Translation row</label>
<select id="translation-bench-row-select"></select>
<span id="translation-bench-row-count" class="meta"></span>
</div>
<div id="translation-bench-row-traces"></div>
<script>(()=>{
const rows=JSON.parse(document.getElementById("translation-bench-rows-json").textContent||"[]");
const select=document.getElementById("translation-bench-row-select");
const filterEl=document.getElementById("translation-bench-row-filter");
const host=document.getElementById("translation-bench-row-traces");
const countEl=document.getElementById("translation-bench-row-count");
if(!select||!host)return;
const esc=s=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const int=v=>v==null?"N/A":Math.round(v).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,",");
const cost=v=>v==null?"N/A":"$"+Number(v).toFixed(6);
const actionList=(actions,empty)=>{
  if(!actions||!actions.length)return '<p class="row-trace-empty">'+esc(empty)+'</p>';
  return '<ol class="row-trace-actions">'+actions.map(a=>'<li><code>'+esc(a.schemaName+'.'+a.actionName)+'</code><pre>'+esc(JSON.stringify(a.parameters??{},null,2))+'</pre></li>').join("")+'</ol>';
};
const diagList=score=>{
  const labels=[["wrongRouteOrAction","Wrong route or action"],["missingRequiredParameter","Missing required parameter"],["extraneousParameter","Extraneous parameter"],["wrongParameterType","Wrong parameter type"],["wrongValue","Wrong value"],["invalidJsonOrTranslationFailure","Invalid JSON or translation"]];
  const hits=labels.filter(([k])=>(score.diagnostics||{})[k]>0);
  if(!hits.length)return '<p class="row-trace-empty">No diagnostic flags</p>';
  return '<ul class="row-trace-diagnostics">'+hits.map(([k,l])=>'<li>'+esc(l)+' <strong>'+esc(score.diagnostics[k])+'</strong></li>').join("")+'</ul>';
};
const render=row=>{
  const st=row.status;
  const lin=row.lineage||{};
  const sourceLabel=lin.dataset+':'+lin.rowId+(lin.sourcePart?' · '+lin.sourcePart:'');
  const usage=['Prompt '+int(row.usage&&row.usage.promptTokens),'Cached '+int(row.usage&&row.usage.cachedTokens),'Reasoning '+int(row.usage&&row.usage.reasoningTokens),'Output '+int(row.usage&&row.usage.completionTokens),'Cost '+cost(row.usage&&row.usage.estimatedCostUsd)].join(' · ');
  const sc=row.score||{};
  return '<article class="row-trace '+(st==='PASS'?'pass':'fail')+'">'+
    '<div class="row-trace-heading"><strong class="row-trace-status">'+esc(st)+'</strong><span>'+esc(row.model)+' · '+esc(row.scenarioId)+' · '+esc(row.caseId)+'</span></div>'+
    '<div class="row-trace-flow" role="group" aria-label="Translation evaluation flow for '+esc(row.caseId)+'">'+
    '<section class="row-trace-step"><div class="row-trace-label">1 · Public intent</div><blockquote>'+esc(row.utterance)+'</blockquote><a href="'+esc(lin.sourceUrl||'#')+'">'+esc(sourceLabel)+'</a></section>'+
    '<div class="row-trace-arrow" aria-hidden="true">→</div>'+
    '<section class="row-trace-step"><div class="row-trace-label">2 · Expected TypeAgent action</div>'+actionList(row.expectedActions,'No action expected (abstain)')+'</section>'+
    '<div class="row-trace-arrow" aria-hidden="true">→</div>'+
    '<section class="row-trace-step"><div class="row-trace-label">3 · Chosen action</div>'+actionList(row.chosenActions,'No action chosen')+'</section>'+
    '<div class="row-trace-arrow" aria-hidden="true">→</div>'+
    '<section class="row-trace-step row-trace-score"><div class="row-trace-label">4 · Deterministic score</div><dl>'+
    '<div><dt>Soft pass</dt><dd>'+(sc.passed?'Yes':'No')+'</dd></div>'+
    '<div><dt>Exact pass</dt><dd>'+(sc.exactPassed?'Yes':'No')+'</dd></div>'+
    '<div><dt>Schema-valid</dt><dd>'+(sc.schemaValid?'Yes':'No')+'</dd></div>'+
    '<div><dt>Routed</dt><dd>'+esc(sc.routed)+'/'+esc(sc.expectedCount)+'</dd></div>'+
    '<div><dt>Parameters</dt><dd>'+esc(sc.paramMatches)+'/'+esc(sc.routed)+' soft · '+esc(sc.exactParamMatches)+'/'+esc(sc.routed)+' exact</dd></div></dl>'+
    diagList(sc)+(row.error?'<p class="row-trace-error">'+esc(row.error)+'</p>':'')+
    '</section></div>'+
    '<div class="row-trace-meta">'+esc(row.activeActionCount)+' visible actions · '+esc(row.shapeKey)+' · '+esc(Math.round(row.elapsedMs))+' ms<br>'+esc(usage)+'</div></article>';
};
let filtered=rows.map((r,i)=>({r,i}));
const refill=()=>{
  const q=(filterEl&&filterEl.value||'').trim().toLowerCase();
  filtered=rows.map((r,i)=>({r,i})).filter(({r})=>{
    if(!q)return true;
    const hay=[r.status,r.model,r.scenarioId,r.caseId,r.utterance].join(' ').toLowerCase();
    return hay.includes(q);
  });
  // Cap select options to keep the control responsive on 6k-row runs.
  const cap=500;
  const shown=filtered.slice(0,cap);
  select.innerHTML=shown.map(({r,i})=>'<option value="'+i+'">'+esc(r.status+' · '+r.model+' · '+r.scenarioId+' · '+r.caseId)+'</option>').join('');
  if(countEl)countEl.textContent=filtered.length<=cap? (filtered.length+' rows') : (shown.length+' of '+filtered.length+' (filter to narrow)');
  if(select.options.length){select.selectedIndex=0;show();}
  else{host.innerHTML='<p class="row-trace-empty">No rows match filter.</p>';}
};
const show=()=>{
  const idx=Number(select.value);
  const row=rows[idx];
  host.innerHTML=row?render(row):'<p class="row-trace-empty">No row selected.</p>';
};
select.addEventListener('change',show);
if(filterEl)filterEl.addEventListener('input',refill);
refill();
})();</script>`;
}

function historyDetails(history: unknown): string {
    if (!Array.isArray(history) || history.length === 0) {
        return '<p class="row-trace-empty">No case history</p>';
    }
    return `<details class="case-bank-history"><summary>${esc(history.length)} history turn${history.length === 1 ? "" : "s"}</summary><pre>${esc(JSON.stringify(history, null, 2))}</pre></details>`;
}

function sourceLink(
    lineage: TranslationBenchExplainerCaseResult["seedReplay"]["lineage"],
): string {
    const label = `${lineage.dataset}:${lineage.rowId}${lineage.sourcePart === undefined ? "" : ` · ${lineage.sourcePart}`}`;
    return `<a class="case-bank-source" href="${esc(lineage.sourceUrl)}">${esc(label)}</a>`;
}

function probeNode(
    probe: TranslationBenchExplainerCaseResult["seedReplay"],
    label: string,
): string {
    const status = probe.error ? "ERROR" : probe.score.passed ? "PASS" : "FAIL";
    return `<section class="case-bank-node ${status === "PASS" ? "pass" : "fail"}">
<div class="case-bank-node-heading"><strong>${esc(label)}</strong><span class="case-bank-status">${esc(status)}</span></div>
<blockquote>${esc(probe.utterance)}</blockquote>
${historyDetails(probe.history)}
${sourceLink(probe.lineage)}
<div class="case-bank-actions"><div><div class="row-trace-label">Expected</div>${actionList(probe.expectedActions, "No action expected (abstain)")}</div><div><div class="row-trace-label">Replay chose</div>${actionList(probe.chosenActions, "No action chosen")}</div></div>
<div class="case-bank-meta">Cache hit ${probe.hit ? "yes" : "no"} · ${esc(probe.matchCount)} match${probe.matchCount === 1 ? "" : "es"} · ${esc(probe.elapsedMs.toFixed(1))} ms</div>
${diagnosticList(probe.score)}${probe.error === undefined ? "" : `<p class="row-trace-error">${esc(probe.error)}</p>`}
</section>`;
}

function caseBankPanel(
    report: TranslationBenchReport,
    row: TranslationBenchExplainerCaseResult,
    index: number,
): string {
    const translation = report.rows.find(
        (candidate) =>
            candidate.model === row.model && candidate.caseId === row.caseId,
    );
    const translationStatus =
        translation === undefined
            ? "N/A"
            : translation.error
              ? "ERROR"
              : translation.score.passed
                ? "PASS"
                : "FAIL";
    const replayStatus = row.seedReplay.error
        ? "ERROR"
        : row.seedReplay.score.passed
          ? "PASS"
          : "FAIL";
    const overallPass =
        translation?.score.passed === true &&
        row.seedReplay.score.passed &&
        row.summary.passRate === 1;
    const generalizations = row.probes
        .map((probe, probeIndex) =>
            probeNode(
                probe,
                `${probe.kind === "positive" ? "Positive" : "Negative"} generalization ${probeIndex + 1}`,
            ),
        )
        .join("");
    return `<article class="case-bank ${overallPass ? "pass" : "fail"}" data-translation-bench-case-bank="${index}"${index === 0 ? "" : " hidden"}>
<div class="case-bank-heading"><strong class="case-bank-status">${overallPass ? "PASS" : "FAIL"}</strong><span>${esc(row.model)} · ${esc(row.caseId)} · ${esc(row.explainerName)}</span></div>
<div class="case-bank-seed-flow" role="group" aria-label="Seed and rule for ${esc(row.caseId)}">
<section class="case-bank-node">
<div class="case-bank-node-heading"><strong>Seed case</strong><span>Translation ${esc(translationStatus)} · cache replay ${esc(replayStatus)}</span></div>
<blockquote>${esc(row.seedReplay.utterance)}</blockquote>
${historyDetails(row.seedReplay.history)}
${sourceLink(row.seedReplay.lineage)}
<div class="case-bank-actions"><div><div class="row-trace-label">Expected</div>${actionList(row.seedReplay.expectedActions, "No action expected")}</div><div><div class="row-trace-label">Translation chose</div>${actionList(translation?.chosenActions ?? [], "No action chosen")}</div></div>
<div class="case-bank-meta">Seed replay chose ${esc(row.seedReplay.chosenActions.length)} action${row.seedReplay.chosenActions.length === 1 ? "" : "s"}</div>${diagnosticList(row.seedReplay.score)}
</section>
<div class="case-bank-arrow" aria-hidden="true">→</div>
<section class="case-bank-node case-bank-rule"><div class="case-bank-node-heading"><strong>Constructed explainer rule</strong><span>${row.ruleCreated ? "Created" : "Not created"}</span></div><code>${esc(row.ruleText ?? "No rule")}</code><div class="case-bank-meta">Explain ${esc(row.explanationElapsedMs.toFixed(0))} ms · replay ${esc(row.cacheReplayElapsedMs.toFixed(1))} ms</div></section>
</div>
<div class="case-bank-branch" aria-hidden="true">↓ replay on held-out public cases</div>
<div class="case-bank-generalizations">${generalizations}</div>
<div class="case-bank-summary">Seed replay ${esc(replayStatus)} · positive ${esc(row.summary.positiveRowsPassed)}/${esc(row.summary.positiveRows)} · FNR ${esc(percent(row.summary.falseNegativeRate))} · FPR ${esc(percent(row.summary.falsePositiveRate))} · rubric ${esc(percent(row.rubric?.score))}</div>
</article>`;
}

function fullBenchmarkRows(report: TranslationBenchReport): string {
    if (report.explainer === undefined || report.explainer.rows.length === 0) {
        return "<p>No seed/generalization rows.</p>";
    }
    const options = report.explainer.rows
        .map(
            (row, index) =>
                `<option value="${index}">${esc(`${row.model} · ${row.caseId}`)}</option>`,
        )
        .join("");
    const panels = report.explainer.rows
        .map((row, index) => caseBankPanel(report, row, index))
        .join("");
    return `<div class="row-trace-picker"><label for="translation-bench-case-bank-select">Benchmark row</label><select id="translation-bench-case-bank-select">${options}</select></div>
<div id="translation-bench-case-banks">${panels}</div>
<script>(()=>{const select=document.getElementById("translation-bench-case-bank-select");const panels=[...document.querySelectorAll("[data-translation-bench-case-bank]")];if(select===null)return;const show=()=>{for(const panel of panels)panel.hidden=panel.dataset.translationBenchCaseBank!==select.value;};select.addEventListener("change",show);show();})();</script>`;
}

function rowTable(report: TranslationBenchReport): string {
    if (report.rows.length === 0) return "<p>No cases.</p>";
    // Reuse compact rows JSON when already embedded by singleRowTrace; also embed
    // a slim cases index (with rawChosen) for the paginated table.
    const cases = report.rows.map((row) => ({
        status: rowStatus(row),
        error: row.error,
        model: row.model,
        scenarioId: row.scenarioId,
        caseId: row.caseId,
        lineageLabel: `${row.lineage.dataset}:${row.lineage.rowId}`,
        sourceUrl: row.lineage.sourceUrl,
        activeActionCount: row.activeActionCount,
        shapeKey: row.shape.key,
        elapsedMs: Math.round(row.elapsedMs),
        usage: row.usage,
        expectedActions: row.expectedActions,
        chosenActions: row.chosenActions,
        rawChosenActions: row.rawChosenActions,
        diagnostics: row.score.diagnostics,
        passed: row.score.passed,
    }));
    return `${embedJson("translation-bench-cases-json", cases)}
<details class="tb-collapse" open>
<summary><strong>Cases</strong> <span class="meta">(${cases.length} rows · virtualized, 50/page)</span></summary>
<div class="row-trace-picker" style="margin-top:10px">
<label for="translation-bench-cases-filter">Filter</label>
<input id="translation-bench-cases-filter" type="search" placeholder="PASS/FAIL · model · case id" style="min-width:min(100%,280px);padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--fg)"/>
<button type="button" id="translation-bench-cases-prev">Prev</button>
<span id="translation-bench-cases-page" class="meta"></span>
<button type="button" id="translation-bench-cases-next">Next</button>
</div>
<div id="translation-bench-cases-host" style="overflow:auto;max-height:70vh"></div>
</details>
<script>(()=>{
const cases=JSON.parse(document.getElementById("translation-bench-cases-json").textContent||"[]");
const host=document.getElementById("translation-bench-cases-host");
const filterEl=document.getElementById("translation-bench-cases-filter");
const prev=document.getElementById("translation-bench-cases-prev");
const next=document.getElementById("translation-bench-cases-next");
const pageEl=document.getElementById("translation-bench-cases-page");
if(!host)return;
const esc=s=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const int=v=>v==null?"N/A":Math.round(v).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,",");
const cost=v=>v==null?"N/A":"$"+Number(v).toFixed(6);
const PAGE=50; let page=0; let filtered=cases;
const apply=()=>{
  const q=(filterEl&&filterEl.value||"").trim().toLowerCase();
  filtered=q?cases.filter(r=>[r.status,r.model,r.scenarioId,r.caseId,r.lineageLabel].join(" ").toLowerCase().includes(q)):cases;
  page=0; draw();
};
const draw=()=>{
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE));
  if(page>=pages)page=pages-1;
  if(page<0)page=0;
  const slice=filtered.slice(page*PAGE,page*PAGE+PAGE);
  if(pageEl)pageEl.textContent='Page '+(page+1)+'/'+pages+' · '+filtered.length+' rows';
  const body=slice.map(r=>{
    const result=r.error?('ERROR: '+r.error):r.status;
    const u=r.usage||{};
    const detail=JSON.stringify({diagnostics:r.diagnostics,expected:r.expectedActions,chosen:r.chosenActions,rawChosen:r.rawChosenActions},null,2);
    return '<tr class="'+(r.passed?"pass":"fail")+'"><td>'+esc(result)+'</td><td>'+esc(r.model)+'</td><td>'+esc(r.scenarioId)+'</td><td>'+esc(r.caseId)+'</td>'+
      '<td><a href="'+esc(r.sourceUrl)+'">'+esc(r.lineageLabel)+'</a></td><td>'+esc(r.activeActionCount)+'</td><td>'+esc(r.shapeKey)+'</td><td>'+esc(r.elapsedMs)+'</td>'+
      '<td>'+esc(int(u.promptTokens))+'</td><td>'+esc(int(u.cachedTokens))+'</td><td>'+esc(int(u.reasoningTokens))+'</td><td>'+esc(int(u.completionTokens))+'</td><td>'+esc(cost(u.estimatedCostUsd))+'</td>'+
      '<td><details><summary>'+esc((r.expectedActions||[]).length)+' expected / '+esc((r.chosenActions||[]).length)+' chosen</summary><pre>'+esc(detail)+'</pre></details></td></tr>';
  }).join("");
  host.innerHTML='<table><thead><tr><th>Result</th><th>Model</th><th>Scenario</th><th>Case</th><th>Lineage</th><th>Active actions</th><th>Shape</th><th>ms</th><th>Prompt</th><th>Cached</th><th>Reasoning</th><th>Output</th><th>Cost</th><th>Actions</th></tr></thead><tbody>'+body+'</tbody></table>';
};
if(filterEl)filterEl.addEventListener("input",apply);
if(prev)prev.addEventListener("click",()=>{page--;draw();});
if(next)next.addEventListener("click",()=>{page++;draw();});
apply();
})();</script>`;
}

/** Virtualized breakdown table for large key×summary lists (action/dimension). */
function virtualSummaryBreakdown(
    title: string,
    firstHeader: string,
    entries: TranslationBenchBreakdown[],
    embedId: string,
): string {
    if (entries.length === 0) {
        return `<p>No ${esc(title.toLowerCase())}.</p>`;
    }
    // Keep payload lean: only fields the table renders.
    const compact = entries.map((entry) => ({
        key: entry.key,
        s: {
            passedCases: entry.summary.passedCases,
            totalCases: entry.summary.totalCases,
            passRate: entry.summary.passRate,
            exactPassRate: entry.summary.exactPassRate,
            schemaValidRate: entry.summary.schemaValidRate,
            toolScore: entry.summary.toolScore,
            paramScore: entry.summary.paramScore,
            falseNegativeRate: entry.summary.falseNegativeRate,
            falsePositiveRate: entry.summary.falsePositiveRate,
            errors: entry.summary.errors,
            p50LatencyMs: entry.summary.p50LatencyMs,
            p95LatencyMs: entry.summary.p95LatencyMs,
            usage: entry.summary.usage,
        },
    }));
    return `${embedJson(embedId, compact)}
<details class="tb-collapse">
<summary><strong>${esc(title)}</strong> <span class="meta">(${compact.length} rows · click to expand · virtualized)</span></summary>
<div class="row-trace-picker" style="margin-top:10px">
<label for="${esc(embedId)}-filter">Filter</label>
<input id="${esc(embedId)}-filter" type="search" placeholder="${esc(firstHeader)}" style="min-width:min(100%,280px);padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--fg)"/>
<button type="button" id="${esc(embedId)}-prev">Prev</button>
<span id="${esc(embedId)}-page" class="meta"></span>
<button type="button" id="${esc(embedId)}-next">Next</button>
</div>
<div id="${esc(embedId)}-host" style="overflow:auto;max-height:60vh"></div>
</details>
<script>(()=>{
const id=${JSON.stringify(embedId)};
const rows=JSON.parse(document.getElementById(id).textContent||"[]");
const host=document.getElementById(id+"-host");
const filterEl=document.getElementById(id+"-filter");
const prev=document.getElementById(id+"-prev");
const next=document.getElementById(id+"-next");
const pageEl=document.getElementById(id+"-page");
if(!host)return;
const esc=s=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const pct=v=>v==null?"N/A":(v*100).toFixed(1)+"%";
const int=v=>v==null?"N/A":Math.round(v).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,",");
const cost=v=>v==null?"N/A":"$"+Number(v).toFixed(6);
const PAGE=50; let page=0; let filtered=rows;
const cells=s=>{
  const u=s.usage||{};
  return [s.passedCases+"/"+s.totalCases,pct(s.passRate),pct(s.exactPassRate),pct(s.schemaValidRate),pct(s.toolScore),pct(s.paramScore),pct(s.falseNegativeRate),pct(s.falsePositiveRate),String(s.errors),Math.round(s.p50LatencyMs)+" / "+Math.round(s.p95LatencyMs),int(u.promptTokens),int(u.cachedTokens),int(u.reasoningTokens),int(u.completionTokens),cost(u.estimatedCostUsd)].map(v=>"<td>"+esc(v)+"</td>").join("");
};
const apply=()=>{
  const q=(filterEl&&filterEl.value||"").trim().toLowerCase();
  filtered=q?rows.filter(r=>String(r.key).toLowerCase().includes(q)):rows;
  page=0; draw();
};
const draw=()=>{
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE));
  if(page>=pages)page=pages-1; if(page<0)page=0;
  if(pageEl)pageEl.textContent="Page "+(page+1)+"/"+pages+" · "+filtered.length+" rows";
  const body=filtered.slice(page*PAGE,page*PAGE+PAGE).map(r=>"<tr><th>"+esc(r.key)+"</th>"+cells(r.s)+"</tr>").join("");
  host.innerHTML='<table><thead><tr><th>${esc(firstHeader)}</th>${SUMMARY_METRIC_HEADERS}</tr></thead><tbody>'+body+'</tbody></table>';
};
if(filterEl)filterEl.addEventListener("input",apply);
if(prev)prev.addEventListener("click",()=>{page--;draw();});
if(next)next.addEventListener("click",()=>{page++;draw();});
apply();
})();</script>`;
}

function explainerSummaryCells(
    summary: TranslationBenchExplainerAggregate,
): string {
    return [
        `${summary.ruleCreatedCases}/${summary.totalCases}`,
        `${summary.seedReplayPassedCases}/${summary.totalCases}`,
        `${summary.positiveRowsPassed}/${summary.positiveRows}`,
        percent(summary.toolScore),
        percent(summary.paramScore),
        percent(summary.falseNegativeRate),
        percent(summary.falsePositiveRate),
        `${summary.collisionRows} / ${summary.collisionCount}`,
        `${summary.errors} / ${summary.rubricErrors}`,
        `${summary.rubricCases}/${summary.totalCases}`,
        percent(summary.rubricScore),
        summary.rubricCriteria === undefined
            ? "N/A"
            : [
                  summary.rubricCriteria.correctness,
                  summary.rubricCriteria.coverage,
                  summary.rubricCriteria.overGeneralization,
                  summary.rubricCriteria.slotBinding,
                  summary.rubricCriteria.specificity,
              ]
                  .map((value) => (value * 100).toFixed(0))
                  .join(" / "),
        `${Math.round(summary.avgExplanationLatencyMs)} / ${Math.round(summary.avgCacheReplayLatencyMs)}`,
        integer(summary.explanationUsage.promptTokens),
        integer(summary.explanationUsage.cachedTokens),
        integer(summary.explanationUsage.reasoningTokens),
        integer(summary.explanationUsage.completionTokens),
        cost(summary.explanationUsage.estimatedCostUsd),
        cost(summary.rubricUsage.estimatedCostUsd),
    ]
        .map((value) => `<td>${esc(value)}</td>`)
        .join("");
}

function explainerSummaryTable(report: TranslationBenchReport): string {
    if (report.explainer === undefined) return "<p>Not run.</p>";
    const rows = report.explainer.byModel
        .map(
            (entry) =>
                `<tr><th>${esc(entry.key)}</th>${explainerSummaryCells(entry.summary)}</tr>`,
        )
        .join("");
    return `<table><thead><tr><th>Model</th><th>Rules</th><th>Seed replay</th><th>Positive pass</th><th>Tool score</th><th>Param score</th><th>FNR</th><th>FPR</th><th>Collision rows / extra</th><th>Rule / rubric errors</th><th>Rubric cases</th><th>Rubric mean</th><th>Rubric C / C / O / S / S</th><th>Explain / replay ms</th><th>Prompt</th><th>Cached</th><th>Reasoning</th><th>Output</th><th>Explain cost</th><th>Rubric cost</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function explainerRowsTable(report: TranslationBenchReport): string {
    if (report.explainer === undefined) return "";
    const rows = report.explainer.rows
        .map((row) => {
            const status = row.error
                ? `ERROR: ${row.error}`
                : row.summary.passRate === 1 && row.seedReplay.score.passed
                  ? "PASS"
                  : "FAIL";
            return `<tr class="${status === "PASS" ? "pass" : "fail"}">
<td>${esc(status)}</td><td>${esc(row.model)}</td><td>${esc(row.caseId)}</td><td>${esc(row.ruleCreated)}</td><td>${esc(row.summary.positiveRowsPassed)}/${esc(row.summary.positiveRows)}</td><td>${esc(percent(row.summary.falsePositiveRate))}</td><td>${esc(row.explanationElapsedMs.toFixed(0))}</td><td>${esc(row.cacheReplayElapsedMs.toFixed(0))}</td>
<td><details><summary>${esc(row.ruleText ?? "No rule")}</summary><pre>${esc(JSON.stringify({ ruleJson: row.ruleJson, explanationData: row.explanationData, seedReplay: row.seedReplay, probes: row.probes }, null, 2))}</pre></details></td>
<td><pre>${esc(row.rubric ? JSON.stringify(row.rubric, null, 2) : (row.rubricError ?? "Not run"))}</pre></td></tr>`;
        })
        .join("");
    return `<table><thead><tr><th>Result</th><th>Model</th><th>Case</th><th>Rule created</th><th>Positive pass</th><th>FPR</th><th>Explain ms</th><th>Replay ms</th><th>Rule and deterministic probes</th><th>Optional rubric</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderTranslationBenchHtml(
    report: TranslationBenchReport,
): string {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.suiteName)} translation benchuation</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#17202a;--muted:#667085;--line:#d0d5dd;--panel:#f8fafc;--good:#067647;--bad:#b42318;--code:#eef2f6} @media(prefers-color-scheme:dark){:root{--bg:#101828;--fg:#f2f4f7;--muted:#98a2b3;--line:#344054;--panel:#1d2939;--good:#6ce9a6;--bad:#fda29b;--code:#344054}}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:28px}h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}.meta,.row-trace-meta{color:var(--muted)}table{width:100%;border-collapse:collapse;background:var(--panel)}th,td{border:1px solid var(--line);padding:7px 8px;text-align:right;vertical-align:top}th:first-child,td:first-child{text-align:left}thead th{position:sticky;top:0;background:var(--panel)}tr.pass td:first-child,.row-trace.pass .row-trace-status{color:var(--good)}tr.fail td:first-child,.row-trace.fail .row-trace-status,.row-trace-error{color:var(--bad)}pre{max-width:900px;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left}a{color:inherit}[hidden]{display:none!important}.diag-rate,.diag-note{color:var(--muted)}.diag-note{margin:8px 0 0}
.row-trace-picker{display:flex;align-items:center;gap:10px;margin:0 0 12px}.row-trace-picker label,.row-trace-label{font-weight:600}.row-trace-picker select{min-width:min(100%,520px);padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--fg)}.row-trace{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:14px}.row-trace-heading{display:flex;gap:10px;align-items:baseline;margin-bottom:12px}.row-trace-flow{display:grid;grid-template-columns:minmax(0,1.1fr) 22px minmax(0,1fr) 22px minmax(0,1fr) 22px minmax(0,.9fr);align-items:stretch}.row-trace-step{min-width:0;border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:12px}.row-trace-step blockquote{font-size:16px;margin:10px 0}.row-trace-step a{display:block;color:var(--muted);overflow-wrap:anywhere}.row-trace-arrow{display:grid;place-items:center;color:var(--muted);font-size:18px}.row-trace-actions{margin:10px 0 0;padding-left:20px}.row-trace-actions li+li{margin-top:10px}.row-trace-actions pre{max-width:none;margin:6px 0 0;padding:8px;border-radius:6px;background:var(--code)}.row-trace-empty{color:var(--muted);margin:10px 0 0}.row-trace-score dl{margin:10px 0 0}.row-trace-score dl div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:5px 0}.row-trace-score dt{color:var(--muted)}.row-trace-score dd{font-weight:600;margin:0}.row-trace-diagnostics{margin:10px 0 0;padding-left:18px}.row-trace-meta{margin-top:10px}.row-trace-error{overflow-wrap:anywhere}
.case-bank{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:14px;overflow-wrap:anywhere}.case-bank-heading,.case-bank-node-heading{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.case-bank-heading{margin-bottom:12px}.case-bank.pass>.case-bank-heading .case-bank-status,.case-bank-node.pass .case-bank-status{color:var(--good)}.case-bank.fail>.case-bank-heading .case-bank-status,.case-bank-node.fail .case-bank-status{color:var(--bad)}.case-bank-seed-flow{display:grid;grid-template-columns:minmax(0,1fr) 32px minmax(0,.8fr);align-items:stretch}.case-bank-node{min-width:0;border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:12px}.case-bank-node blockquote{font-size:15px;margin:10px 0}.case-bank-source{display:block;color:var(--muted);margin-top:8px;overflow-wrap:anywhere}.case-bank-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}.case-bank-meta{color:var(--muted);margin-top:10px}.case-bank-history{margin-top:8px}.case-bank-history pre{max-width:none;background:var(--code);border-radius:6px;padding:8px}.case-bank-rule code{display:block;background:var(--code);border-radius:6px;margin-top:12px;padding:10px;overflow-wrap:anywhere}.case-bank-arrow{display:grid;place-items:center;color:var(--muted);font-size:18px}.case-bank-branch{text-align:center;color:var(--muted);padding:9px 0}.case-bank-generalizations{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.case-bank-summary{border-top:1px solid var(--line);color:var(--muted);margin-top:12px;padding-top:10px}
@media(max-width:1100px){main{padding:18px}.row-trace-flow{grid-template-columns:1fr}.row-trace-arrow{height:24px;transform:rotate(90deg)}}@media(max-width:900px){.case-bank-seed-flow{grid-template-columns:1fr}.case-bank-arrow{height:24px;transform:rotate(90deg)}}@media(max-width:600px){.row-trace-picker{align-items:stretch;flex-direction:column}.row-trace-picker select{width:100%}.row-trace-heading,.case-bank-heading,.case-bank-node-heading{align-items:flex-start;flex-direction:column;gap:2px}.case-bank-actions,.case-bank-generalizations{grid-template-columns:1fr}}
.row-trace-meta{overflow-wrap:anywhere}
details.tb-collapse{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:10px 14px;margin:12px 0}
details.tb-collapse>summary{cursor:pointer;font-weight:600}
details.tb-collapse[open]>summary{margin-bottom:10px}
pre.tb-scroll{max-height:320px;overflow:auto;background:var(--code);border-radius:8px;padding:10px}
</style></head><body><main>
<h1>${esc(report.suiteName)}</h1><div class="meta">Deterministic translation score · strategy ${esc(report.settings.strategy)} · streaming off · heavy sections virtualized</div>
<h2>Model summary</h2>${headlineTable(report)}
<h2>Deterministic diagnostic counts</h2>${diagnosticsTable(report)}
<h2>Single-row translation trace</h2>${singleRowTrace(report)}
<h2>Cases</h2>${rowTable(report)}
<h2>Action reliability</h2>${actionReliabilityTable(report)}
<h2>Model × settings scenario</h2>${scenarioTable(report)}
<h2>Model × action count (active × expected)</h2>${actionCountTable(report)}
<h2>Model × builder dimension</h2>${dimensionTable(report)}
<h2>Model × action shape</h2>${shapeTable(report)}
<details class="tb-collapse"><summary><strong>Full benchmark row · seed and generalizations</strong></summary>${fullBenchmarkRows(report)}</details>
<details class="tb-collapse"><summary><strong>Visible existing TypeAgent catalog</strong></summary><pre class="tb-scroll">${esc(report.catalog ? JSON.stringify(report.catalog, null, 2) : "Not recorded")}</pre></details>
<details class="tb-collapse"><summary><strong>Deterministic explainer score</strong></summary>${explainerSummaryTable(report)}</details>
<details class="tb-collapse"><summary><strong>Explainer cases and optional qualitative rubric</strong></summary>${explainerRowsTable(report)}</details>
<details class="tb-collapse"><summary><strong>Benchmark provenance and selection ledger</strong></summary><pre class="tb-scroll">${esc(report.provenance ? JSON.stringify(report.provenance, null, 2) : "Not recorded")}</pre></details>
<details class="tb-collapse"><summary><strong>Evaluation settings</strong></summary><pre class="tb-scroll">${esc(JSON.stringify({ settings: report.settings, schemaHashes: report.schemaHashes, pricing: report.pricing }, null, 2))}</pre></details>
</main></body></html>`;
}
