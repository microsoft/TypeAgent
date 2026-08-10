#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

const htmlPath = process.argv[2];
if (!htmlPath || !fs.existsSync(htmlPath)) {
    console.error("usage: inject-score-help.mjs <eval-report.html>");
    process.exit(1);
}

let html = fs.readFileSync(htmlPath, "utf8");
if (html.includes('class="tb-collapse score-help"')) {
    console.log("score-help already present:", htmlPath);
    process.exit(0);
}

function pct(n, d) {
    if (!d) return "N/A";
    return ((n / d) * 100).toFixed(1) + "%";
}
function int(n) {
    return Math.round(n)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function mf(num, den) {
    return `<span class="mf"><span class="num">${num}</span><span class="den">${den}</span></span>`;
}

const rowsMatch = html.match(
    /id="translation-bench-rows-json">([\s\S]*?)<\/script>/,
);
if (!rowsMatch) {
    console.error("missing translation-bench-rows-json");
    process.exit(1);
}
const rows = JSON.parse(rowsMatch[1]);
const total = rows.length;
let pass = 0,
    exact = 0,
    schema = 0,
    pos = 0,
    neg = 0,
    toolSum = 0,
    toolN = 0,
    paramSum = 0,
    paramN = 0,
    fnr = 0,
    fpr = 0,
    errors = 0,
    lat = [],
    prompt = 0,
    cached = 0,
    reasoning = 0,
    completion = 0,
    cost = 0;
let toolEx = null,
    paramEx = null;

for (const r of rows) {
    const sc = r.score || {};
    const isNeg =
        sc.isNegative === true ||
        (!(r.expectedActions || []).length && sc.isNegative !== false);
    if (r.status === "ERROR" || r.error) errors += 1;
    if (sc.passed) pass += 1;
    if (sc.exactPassed) exact += 1;
    if (sc.schemaValid) schema += 1;
    if (isNeg) {
        neg += 1;
        if (
            sc.firedOnNegative ||
            (sc.chosenCount ?? (r.chosenActions || []).length) > 0
        )
            fpr += 1;
    } else {
        pos += 1;
        const exp = (sc.expectedCount ?? (r.expectedActions || []).length) || 1;
        const routed = sc.routed ?? 0;
        const pm = sc.paramMatches ?? 0;
        if (exp > 0) {
            toolSum += routed / exp;
            toolN += 1;
            paramSum += pm / exp;
            paramN += 1;
            if (!toolEx) toolEx = { routed, exp };
            if (!paramEx) paramEx = { pm, exp };
        }
        if (routed < exp) fnr += 1;
    }
    if (Number.isFinite(r.elapsedMs)) lat.push(r.elapsedMs);
    const u = r.usage || {};
    prompt += u.promptTokens || 0;
    cached += u.cachedTokens || 0;
    reasoning += u.reasoningTokens || 0;
    completion += u.completionTokens || 0;
    cost += u.estimatedCostUsd || r.estimatedCostUsd || 0;
}
lat.sort((a, b) => a - b);
const p50 = lat.length ? lat[Math.floor(lat.length * 0.5)] : 0;
const p95 = lat.length
    ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))]
    : 0;
const toolAvg = toolN ? toolSum / toolN : 0;
const paramAvg = paramN ? paramSum / paramN : 0;

const cssExtra = `
.diag-rate,.diag-note{color:var(--muted)}.diag-note{margin:8px 0 0}
.mf{display:inline-flex;flex-direction:column;text-align:center;vertical-align:middle;margin:0 .15em;font-style:italic}
.mf>.den{border-top:1px solid currentColor;padding-top:1px}
.mf>.num{padding-bottom:1px}
.score-help table th,.score-help table td{text-align:left}
.score-help .mf{align-items:flex-start;text-align:left}
.score-help table{table-layout:fixed}
.score-help col.c-metric{width:9em}
.score-help col.c-formula{width:20em}
.score-help col.c-example{width:15em}
.score-help col.c-dir{width:9em}
.score-help td{overflow-wrap:anywhere}
.score-help .diag-rate{display:block;margin-top:3px}
th.metric-link{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}
th.metric-link:hover{color:var(--good)}
#mx-ov{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;z-index:50}
#mx-ov.open{display:block}
#mx-panel{position:absolute;top:0;right:0;height:100%;width:min(760px,94vw);background:var(--bg);border-left:1px solid var(--line);box-shadow:-8px 0 24px rgba(0,0,0,.25);display:flex;flex-direction:column}
#mx-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line)}
#mx-head h3{margin:0;font-size:16px}
#mx-sub{color:var(--muted)}
#mx-close{cursor:pointer;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--fg);padding:4px 10px;font-size:14px}
#mx-body{overflow:auto;padding:14px 18px}
.mx-ex{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:12px;margin:0 0 12px}
.mx-ut{font-weight:600;margin:0 0 8px}
.mx-exp{color:var(--muted);margin:0 0 8px;overflow-wrap:anywhere}
.mx-exp code{background:var(--code);border-radius:4px;padding:1px 4px}
.mx-m{display:grid;grid-template-columns:150px 1fr auto;gap:8px;align-items:baseline;border-top:1px solid var(--line);padding:6px 0;overflow-wrap:anywhere}
.mx-m .ok{color:var(--good)}
.mx-m .no{color:var(--bad)}
.mx-m code{background:var(--code);border-radius:4px;padding:1px 4px}
`;

const scoreHelp = `
<details class="tb-collapse score-help" open><summary><strong>How each score is calculated</strong></summary>
<p class="meta">One <em>cell</em> = one utterance × one model. <strong>Positive</strong> cells expect actions; <strong>negative</strong> cells expect none (model should abstain). Columns are means/sums of the per-cell fields shown in each trace row. <strong>Click an underlined metric name below</strong> to open up to 30 example utterances with each model's result.</p>
<table><colgroup><col class="c-metric"><col class="c-formula"><col class="c-example"><col class="c-dir"></colgroup><thead><tr><th>Column</th><th>Formula</th><th>Example</th><th>Direction</th></tr></thead><tbody>
<tr><th class="metric-link" data-metric="pass">Pass rate</th><td>${mf("passing cells", "all cells")}<span class="diag-rate">pass = right action routed + required params match; negatives = fired nothing</span></td><td>${mf(pass, total)} = ${pct(pass, total)}</td><td>↑ higher is better</td></tr>
<tr><th class="metric-link" data-metric="exact">Exact rate</th><td>${mf("exact-pass cells", "all cells")}<span class="diag-rate">like pass, but params match exactly</span></td><td>${mf(exact, total)} = ${pct(exact, total)}</td><td>↑ higher is better</td></tr>
<tr><th class="metric-link" data-metric="schema">Schema-valid</th><td>${mf("schema-valid cells", "all cells")}</td><td>${mf(schema, total)} = ${pct(schema, total)}</td><td>↑ higher is better</td></tr>
<tr><th class="metric-link" data-metric="tool">Tool score</th><td><span class="mrow">mean<sub>pos cells</sub> ${mf("routed", "expected")}</span></td><td>e.g. ${toolEx ? mf(toolEx.routed, toolEx.exp) : "n/a"}, avg = ${pct(toolAvg, 1)}</td><td>↑ higher is better</td></tr>
<tr><th class="metric-link" data-metric="param">Param score</th><td><span class="mrow">mean<sub>pos cells</sub> ${mf("paramMatches", "expected")}</span></td><td>e.g. ${paramEx ? mf(paramEx.pm, paramEx.exp) : "n/a"}, avg = ${pct(paramAvg, 1)}</td><td>↑ higher is better</td></tr>
<tr><th class="metric-link" data-metric="fnr">FNR</th><td>${mf("positives missing a required action", "positive cells")}</td><td>${mf(fnr, pos)} = ${pct(fnr, pos)}</td><td>↓ lower is better</td></tr>
<tr><th class="metric-link" data-metric="fpr">FPR</th><td>${mf("negatives that fired an action", "negative cells")}</td><td>${mf(fpr, neg)} = ${pct(fpr, neg)}</td><td>↓ lower is better</td></tr>
<tr><th class="metric-link" data-metric="errors">Errors</th><td>count of cells that threw during translation</td><td>${errors} cells</td><td>↓ lower is better</td></tr>
<tr><th>P50 / P95 ms</th><td>median / 95th-pct of per-cell latency</td><td>${int(p50)} / ${int(p95)} ms</td><td>↓ lower is better</td></tr>
<tr><th>Prompt / Cached / Reasoning / Output</th><td>Σ token counts over all cells</td><td>Σ = ${int(prompt)} prompt · ${int(cached)} cached · ${int(reasoning)} reasoning · ${int(completion)} output</td><td>↓ lower is cheaper</td></tr>
<tr><th>Cost</th><td>Σ per-cell USD over all cells</td><td>Σ = $${cost.toFixed(2)}</td><td>↓ lower is better</td></tr>
</tbody></table>
<p class="meta"><strong>Diagnostic counts</strong> below explain <em>why</em> cells failed (wrong route, missing/extra/wrong param, invalid JSON); one cell may hit several buckets.</p>
</details>
`;

const modal = `<div id="mx-ov"><div id="mx-panel"><div id="mx-head"><div><h3 id="mx-title">Examples</h3><div id="mx-sub"></div></div><button id="mx-close">Close ✕</button></div><div id="mx-body"></div></div></div>`;

const script = `
<script>
(function(){
var rows=JSON.parse(document.getElementById("translation-bench-rows-json").textContent);
var byCase={};rows.forEach(function(r){(byCase[r.caseId]=byCase[r.caseId]||[]).push(r);});
var cfg={
 pass:{title:"Failed pass",sub:"cases where at least one model did not pass",test:function(r){return !(r.score&&r.score.passed);}},
 exact:{title:"Failed exact match",sub:"cases where a model passed but not exactly",test:function(r){return r.score&&r.score.passed&&!r.score.exactPassed;}},
 schema:{title:"Schema-invalid",sub:"cases where output failed schema validation",test:function(r){return r.score&&!r.score.schemaValid;}},
 tool:{title:"Tool-score misses",sub:"positive cases with a wrong/missing route",test:function(r){return r.score&&!r.score.isNegative&&r.score.routed<r.score.expectedCount;}},
 param:{title:"Param-score misses",sub:"positive cases with a parameter mismatch",test:function(r){return r.score&&!r.score.isNegative&&r.score.paramMatches<r.score.expectedCount;}},
 fnr:{title:"False negatives (FNR)",sub:"positive cases where the model abstained / under-fired",test:function(r){return r.score&&!r.score.isNegative&&r.score.routed<r.score.expectedCount&&r.score.chosenCount<r.score.expectedCount;}},
 fpr:{title:"False positives (FPR)",sub:"negative cases where the model fired an action",test:function(r){return r.score&&r.score.isNegative&&r.score.firedOnNegative;}},
 errors:{title:"Errors",sub:"cases that threw during translation",test:function(r){return r.status==="ERROR"||!!r.error;}}
};
function esc(s){return String(s).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}
function acts(a){if(!a||!a.length)return "<em>(none)</em>";return a.map(function(x){var p=x.parameters?" "+esc(JSON.stringify(x.parameters)):"";return "<code>"+esc(x.schemaName+"."+x.actionName)+"</code>"+p;}).join("<br>");}
function open(metric){
 var c=cfg[metric];if(!c)return;
 var ids=Object.keys(byCase).filter(function(id){return byCase[id].some(c.test);}).slice(0,30);
 var html=ids.map(function(id){
  var group=byCase[id];var first=group[0];
  var models=group.map(function(r){
   var bad=c.test(r);var cls=bad?"no":"ok";
   return '<div class="mx-m"><div>'+esc(String(r.model).replace("azure/",""))+'</div><div>'+acts(r.chosenActions)+'</div><div class="'+cls+'">'+(bad?"✗":"✓")+'</div></div>';
  }).join("");
  return '<div class="mx-ex"><p class="mx-ut">'+esc(first.utterance||"(no utterance)")+'</p><p class="mx-exp">Expected: '+acts(first.expectedActions)+'</p>'+models+'</div>';
 }).join("");
 document.getElementById("mx-title").textContent=c.title;
 document.getElementById("mx-sub").textContent=c.sub+" · "+ids.length+" example(s), each model's chosen action";
 document.getElementById("mx-body").innerHTML=html||"<p>No matching examples.</p>";
 document.getElementById("mx-ov").classList.add("open");
}
document.querySelectorAll("th.metric-link").forEach(function(th){th.addEventListener("click",function(){open(th.getAttribute("data-metric"));});});
var ov=document.getElementById("mx-ov");
document.getElementById("mx-close").addEventListener("click",function(){ov.classList.remove("open");});
ov.addEventListener("click",function(e){if(e.target===ov)ov.classList.remove("open");});
document.addEventListener("keydown",function(e){if(e.key==="Escape")ov.classList.remove("open");});
})();
</script>
`;

html = html.replace("</style>", cssExtra + "\n</style>");

// Insert score-help after first model summary table (after </table> following Model summary)
const modelH2 = html.indexOf("<h2>Model summary</h2>");
if (modelH2 < 0) {
    console.error("Model summary heading not found");
    process.exit(1);
}
const afterTable = html.indexOf("</table>", modelH2);
if (afterTable < 0) {
    console.error("model summary table end not found");
    process.exit(1);
}
const insertAt = afterTable + "</table>".length;
html = html.slice(0, insertAt) + "\n" + scoreHelp + html.slice(insertAt);

// modal + script before </body> or </main>
if (html.includes("</main>")) {
    html = html.replace("</main>", modal + "\n" + script + "\n</main>");
} else {
    html = html.replace("</body>", modal + "\n" + script + "\n</body>");
}

const out =
    process.env.TB_SCORE_HELP_OUT ||
    htmlPath.replace(/\.html$/, "") + "-with-score-help.html";
// overwrite in place by default when TB_IN_PLACE=1
const dest = process.env.TB_IN_PLACE === "1" ? htmlPath : out;
fs.writeFileSync(dest, html);
console.log(
    JSON.stringify(
        {
            dest,
            cells: total,
            pass,
            exact,
            pos,
            neg,
            fnr,
            fpr,
            errors,
            passRate: pct(pass, total),
            exactRate: pct(exact, total),
        },
        null,
        2,
    ),
);
