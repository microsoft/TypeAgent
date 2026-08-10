#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Build a self-contained interactive HTML explorer for the 1k translation-bench dataset.
 * Usage: node update-dataset-viz.mjs [out.html]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN = __dirname;
const artDir = process.env.TB_ART_DIR
    ? path.resolve(process.env.TB_ART_DIR)
    : path.join(RUN, "artifacts");
const checkpoint =
    process.env.TB_CHECKPOINT_PATH ||
    path.join(artDir, "generate-checkpoint.jsonl");
const draft =
    process.env.TB_DRAFT_PATH ||
    path.join(artDir, "benchmark-draft-1000.jsonl");
const approved =
    process.env.TB_APPROVED_PATH ||
    path.join(artDir, "benchmark-approved-1000.jsonl");
const outHtml = process.argv[2] || path.join(RUN, "viz/dataset.html");

function readJsonl(p) {
    if (!fs.existsSync(p)) return [];
    return fs
        .readFileSync(p, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line, i) => {
            try {
                return JSON.parse(line);
            } catch {
                return { _parseError: true, line: i };
            }
        });
}

const cp = readJsonl(checkpoint);
const header = cp.find((r) => r.kind === "translation-bench-checkpoint");

const cases = [];
for (const r of cp) {
    if (r.kind === "translation-bench-checkpoint") continue;
    const v = r.value ?? r;
    if (v && (v.seed || v.id)) cases.push(v);
}

function loadBenchmarkCases(filePath) {
    if (!fs.existsSync(filePath)) return { meta: null, cases: [] };
    const d = readJsonl(filePath);
    const meta =
        d.find((x) => x.recordType === "metadata" || x.kind === "metadata") ??
        d[0];
    const loaded = d.filter(
        (x) =>
            x &&
            x.recordType !== "metadata" &&
            x.kind !== "metadata" &&
            (x.seed || x.targetAction || x.id),
    );
    return { meta, cases: loaded };
}

const approvedPack = loadBenchmarkCases(approved);
const draftPack = loadBenchmarkCases(draft);
const draftMeta = approvedPack.meta ?? draftPack.meta;
const draftCases =
    approvedPack.cases.length > 0 ? approvedPack.cases : draftPack.cases;
const datasetSourceLabel =
    approvedPack.cases.length > 0
        ? "approved"
        : draftPack.cases.length > 0
          ? "draft"
          : "checkpoint";

const source =
    draftCases.length >= cases.length && draftCases.length > 0
        ? draftCases
        : cases;
const totalTarget =
    header?.settings?.caseCount ?? draftMeta?.metadata?.caseCount ?? 1000;

const bySchema = {};
const byAction = {};
const utterances = [];
let posCount = 0;
let negCount = 0;
let withParams = 0;
let withoutParams = 0;

for (const c of source) {
    const seed = c.seed ?? c;
    const ta = c.targetAction ?? seed.expectedActions?.[0] ?? {};
    const schema = ta.schemaName ?? "unknown";
    const action = ta.actionName ?? "unknown";
    const key = `${schema}.${action}`;
    bySchema[schema] = (bySchema[schema] || 0) + 1;
    byAction[key] = (byAction[key] || 0) + 1;

    const expected = seed.expectedActions?.[0];
    const params = expected?.parameters;
    if (params && Object.keys(params).length > 0) withParams += 1;
    else withoutParams += 1;

    const gens = (c.generalizations ?? []).map((g) => {
        const role = g.selection?.role ?? g.role ?? "?";
        if (role === "positive") posCount += 1;
        if (role === "negative") negCount += 1;
        return {
            role,
            utterance: g.utterance ?? "",
            expectedActions: (g.expectedActions ?? []).map((a) => ({
                schemaName: a.schemaName,
                actionName: a.actionName,
                parameters: a.parameters ?? null,
            })),
        };
    });

    utterances.push({
        id: c.id,
        schema,
        action,
        key,
        utterance: seed.utterance ?? "",
        params: params ?? null,
        gens,
        dimensions: c.dimensions ?? seed.selection?.dimensions ?? {},
        activeSchemas: c.activeSchemas ?? [],
    });
}

const schemaSorted = Object.entries(bySchema).sort((a, b) => b[1] - a[1]);
const actionSorted = Object.entries(byAction).sort((a, b) =>
    a[0].localeCompare(b[0]),
);
const uniqueActions = actionSorted.length;
const progress = source.length;

const schedule = header?.settings?.schedule ?? [];
const scheduleActionSet = new Set(
    schedule.map((e) => `${e.schemaName}.${e.actionName}`),
);
const scheduleActionTarget =
    scheduleActionSet.size > 0
        ? scheduleActionSet.size
        : (header?.settings?.actionCount ?? uniqueActions);
const doneActionSet = new Set(Object.keys(byAction));
const missingScheduled = [...scheduleActionSet].filter(
    (k) => !doneActionSet.has(k),
);
const onTrack = missingScheduled.length === 0 && progress >= totalTarget;

// Schema → action counts for heatmap
const schemaActions = {};
for (const [key, n] of actionSorted) {
    const i = key.indexOf(".");
    const schema = i === -1 ? key : key.slice(0, i);
    const action = i === -1 ? key : key.slice(i + 1);
    if (!schemaActions[schema]) schemaActions[schema] = [];
    schemaActions[schema].push({ action, key, n });
}
for (const s of Object.keys(schemaActions)) {
    schemaActions[s].sort((a, b) => a.action.localeCompare(b.action));
}

const disambigReportPath = path.join(
    RUN,
    "artifacts/benchmark-draft-1000.disambig-report.json",
);
let disambig = null;
if (fs.existsSync(disambigReportPath)) {
    try {
        const raw = JSON.parse(fs.readFileSync(disambigReportPath, "utf8"));
        disambig = raw.summary ?? raw;
    } catch {
        disambig = null;
    }
}

// Confusable-action keys from the curated list (for explorer filters).
const CONFUSABLE_ACTION_KEYS = [
    "browser.followLinkByText",
    "browser.followLinkByPosition",
    "browser.openWebPage",
    "browser.openSearchResult",
    "browser.closeWebPage",
    "browser.external.closeTab",
    "browser.actionDiscovery.getAllWebFlows",
    "browser.actionDiscovery.detectPageActions",
    "browser.actionDiscovery.inferActions",
];
const confusableRows = utterances.filter((u) =>
    CONFUSABLE_ACTION_KEYS.includes(u.key),
).length;

const data = {
    datasetSourceLabel,
    generatedAt: new Date().toISOString(),
    progress,
    totalTarget,
    uniqueActions,
    scheduleActionTarget,
    actionsRemaining: Math.max(0, scheduleActionTarget - uniqueActions),
    coverageComplete:
        uniqueActions >= scheduleActionTarget && progress >= totalTarget,
    onTrack,
    missingScheduledSample: missingScheduled.slice(0, 20),
    schemaCount: schemaSorted.length,
    schemaSorted,
    actionSorted,
    schemaActions,
    samples: utterances,
    sampleTotal: utterances.length,
    genPos: posCount,
    genNeg: negCount,
    withParams,
    withoutParams,
    disambig,
    confusableActionKeys: CONFUSABLE_ACTION_KEYS,
    confusableRows,
    header: header
        ? {
              generatorModel: header.settings?.generatorModel ?? "gpt-5.6-sol",
              reviewerModel: header.settings?.reviewerModel ?? "gpt-5.6-sol",
              genCaseCount: header.settings?.genCaseCount ?? 2,
              requireCompleteCoverage:
                  header.settings?.requireCompleteCoverage ?? true,
              concurrency: header.settings?.concurrency,
          }
        : {
              generatorModel: "gpt-5.6-sol",
              reviewerModel: "gpt-5.6-sol",
              genCaseCount: 2,
              requireCompleteCoverage: true,
          },
    draftReady: draftCases.length > 0,
    draftMeta: draftMeta
        ? {
              name: draftMeta.name ?? draftMeta.metadata?.name,
              approval:
                  draftMeta.approval?.status ??
                  draftMeta.metadata?.approval?.status ??
                  "draft",
              caseCount: draftCases.length,
          }
        : null,
};

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Translation Bench · 1k neg-fairness dataset explorer</title>
<style>
  :root {
    --bg:#07090c; --panel:#10151c; --panel2:#141b24; --line:#243041;
    --text:#e8eef7; --muted:#8b9bb0; --faint:#5c6b80;
    --accent:#6ea8fe; --accent2:#8b5cf6; --ok:#3dd68c; --warn:#f5a524; --bad:#ff6b6b;
    --pos:#3dd68c; --neg:#f5a524;
  }
  * { box-sizing:border-box; }
  body {
    margin:0;
    font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:radial-gradient(1200px 600px at 10% -10%, #152033 0%, var(--bg) 55%);
    color:var(--text);
    min-height:100vh;
  }
  header {
    padding:22px 28px 18px;
    border-bottom:1px solid var(--line);
    background:linear-gradient(180deg, rgba(20,26,34,.95), rgba(11,13,16,.7));
    backdrop-filter: blur(8px);
    position:sticky; top:0; z-index:20;
  }
  header .row { display:flex; gap:16px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; }
  h1 { margin:0 0 4px; font-size:22px; font-weight:700; letter-spacing:-0.03em; }
  .sub { color:var(--muted); font-size:13px; max-width:720px; }
  .badge {
    display:inline-flex; align-items:center; gap:8px;
    padding:8px 12px; border-radius:999px; font-size:12px; font-weight:600;
    border:1px solid var(--line); background:var(--panel);
  }
  .badge.ok { color:var(--ok); border-color:rgba(61,214,140,.35); background:rgba(61,214,140,.08); }
  .badge.draft { color:var(--warn); border-color:rgba(245,165,36,.35); background:rgba(245,165,36,.08); }
  .dot { width:8px; height:8px; border-radius:50%; background:currentColor; box-shadow:0 0 0 3px color-mix(in srgb, currentColor 20%, transparent); }
  .wrap { padding:20px 28px 64px; max-width:1400px; margin:0 auto; }
  .grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; margin-bottom:16px; }
  .card {
    background:linear-gradient(180deg, var(--panel2), var(--panel));
    border:1px solid var(--line); border-radius:14px; padding:14px 16px;
    box-shadow:0 1px 0 rgba(255,255,255,.02) inset;
  }
  .card .label { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.07em; font-weight:600; }
  .card .value { font-size:28px; font-weight:750; margin-top:6px; letter-spacing:-0.03em; font-variant-numeric:tabular-nums; }
  .card .hint { color:var(--muted); font-size:12px; margin-top:4px; }
  .bar { height:8px; background:#1a2230; border-radius:999px; overflow:hidden; margin-top:12px; }
  .bar > i { display:block; height:100%; background:linear-gradient(90deg,#3b82f6,#8b5cf6 70%, #3dd68c); width:0%; transition:width .4s ease; }
  .two { display:grid; grid-template-columns:1.1fr .9fr; gap:14px; margin-bottom:14px; }
  .three { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; margin-bottom:14px; }
  h2 { font-size:12px; margin:0 0 12px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
  .schema-bars { display:flex; flex-direction:column; gap:7px; max-height:360px; overflow:auto; padding-right:4px; }
  .srow { display:grid; grid-template-columns:140px 1fr 36px; gap:8px; align-items:center; font-size:12px; }
  .srow .name { color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
  .srow .name:hover { color:var(--accent); }
  .sbar { height:8px; background:#1a2230; border-radius:999px; overflow:hidden; }
  .sbar > i { display:block; height:100%; background:linear-gradient(90deg,#2563eb,#6ea8fe); border-radius:999px; }
  .srow .n { color:var(--muted); text-align:right; font-variant-numeric:tabular-nums; }
  .heat { display:flex; flex-wrap:wrap; gap:4px; max-height:360px; overflow:auto; align-content:flex-start; }
  .cell {
    width:10px; height:10px; border-radius:2px; background:#1a2230;
    border:1px solid transparent; cursor:pointer;
  }
  .cell.on { background:color-mix(in srgb, var(--ok) 75%, #1a2230); }
  .cell:hover { outline:1px solid var(--accent); outline-offset:1px; }
  .legend { display:flex; gap:12px; flex-wrap:wrap; color:var(--muted); font-size:12px; margin-top:10px; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  .sw { width:10px; height:10px; border-radius:2px; display:inline-block; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:10px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:650; font-size:11px; text-transform:uppercase; letter-spacing:.05em; position:sticky; top:0; background:var(--panel); }
  tr:hover td { background:rgba(255,255,255,.02); }
  .pill {
    display:inline-block; padding:2px 8px; border-radius:999px;
    background:#1a2433; border:1px solid var(--line); font-size:11px; color:var(--accent);
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; max-width:280px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .role {
    display:inline-block; min-width:62px; text-align:center;
    padding:1px 7px; border-radius:999px; font-size:10px; font-weight:700;
    text-transform:uppercase; letter-spacing:.04em;
  }
  .role.pos { color:var(--pos); background:rgba(61,214,140,.12); border:1px solid rgba(61,214,140,.25); }
  .role.neg { color:var(--neg); background:rgba(245,165,36,.12); border:1px solid rgba(245,165,36,.25); }
  .role.seed { color:var(--accent); background:rgba(110,168,254,.12); border:1px solid rgba(110,168,254,.25); }
  .utt { color:var(--text); }
  .gen { font-size:12px; color:var(--muted); margin-top:6px; display:flex; gap:8px; align-items:flex-start; }
  .gen .t { flex:1; }
  .muted { color:var(--muted); }
  .faint { color:var(--faint); font-size:11px; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  input, select {
    background:#0c1118; border:1px solid var(--line); color:var(--text);
    border-radius:10px; padding:9px 11px; width:100%; outline:none;
  }
  input:focus, select:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(110,168,254,.15); }
  .filters { display:grid; grid-template-columns:1.4fr 180px 140px 120px 120px; gap:10px; margin-bottom:12px; }
  .toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px; flex-wrap:wrap; }
  .count { color:var(--muted); font-size:12px; }
  .params {
    margin-top:6px; padding:8px 10px; border-radius:8px; background:#0c1118;
    border:1px solid var(--line); font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:11px; color:var(--muted); white-space:pre-wrap; word-break:break-word;
    max-height:120px; overflow:auto;
  }
  details.row-open summary { cursor:pointer; list-style:none; }
  details.row-open summary::-webkit-details-marker { display:none; }
  .pager { display:flex; gap:8px; align-items:center; justify-content:flex-end; margin-top:12px; }
  .pager button {
    background:#0c1118; border:1px solid var(--line); color:var(--text);
    border-radius:8px; padding:6px 12px; cursor:pointer; font-size:12px;
  }
  .pager button:disabled { opacity:.4; cursor:not-allowed; }
  .pager button:hover:not(:disabled) { border-color:var(--accent); }
  .empty { padding:28px; text-align:center; color:var(--muted); }
  .tabs { display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap; }
  .tab {
    background:transparent; border:1px solid var(--line); color:var(--muted);
    border-radius:999px; padding:6px 12px; cursor:pointer; font-size:12px; font-weight:600;
  }
  .tab.on { color:var(--text); border-color:var(--accent); background:rgba(110,168,254,.1); }
  .panel-hidden { display:none; }
  #coverageBody tr td:first-child { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  @media (max-width:1200px){
    .grid{ grid-template-columns:repeat(3,1fr); }
    .two,.three,.filters{ grid-template-columns:1fr; }
  }
  @media (max-width:700px){
    .grid{ grid-template-columns:repeat(2,1fr); }
  }
</style>
</head>
<body>
<header>
  <div class="row">
    <div>
      <h1>Translation Bench · 1k neg-fairness dataset</h1>
      <div class="sub">
        Collision-free synthesizer run · confusable-action cue gate · seed + pos/neg gen-cases ·
        generator/reviewer <span class="mono" id="modelLine">—</span>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <div class="badge" id="statusBadge"><span class="dot"></span><span id="statusText">—</span></div>
      <div class="badge" id="disambigBadge">disambig —</div>
      <div class="badge" id="approvalBadge">approval —</div>
    </div>
  </div>
</header>
<div class="wrap">
  <div class="grid">
    <div class="card">
      <div class="label">Rows</div>
      <div class="value" id="progress">—</div>
      <div class="hint" id="progressHint"></div>
      <div class="bar"><i id="bar"></i></div>
    </div>
    <div class="card">
      <div class="label">Action coverage</div>
      <div class="value" id="actions">—</div>
      <div class="hint" id="actionsHint"></div>
    </div>
    <div class="card">
      <div class="label">Schemas</div>
      <div class="value" id="schemas">—</div>
      <div class="hint" id="schemaHint"></div>
    </div>
    <div class="card">
      <div class="label">Gen-cases</div>
      <div class="value" id="gencases">—</div>
      <div class="hint" id="gencasesHint"></div>
    </div>
    <div class="card">
      <div class="label">Parameters</div>
      <div class="value" id="params">—</div>
      <div class="hint" id="paramsHint"></div>
    </div>
    <div class="card">
      <div class="label">Double-meaning</div>
      <div class="value" id="disambigVal">—</div>
      <div class="hint" id="disambigHint"></div>
    </div>
  </div>

  <div class="tabs">
    <button class="tab on" data-tab="explore">Explore rows</button>
    <button class="tab" data-tab="coverage">Coverage matrix</button>
    <button class="tab" data-tab="schemas">Schema breakdown</button>
    <button class="tab" data-tab="confusable">Confusable actions</button>
  </div>

  <div id="panel-explore">
    <div class="two">
      <div class="card">
        <h2>Schema distribution</h2>
        <div class="schema-bars" id="schemaBars"></div>
      </div>
      <div class="card">
        <h2>Action coverage heatmap</h2>
        <div class="heat" id="heat"></div>
        <div class="legend">
          <span><i class="sw" style="background:color-mix(in srgb, var(--ok) 75%, #1a2230)"></i> covered action</span>
          <span><i class="sw" style="background:#1a2230"></i> empty</span>
          <span id="heatHint" class="faint"></span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="toolbar">
        <h2 style="margin:0">All rows</h2>
        <div class="count" id="rowCount"></div>
      </div>
      <div class="filters">
        <input id="q" placeholder="Search utterance, action, id, params…"/>
        <select id="schemaFilter"><option value="">All schemas</option></select>
        <select id="roleFilter">
          <option value="">Any role match</option>
          <option value="has-pos">Has positive gen</option>
          <option value="has-neg">Has negative gen</option>
          <option value="has-params">Has seed params</option>
          <option value="no-params">No seed params</option>
          <option value="confusable">Confusable-list action</option>
        </select>
        <select id="pageSize">
          <option value="25">25 / page</option>
          <option value="50" selected>50 / page</option>
          <option value="100">100 / page</option>
          <option value="200">200 / page</option>
        </select>
        <select id="sortBy">
          <option value="id">Sort: id</option>
          <option value="schema">Sort: schema</option>
          <option value="action">Sort: action</option>
        </select>
      </div>
      <div style="max-height:640px;overflow:auto;border:1px solid var(--line);border-radius:12px">
        <table>
          <thead>
            <tr>
              <th style="width:70px">#</th>
              <th style="width:220px">Action</th>
              <th>Seed · generalizations</th>
            </tr>
          </thead>
          <tbody id="sampleBody"></tbody>
        </table>
        <div class="empty panel-hidden" id="empty">No rows match filters.</div>
      </div>
      <div class="pager">
        <span class="count" id="pageInfo"></span>
        <button id="prevBtn" type="button">Prev</button>
        <button id="nextBtn" type="button">Next</button>
      </div>
    </div>
  </div>

  <div id="panel-coverage" class="panel-hidden">
    <div class="card">
      <div class="toolbar">
        <h2 style="margin:0">Every covered action</h2>
        <input id="covQ" placeholder="Filter actions…" style="max-width:280px"/>
      </div>
      <div style="max-height:70vh;overflow:auto;border:1px solid var(--line);border-radius:12px">
        <table>
          <thead><tr><th>Action</th><th style="width:80px">Rows</th><th style="width:120px">Schema</th></tr></thead>
          <tbody id="coverageBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <div id="panel-schemas" class="panel-hidden">
    <div class="card">
      <h2>Actions per schema</h2>
      <div id="schemaDetail"></div>
    </div>
  </div>

  <div id="panel-confusable" class="panel-hidden">
    <div class="card">
      <h2>Curated confusable-action list · collision gate</h2>
      <p class="muted" style="margin:0 0 12px">
        Positives for these actions must carry target-only cues and must not match exclusive sibling cues.
        Dataset-wide verify: <span class="mono" id="disambigSummaryLine">—</span>
      </p>
      <div style="max-height:70vh;overflow:auto;border:1px solid var(--line);border-radius:12px">
        <table>
          <thead><tr><th>Action</th><th style="width:90px">Rows</th><th>Sibling family</th></tr></thead>
          <tbody id="confusableBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <p class="faint" style="margin-top:18px" id="footer"></p>
</div>
<script>
const DATA = ${JSON.stringify(data)};
function esc(s){
  return String(s??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function fmt(n){ return Number(n).toLocaleString(); }

const pct = DATA.totalTarget ? Math.min(100, (DATA.progress/DATA.totalTarget)*100) : 0;
document.getElementById('progress').textContent = fmt(DATA.progress);
document.getElementById('progressHint').textContent = 'of ' + fmt(DATA.totalTarget) + ' target (' + pct.toFixed(1) + '%)';
document.getElementById('bar').style.width = pct + '%';
document.getElementById('actions').textContent = fmt(DATA.uniqueActions) + ' / ' + fmt(DATA.scheduleActionTarget || DATA.uniqueActions);
document.getElementById('actionsHint').textContent = DATA.coverageComplete
  ? 'complete · every live catalog action covered'
  : (DATA.onTrack
      ? DATA.actionsRemaining + ' actions still needed'
      : 'missing: ' + ((DATA.missingScheduledSample||[]).join(', ') || '—'));
document.getElementById('actionsHint').style.color = DATA.coverageComplete || DATA.onTrack ? 'var(--ok)' : 'var(--bad)';
document.getElementById('schemas').textContent = fmt(DATA.schemaCount);
document.getElementById('schemaHint').textContent = 'active schemas in draft';
document.getElementById('gencases').textContent = fmt((DATA.genPos||0) + (DATA.genNeg||0));
document.getElementById('gencasesHint').textContent = fmt(DATA.genPos||0) + ' pos · ' + fmt(DATA.genNeg||0) + ' neg';
document.getElementById('params').textContent = fmt(DATA.withParams||0);
document.getElementById('paramsHint').textContent = fmt(DATA.withoutParams||0) + ' parameterless seeds';
document.getElementById('modelLine').textContent =
  (DATA.header?.generatorModel || '?') + ' / ' + (DATA.header?.reviewerModel || '?') +
  ' · genCases=' + (DATA.header?.genCaseCount ?? '?');

const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
if (DATA.coverageComplete) {
  statusBadge.classList.add('ok');
  statusText.textContent = '1000 rows · 548/548 actions';
} else {
  statusText.textContent = DATA.progress + ' / ' + DATA.totalTarget + ' rows';
}
const approvalBadge = document.getElementById('approvalBadge');
const approval = DATA.draftMeta?.approval || (DATA.draftReady ? 'draft' : 'building');
approvalBadge.textContent = 'approval: ' + approval;
if (approval === 'draft') approvalBadge.classList.add('draft');
if (approval === 'approved') approvalBadge.classList.add('ok');

const d = DATA.disambig || {};
const failN = d.ambiguousFailures ?? null;
const posN = d.positivesChecked ?? null;
const sibN = d.casesWithConfusableSiblings ?? null;
document.getElementById('disambigVal').textContent =
  failN === 0 ? '0 fails' : (failN == null ? '—' : failN + ' fails');
document.getElementById('disambigVal').style.color = failN === 0 ? 'var(--ok)' : (failN == null ? '' : 'var(--bad)');
document.getElementById('disambigHint').textContent =
  posN != null
    ? fmt(posN) + ' positives · ' + fmt(sibN||0) + ' cases w/ siblings · ' + fmt(DATA.confusableRows||0) + ' curated-list rows'
    : fmt(DATA.confusableRows||0) + ' curated-list rows';
const disambigBadge = document.getElementById('disambigBadge');
if (failN === 0) {
  disambigBadge.classList.add('ok');
  disambigBadge.textContent = 'disambig PASS · 0 collisions';
} else if (failN == null) {
  disambigBadge.textContent = 'disambig unverified';
} else {
  disambigBadge.textContent = 'disambig FAIL · ' + failN;
}
document.getElementById('disambigSummaryLine').textContent =
  failN == null
    ? 'report missing'
    : (failN + ' ambiguous / ' + fmt(posN||0) + ' positives · casesWithSiblings=' + fmt(sibN||0));

const FAMILY = {
  'browser.followLinkByText': 'open X vs click link text X · result/link open',
  'browser.followLinkByPosition': 'nth result / position open',
  'browser.openWebPage': 'open X vs click link text X',
  'browser.openSearchResult': 'nth result / result-link open',
  'browser.closeWebPage': 'close page vs close tab',
  'browser.external.closeTab': 'close tab vs close page',
  'browser.actionDiscovery.getAllWebFlows': 'flows vs detect/infer actions',
  'browser.actionDiscovery.detectPageActions': 'detect vs flows/infer',
  'browser.actionDiscovery.inferActions': 'infer vs detect/flows',
};
const actionMap = Object.fromEntries(DATA.actionSorted || []);
document.getElementById('confusableBody').innerHTML = (DATA.confusableActionKeys||[]).map(k => {
  const n = actionMap[k] || 0;
  return '<tr><td class="mono">'+esc(k)+'</td><td>'+n+'</td><td class="muted">'+esc(FAMILY[k]||'—')+'</td></tr>';
}).join('');

// Schema bars
const maxSchema = Math.max(1, ...DATA.schemaSorted.map(([,v]) => v));
document.getElementById('schemaBars').innerHTML = DATA.schemaSorted.map(([k,v]) => {
  const w = Math.max(4, Math.round((v / maxSchema) * 100));
  return '<div class="srow"><div class="name" data-schema="'+esc(k)+'" title="'+esc(k)+'">'+esc(k)+'</div>' +
    '<div class="sbar"><i style="width:'+w+'%"></i></div><div class="n">'+v+'</div></div>';
}).join('');
document.getElementById('schemaBars').addEventListener('click', (e) => {
  const el = e.target.closest('[data-schema]');
  if (!el) return;
  document.getElementById('schemaFilter').value = el.getAttribute('data-schema');
  page = 0;
  render();
  showTab('explore');
});

// Heatmap — one cell per unique action
const heat = document.getElementById('heat');
heat.innerHTML = DATA.actionSorted.map(([k,n]) =>
  '<div class="cell on" title="'+esc(k)+' · '+n+' row(s)" data-key="'+esc(k)+'"></div>'
).join('');
document.getElementById('heatHint').textContent = DATA.actionSorted.length + ' actions';
heat.addEventListener('click', (e) => {
  const el = e.target.closest('[data-key]');
  if (!el) return;
  document.getElementById('q').value = el.getAttribute('data-key');
  page = 0;
  render();
  showTab('explore');
});

// Filters
const sf = document.getElementById('schemaFilter');
[...new Set(DATA.samples.map(s => s.schema))].sort().forEach(s => {
  const o = document.createElement('option');
  o.value = s; o.textContent = s; sf.appendChild(o);
});

let page = 0;
function filtered() {
  const q = document.getElementById('q').value.toLowerCase().trim();
  const schema = sf.value;
  const role = document.getElementById('roleFilter').value;
  const sortBy = document.getElementById('sortBy').value;
  let rows = DATA.samples.filter(s => {
    if (schema && s.schema !== schema) return false;
    if (role === 'has-pos' && !(s.gens||[]).some(g => g.role === 'positive')) return false;
    if (role === 'has-neg' && !(s.gens||[]).some(g => g.role === 'negative')) return false;
    if (role === 'has-params' && !(s.params && Object.keys(s.params).length)) return false;
    if (role === 'no-params' && s.params && Object.keys(s.params).length) return false;
    if (role === 'confusable' && !(DATA.confusableActionKeys||[]).includes(s.key)) return false;
    if (!q) return true;
    const blob = [
      s.utterance, s.key, s.id, s.schema, s.action,
      JSON.stringify(s.params||{}),
      ...(s.gens||[]).map(g => g.utterance + ' ' + g.role),
    ].join(' ').toLowerCase();
    return blob.includes(q);
  });
  rows = rows.slice().sort((a,b) => {
    if (sortBy === 'schema') return a.schema.localeCompare(b.schema) || a.action.localeCompare(b.action);
    if (sortBy === 'action') return a.key.localeCompare(b.key);
    return String(a.id).localeCompare(String(b.id), undefined, { numeric:true });
  });
  return rows;
}

function render() {
  const rows = filtered();
  const pageSize = Number(document.getElementById('pageSize').value) || 50;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  if (page >= pages) page = pages - 1;
  if (page < 0) page = 0;
  const slice = rows.slice(page * pageSize, page * pageSize + pageSize);
  document.getElementById('rowCount').textContent = fmt(rows.length) + ' match · ' + fmt(DATA.sampleTotal) + ' total';
  document.getElementById('pageInfo').textContent = 'page ' + (page+1) + ' / ' + pages;
  document.getElementById('prevBtn').disabled = page <= 0;
  document.getElementById('nextBtn').disabled = page >= pages - 1;
  document.getElementById('empty').classList.toggle('panel-hidden', slice.length > 0);

  document.getElementById('sampleBody').innerHTML = slice.map((s, idx) => {
    const n = page * pageSize + idx + 1;
    const gens = (s.gens||[]).map(g =>
      '<div class="gen"><span class="role '+(g.role==='positive'?'pos':g.role==='negative'?'neg':'')+'">'+esc(g.role)+'</span>' +
      '<div class="t">'+esc(g.utterance)+'</div></div>'
    ).join('');
    const params = s.params && Object.keys(s.params).length
      ? '<div class="params">'+esc(JSON.stringify(s.params, null, 2))+'</div>'
      : '';
    return '<tr><td class="muted mono">'+n+'</td>' +
      '<td><span class="pill" title="'+esc(s.key)+'">'+esc(s.key)+'</span>' +
      '<div class="faint" style="margin-top:6px">'+esc(s.id)+'</div></td>' +
      '<td><div class="utt"><span class="role seed">seed</span> '+esc(s.utterance)+'</div>' +
      params + gens + '</td></tr>';
  }).join('');
}

document.getElementById('q').addEventListener('input', () => { page = 0; render(); });
sf.addEventListener('change', () => { page = 0; render(); });
document.getElementById('roleFilter').addEventListener('change', () => { page = 0; render(); });
document.getElementById('pageSize').addEventListener('change', () => { page = 0; render(); });
document.getElementById('sortBy').addEventListener('change', () => { page = 0; render(); });
document.getElementById('prevBtn').addEventListener('click', () => { page -= 1; render(); });
document.getElementById('nextBtn').addEventListener('click', () => { page += 1; render(); });

// Coverage table
function renderCoverage() {
  const q = (document.getElementById('covQ').value || '').toLowerCase();
  const rows = DATA.actionSorted.filter(([k]) => !q || k.toLowerCase().includes(q));
  document.getElementById('coverageBody').innerHTML = rows.map(([k,v]) => {
    const i = k.indexOf('.');
    const schema = i === -1 ? k : k.slice(0,i);
    return '<tr><td>'+esc(k)+'</td><td>'+v+'</td><td class="muted">'+esc(schema)+'</td></tr>';
  }).join('');
}
document.getElementById('covQ').addEventListener('input', renderCoverage);
renderCoverage();

// Schema detail
document.getElementById('schemaDetail').innerHTML = DATA.schemaSorted.map(([schema, n]) => {
  const acts = DATA.schemaActions[schema] || [];
  const list = acts.map(a =>
    '<span class="pill" style="margin:2px" title="'+esc(a.key)+' · '+a.n+'">'+esc(a.action)+' · '+a.n+'</span>'
  ).join(' ');
  return '<div style="margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--line)">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px">' +
    '<strong class="mono">'+esc(schema)+'</strong>' +
    '<span class="muted">'+n+' rows · '+acts.length+' actions</span></div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:4px">'+list+'</div></div>';
}).join('');

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  document.getElementById('panel-explore').classList.toggle('panel-hidden', name !== 'explore');
  document.getElementById('panel-coverage').classList.toggle('panel-hidden', name !== 'coverage');
  document.getElementById('panel-schemas').classList.toggle('panel-hidden', name !== 'schemas');
  document.getElementById('panel-confusable').classList.toggle('panel-hidden', name !== 'confusable');
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

document.getElementById('footer').textContent =
  'Generated ' + DATA.generatedAt +
  ' · source ' + (DATA.datasetSourceLabel || '—') +
  ' · ' + (DATA.draftMeta?.name || '—') +
  ' · ' + fmt(DATA.sampleTotal) + ' rows embedded';

render();
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(outHtml), { recursive: true });
fs.writeFileSync(outHtml, html);
const gwDir =
    "/Users/dominicnguyen/Documents/mygithub.com/dom-files-gateway/.data/plans/translation-bench-1k-neg-fairness";
try {
    fs.mkdirSync(gwDir, { recursive: true });
    fs.copyFileSync(outHtml, path.join(gwDir, "dataset.html"));
} catch {}
console.log(
    "wrote",
    outHtml,
    "progress",
    progress,
    "/",
    totalTarget,
    "actions",
    uniqueActions,
    "bytes",
    html.length,
);
