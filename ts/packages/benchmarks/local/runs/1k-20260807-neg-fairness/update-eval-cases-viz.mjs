#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Build self-contained interactive eval-case explorer for TB neg-fairness run.
 * Filters: model, pass/fail, role (pos/neg), schema/action, negative kind / unfair themes.
 * Usage: node update-eval-cases-viz.mjs [out.html]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUN = path.dirname(fileURLToPath(import.meta.url));
const art = process.env.TB_ART_DIR
    ? path.resolve(process.env.TB_ART_DIR)
    : path.join(RUN, "artifacts");
const outHtml = process.argv[2] || path.join(RUN, "viz/eval-cases.html");
const gwDir =
    "/Users/dominicnguyen/Documents/mygithub.com/dom-files-gateway/.data/plans/translation-bench-1k-neg-fairness";
const gw = path.join(gwDir, "eval-cases.html");

function readJson(p) {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

function shortModel(m) {
    return String(m || "")
        .replace(/^azure\//, "")
        .replace(/^gpt-5\.6-/, "g56-");
}

function actionKey(a) {
    if (!a) return "";
    const s = a.schemaName || a.s || "";
    const n = a.actionName || a.a || "";
    return s && n ? `${s}.${n}` : s || n || "";
}

function parseTargetFromCaseId(caseId) {
    // generated-000000-browser-captureScreenshot
    // generated-000012-browser.external-closeTab:translation-negative:...
    const base = String(caseId || "").split(":")[0];
    const m = base.match(/^generated-\d+-(.+)$/);
    if (!m) return { schema: "", action: "", key: "" };
    const rest = m[1];
    // Prefer last hyphen split for action; schema may contain dots but not hyphens usually.
    // Actions can be camelCase; schemas can be dotted (browser.external).
    // Pattern in ids: schemaName with dots kept, actionName after final hyphen of the schema-action pair
    // e.g. browser.external-closeTab  OR  browser-captureScreenshot OR dispatcher.lookup-lookupAndAnswerConversation
    const hi = rest.lastIndexOf("-");
    if (hi <= 0) return { schema: rest, action: "", key: rest };
    const schema = rest.slice(0, hi);
    const action = rest.slice(hi + 1);
    return { schema, action, key: `${schema}.${action}` };
}

const results = readJson(path.join(art, "eval-results.json"));
const summary = readJson(path.join(art, "eval-report-summary.json"));
const byModel = readJson(path.join(art, "eval-report-by-model.json")) || [];
const scale = readJson(path.join(art, "scale-metrics.json")) || {};
const fairness =
    readJson(path.join(art, "fairness-audit-llm.json")) ||
    readJson(path.join(art, "fairness-audit.json")) ||
    {};
const fairnessStored =
    readJson(path.join(art, "fairness-audit-stored-final.json")) ||
    readJson(path.join(art, "fairness-audit-stored.json")) ||
    {};

const unfairByUtt = new Map();
for (const ex of fairnessStored.unfair_examples || []) {
    if (ex?.u) unfairByUtt.set(ex.u, ex);
}
// also index all_negatives kind by utterance
const kindByUtt = new Map();
for (const n of fairnessStored.all_negatives || []) {
    if (n?.u) kindByUtt.set(n.u, n.k);
}

const rowsIn = results?.rows || results || [];
const cases = [];
const kindDist = Object.create(null);
const schemaSet = new Set();
const actionSet = new Set();
const modelSet = new Set();

let pos = 0,
    neg = 0,
    pass = 0,
    fail = 0,
    negFired = 0,
    unfairTagged = 0,
    badNegativeTheme = 0;

for (const r of rowsIn) {
    const sc = r.score || {};
    const exp = r.expectedActions || [];
    const ch = r.chosenActions || [];
    const dims = r.dimensions || {};
    const isNeg = !!sc.isNegative || exp.length === 0;
    const role = isNeg ? "neg" : "pos";
    const passed = !!sc.passed;
    const utt = r.utterance || "";
    const model = r.model || "";
    modelSet.add(model);

    let schema = "";
    let action = "";
    let key = "";
    if (exp[0]) {
        schema = exp[0].schemaName || "";
        action = exp[0].actionName || "";
        key = actionKey(exp[0]);
    } else if (ch[0] && !isNeg) {
        schema = ch[0].schemaName || "";
        action = ch[0].actionName || "";
        key = actionKey(ch[0]);
    } else {
        const t = parseTargetFromCaseId(r.caseId);
        schema = t.schema;
        action = t.action;
        key = t.key;
    }
    if (schema) schemaSet.add(schema);
    if (key) actionSet.add(key);

    let nk =
        dims.negativeKind ||
        dims.kind ||
        (isNeg ? kindByUtt.get(utt) : null) ||
        (isNeg ? "—" : null);

    const unfairHit = unfairByUtt.get(utt);
    const kindIsUnfair =
        typeof nk === "string" &&
        (nk.startsWith("unfair_") || nk === "unknown" || nk === "BAD_NEGATIVE");
    const unfair = !!(isNeg && (unfairHit || kindIsUnfair));
    // BAD_NEGATIVE theme: empty-gold negative where model fired an action (false positive under zero-action scoring)
    const fired =
        !!sc.firedOnNegative ||
        (isNeg && (sc.chosenCount > 0 || ch.length > 0));
    const badNeg = !!(isNeg && fired);
    // theme tags
    const themes = [];
    if (isNeg) {
        if (nk && nk !== "—") themes.push(nk);
        if (unfair) themes.push("unfair_label");
        if (badNeg) themes.push("BAD_NEGATIVE_fired");
        if (unfairHit?.reason) themes.push("audit_flag");
    }

    if (role === "pos") pos += 1;
    else neg += 1;
    if (passed) pass += 1;
    else fail += 1;
    if (isNeg && fired) negFired += 1;
    if (unfair) unfairTagged += 1;
    if (badNeg) badNegativeTheme += 1;
    if (isNeg && nk) kindDist[nk] = (kindDist[nk] || 0) + 1;

    const diag = sc.diagnostics || {};
    const diagBits = [];
    for (const [k, v] of Object.entries(diag)) {
        if (v) diagBits.push(`${k}:${v}`);
    }

    cases.push({
        id: r.caseId,
        m: model,
        ms: shortModel(model),
        role,
        pass: passed,
        u: utt,
        schema,
        action,
        key,
        exp: exp.map((a) => ({
            s: a.schemaName,
            a: a.actionName,
            p:
                a.parameters && Object.keys(a.parameters).length
                    ? a.parameters
                    : undefined,
        })),
        ch: ch.map((a) => ({
            s: a.schemaName,
            a: a.actionName,
            p:
                a.parameters && Object.keys(a.parameters).length
                    ? a.parameters
                    : undefined,
        })),
        sc: {
            passed,
            exact: !!sc.exactPassed,
            sv: !!sc.schemaValid,
            expN: sc.expectedCount ?? exp.length,
            chN: sc.chosenCount ?? ch.length,
            routed: sc.routed ?? 0,
            pm: sc.paramMatches ?? 0,
            epm: sc.exactParamMatches ?? 0,
            isNeg,
            fired: !!fired,
            diag: diagBits.length ? diagBits.join(", ") : "",
        },
        nk: isNeg ? nk : null,
        unfair,
        badNeg,
        themes,
        reason: unfairHit?.reason || dims.negativeBoundaryReason || null,
        msElapsed: Math.round(r.elapsedMs || 0),
        cost: r.usage?.estimatedCostUsd ?? null,
    });
}

const meta = {
    title: "TB 1k neg-fairness · eval cases",
    generatedAt: new Date().toISOString(),
    run: path.basename(RUN),
    total: cases.length,
    pos,
    neg,
    pass,
    fail,
    passRate: cases.length ? pass / cases.length : 0,
    negFired,
    unfairTagged,
    badNegativeTheme,
    kindDist,
    fairness: {
        method: fairness.method || fairnessStored.method || null,
        unfair_count: fairness.unfair_count ?? scale.unfair_neg_count ?? null,
        unfair_negative_rate:
            fairness.unfair_negative_rate ?? scale.unfair_neg_rate ?? null,
        kind_distribution:
            fairness.kind_distribution ||
            fairnessStored.kind_distribution ||
            null,
        ok: fairness.ok ?? scale.fairness_ok ?? null,
        max_unfair_rate: fairness.max_unfair_rate ?? 0.02,
        note: fairness.note || null,
    },
    scale,
    models: [...modelSet].sort(),
    schemas: [...schemaSet].sort(),
    actions: [...actionSet].sort(),
    byModel: byModel.map((b) => ({
        key: b.key,
        passRate: b.summary?.passRate,
        toolScore: b.summary?.toolScore,
        paramScore: b.summary?.paramScore,
        falsePositiveRate: b.summary?.falsePositiveRate,
        falseNegativeRate: b.summary?.falseNegativeRate,
        negativeRows: b.summary?.negativeRows,
        negativeRowsFired: b.summary?.negativeRowsFired,
        negativeRowErrors: b.summary?.negativeRowErrors,
        passedCases: b.summary?.passedCases,
        totalCases: b.summary?.totalCases,
    })),
    suiteSummary: summary?.summary
        ? {
              totalCases: summary.summary.totalCases,
              passedCases: summary.summary.passedCases,
              passRate: summary.summary.passRate,
              toolScore: summary.summary.toolScore,
              paramScore: summary.summary.paramScore,
              falsePositiveRate: summary.summary.falsePositiveRate,
              falseNegativeRate: summary.summary.falseNegativeRate,
              negativeRows: summary.summary.negativeRows,
              negativeRowsFired: summary.summary.negativeRowsFired,
          }
        : null,
};

const data = { meta, cases };

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${meta.title}</title>
<style>
:root{
  --bg:#07090c; --panel:#10151c; --panel2:#141b24; --line:#243041;
  --text:#e8eef7; --muted:#8b9bb0; --faint:#5c6b80;
  --accent:#6ea8fe; --accent2:#8b5cf6; --ok:#3dd68c; --warn:#f5a524; --bad:#ff6b6b;
  --pos:#3dd68c; --neg:#f5a524; --unfair:#ff7ab6;
}
*{box-sizing:border-box}
body{
  margin:0;
  font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  background:radial-gradient(1200px 600px at 10% -10%, #152033 0%, var(--bg) 55%);
  color:var(--text); min-height:100vh;
}
header{
  padding:20px 28px 16px; border-bottom:1px solid var(--line);
  background:linear-gradient(180deg, rgba(20,26,34,.95), rgba(11,13,16,.75));
  backdrop-filter:blur(8px); position:sticky; top:0; z-index:30;
}
header .row{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
h1{margin:0 0 4px;font-size:22px;font-weight:750;letter-spacing:-.03em}
.sub{color:var(--muted);font-size:13px;max-width:820px}
.badge{
  display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;
  font-size:12px;font-weight:650;border:1px solid var(--line);background:var(--panel);
}
.badge.ok{color:var(--ok);border-color:rgba(61,214,140,.35);background:rgba(61,214,140,.08)}
.badge.warn{color:var(--warn);border-color:rgba(245,165,36,.35);background:rgba(245,165,36,.08)}
.badge.bad{color:var(--bad);border-color:rgba(255,107,107,.35);background:rgba(255,107,107,.08)}
.wrap{padding:18px 28px 64px;max-width:1480px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:14px}
.card{
  background:linear-gradient(180deg,var(--panel2),var(--panel));
  border:1px solid var(--line);border-radius:14px;padding:14px 16px;
}
.card .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.07em;font-weight:650}
.card .value{font-size:26px;font-weight:750;margin-top:6px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.card .hint{color:var(--muted);font-size:12px;margin-top:4px}
.filters{
  display:grid;
  grid-template-columns:1.5fr 160px 110px 110px 160px 180px 160px 110px;
  gap:8px;margin-bottom:10px;
}
input,select,button.chip{
  background:#0c1118;border:1px solid var(--line);color:var(--text);
  border-radius:10px;padding:9px 11px;width:100%;outline:none;font:inherit;
}
input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(110,168,254,.15)}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.count,.muted{color:var(--muted);font-size:12px}
.faint{color:var(--faint);font-size:11px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{
  color:var(--muted);font-weight:650;font-size:11px;text-transform:uppercase;letter-spacing:.05em;
  position:sticky;top:0;background:var(--panel);z-index:2;
}
tr:hover td{background:rgba(255,255,255,.02)}
tr.selected td{background:rgba(110,168,254,.08)}
tr.unfair td{box-shadow:inset 3px 0 0 var(--unfair)}
tr.badneg td{box-shadow:inset 3px 0 0 var(--bad)}
tr.unfair.badneg td{box-shadow:inset 3px 0 0 var(--unfair), inset 6px 0 0 var(--bad)}
.pill{
  display:inline-block;padding:2px 8px;border-radius:999px;background:#1a2433;
  border:1px solid var(--line);font-size:11px;color:var(--accent);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:260px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.role,.status,.theme{
  display:inline-block;min-width:52px;text-align:center;padding:1px 7px;border-radius:999px;
  font-size:10px;font-weight:750;text-transform:uppercase;letter-spacing:.04em;
}
.role.pos{color:var(--pos);background:rgba(61,214,140,.12);border:1px solid rgba(61,214,140,.25)}
.role.neg{color:var(--neg);background:rgba(245,165,36,.12);border:1px solid rgba(245,165,36,.25)}
.status.pass{color:var(--ok);background:rgba(61,214,140,.12);border:1px solid rgba(61,214,140,.25)}
.status.fail{color:var(--bad);background:rgba(255,107,107,.12);border:1px solid rgba(255,107,107,.25)}
.theme{color:var(--unfair);background:rgba(255,122,182,.1);border:1px solid rgba(255,122,182,.28);margin-right:4px}
.theme.bad{color:var(--bad);background:rgba(255,107,107,.1);border-color:rgba(255,107,107,.3)}
.theme.okish{color:var(--muted);background:rgba(139,155,176,.1);border-color:var(--line)}
.utt{color:var(--text)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}
button.chip{width:auto;cursor:pointer;font-size:12px;font-weight:600;padding:6px 10px}
button.chip.on{border-color:var(--accent);background:rgba(110,168,254,.12);color:var(--text)}
.pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:12px}
.pager button{
  background:#0c1118;border:1px solid var(--line);color:var(--text);
  border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;
}
.pager button:disabled{opacity:.4;cursor:not-allowed}
.pager button:hover:not(:disabled){border-color:var(--accent)}
.detail{
  margin-top:14px;border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:14px 16px;
}
.detail h2{margin:0 0 10px;font-size:14px}
.detail-grid{display:grid;grid-template-columns:1.2fr 1fr 1fr .9fr;gap:12px}
.box{border:1px solid var(--line);border-radius:10px;background:#0c1118;padding:12px;min-height:120px}
.box h3{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.box pre,.box blockquote{
  margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text);
}
.box blockquote{font-family:inherit;font-size:15px;line-height:1.4}
.kv{display:grid;grid-template-columns:120px 1fr;gap:4px 10px;font-size:12px}
.kv dt{color:var(--muted)} .kv dd{margin:0;font-weight:600}
.empty{padding:28px;text-align:center;color:var(--muted)}
.bar{height:8px;background:#1a2230;border-radius:999px;overflow:hidden;margin-top:10px}
.bar>i{display:block;height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6 70%,#3dd68c)}
.model-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
@media(max-width:1200px){
  .grid{grid-template-columns:repeat(3,1fr)}
  .filters{grid-template-columns:1fr 1fr}
  .detail-grid{grid-template-columns:1fr}
  .model-cards{grid-template-columns:1fr}
}
</style>
</head>
<body>
<header>
  <div class="row">
    <div>
      <h1>Translation Bench · 1k neg-fairness eval</h1>
      <div class="sub">
        Empty-gold negatives scored zero-action · LLM fairness audit (kind + fairEmptyGold) ·
        filter model / pass / role / schema / unfair themes ·
        <span class="mono">${meta.run}</span>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <div class="badge ${meta.fairness.ok ? "ok" : "bad"}" id="fairBadge">
        fairness ${meta.fairness.ok ? "OK" : "FAIL"} · unfair ${meta.fairness.unfair_negative_rate != null ? (meta.fairness.unfair_negative_rate * 100).toFixed(1) : "?"}%
      </div>
      <div class="badge">pass ${(meta.passRate * 100).toFixed(1)}%</div>
      <div class="badge warn">neg fired ${meta.negFired.toLocaleString()}</div>
    </div>
  </div>
</header>
<div class="wrap">
  <div class="grid">
    <div class="card"><div class="label">Eval cells</div><div class="value" id="vTotal">—</div><div class="hint" id="hTotal"></div>
      <div class="bar"><i id="passBar"></i></div></div>
    <div class="card"><div class="label">Pass / fail</div><div class="value" id="vPass">—</div><div class="hint" id="hPass"></div></div>
    <div class="card"><div class="label">Pos / neg</div><div class="value" id="vRole">—</div><div class="hint" id="hRole"></div></div>
    <div class="card"><div class="label">Neg fired (FP)</div><div class="value" id="vFired">—</div><div class="hint">empty-gold model action</div></div>
    <div class="card"><div class="label">Unfair tagged</div><div class="value" id="vUnfair">—</div><div class="hint" id="hUnfair"></div></div>
    <div class="card"><div class="label">Audit method</div><div class="value" style="font-size:15px;margin-top:10px" id="vMethod">—</div><div class="hint" id="hMethod"></div></div>
  </div>

  <div class="model-cards" id="modelCards"></div>

  <div class="card">
    <div class="toolbar">
      <div>
        <h2 style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Case explorer</h2>
        <div class="chips" id="quickChips"></div>
      </div>
      <div class="count" id="rowCount"></div>
    </div>
    <div class="filters">
      <input id="q" placeholder="Search utterance, caseId, action, diagnostics, reason…"/>
      <select id="modelFilter"><option value="">All models</option></select>
      <select id="passFilter">
        <option value="">Pass/fail</option>
        <option value="pass">Pass</option>
        <option value="fail">Fail</option>
      </select>
      <select id="roleFilter">
        <option value="">Pos/neg</option>
        <option value="pos">Positive</option>
        <option value="neg">Negative</option>
      </select>
      <select id="schemaFilter"><option value="">All schemas</option></select>
      <select id="actionFilter"><option value="">All actions</option></select>
      <select id="themeFilter">
        <option value="">All themes</option>
        <option value="unfair">Unfair label</option>
        <option value="BAD_NEGATIVE_fired">BAD_NEGATIVE (fired)</option>
        <option value="pure_refusal">pure_refusal</option>
        <option value="non_action_question">non_action_question</option>
        <option value="missing_info">missing_info</option>
        <option value="unfair_imperative">unfair_imperative</option>
        <option value="unfair_sibling_command">unfair_sibling_command</option>
        <option value="unfair_contrastive">unfair_contrastive</option>
        <option value="unknown">unknown</option>
        <option value="audit_flag">audit_flag</option>
      </select>
      <select id="pageSize">
        <option value="25">25 / page</option>
        <option value="50" selected>50 / page</option>
        <option value="100">100 / page</option>
        <option value="200">200 / page</option>
      </select>
    </div>
    <div style="max-height:560px;overflow:auto;border:1px solid var(--line);border-radius:12px">
      <table>
        <thead>
          <tr>
            <th style="width:70px">Status</th>
            <th style="width:56px">Role</th>
            <th style="width:90px">Model</th>
            <th style="width:200px">Target action</th>
            <th>Utterance · themes</th>
            <th style="width:120px">Score</th>
          </tr>
        </thead>
        <tbody id="body"></tbody>
      </table>
      <div class="empty" id="empty" hidden>No rows match filters.</div>
    </div>
    <div class="pager">
      <span class="count" id="pageInfo"></span>
      <button type="button" id="prevBtn">Prev</button>
      <button type="button" id="nextBtn">Next</button>
    </div>
  </div>

  <div class="detail" id="detail" hidden>
    <h2 id="detailTitle">Case detail</h2>
    <div class="detail-grid">
      <div class="box"><h3>Utterance</h3><blockquote id="dUtt"></blockquote><div class="faint" id="dId" style="margin-top:10px"></div></div>
      <div class="box"><h3>Gold expectedActions</h3><pre id="dExp"></pre></div>
      <div class="box"><h3>Model chosenActions</h3><pre id="dCh"></pre></div>
      <div class="box"><h3>Scores · fairness</h3><dl class="kv" id="dScore"></dl></div>
    </div>
  </div>
  <p class="faint" style="margin-top:16px" id="footer"></p>
</div>
<script>
const DATA = ${JSON.stringify(data)};
const META = DATA.meta;
const CASES = DATA.cases;

function esc(s){
  return String(s??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function fmt(n){ return Number(n||0).toLocaleString(); }
function pct(a,b){ return b ? ((a/b)*100).toFixed(1) : '0.0'; }
function pretty(v){
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

document.getElementById('vTotal').textContent = fmt(META.total);
document.getElementById('hTotal').textContent = META.models.length + ' models · suite cells';
document.getElementById('passBar').style.width = (META.passRate*100).toFixed(1) + '%';
document.getElementById('vPass').textContent = fmt(META.pass);
document.getElementById('hPass').textContent = fmt(META.fail) + ' fail · ' + pct(META.pass, META.total) + '%';
document.getElementById('vRole').textContent = fmt(META.pos) + ' / ' + fmt(META.neg);
document.getElementById('hRole').textContent = 'positive / negative';
document.getElementById('vFired').textContent = fmt(META.negFired);
document.getElementById('vUnfair').textContent = fmt(META.unfairTagged);
document.getElementById('hUnfair').textContent =
  'row labels · audit unfair_count=' + (META.fairness.unfair_count ?? '—') +
  ' (' + (META.fairness.unfair_negative_rate!=null ? (META.fairness.unfair_negative_rate*100).toFixed(1)+'%' : '—') + ')' +
  ' · BAD_NEGATIVE fired cells=' + fmt(META.badNegativeTheme) +
  (META.unfairTagged === 0 && (META.fairness.unfair_count||0) > 0
    ? ' · row-level unfair kinds not persisted on approved set (use BAD_NEGATIVE fired + audit summary)'
    : '');
document.getElementById('vMethod').textContent = META.fairness.method || '—';
document.getElementById('hMethod').textContent = META.fairness.note || ('max unfair ' + ((META.fairness.max_unfair_rate||0)*100) + '%');

const mc = document.getElementById('modelCards');
mc.innerHTML = (META.byModel||[]).map(b => {
  const name = (b.key||'').replace(/^azure\\//,'');
  return '<div class="card"><div class="label">'+esc(name)+'</div>'+
    '<div class="value" style="font-size:22px">'+(b.passRate!=null?(b.passRate*100).toFixed(1)+'%':'—')+'</div>'+
    '<div class="hint">tool '+(b.toolScore!=null?(b.toolScore*100).toFixed(1)+'%':'—')+
    ' · param '+(b.paramScore!=null?(b.paramScore*100).toFixed(1)+'%':'—')+
    ' · FP '+(b.falsePositiveRate!=null?(b.falsePositiveRate*100).toFixed(1)+'%':'—')+
    ' · negFired '+(b.negativeRowsFired??'—')+'/'+(b.negativeRows??'—')+'</div></div>';
}).join('') || '';

const modelSel = document.getElementById('modelFilter');
for (const m of META.models) {
  const o=document.createElement('option'); o.value=m; o.textContent=m.replace(/^azure\\//,''); modelSel.appendChild(o);
}
const schemaSel = document.getElementById('schemaFilter');
for (const s of META.schemas) {
  const o=document.createElement('option'); o.value=s; o.textContent=s; schemaSel.appendChild(o);
}
const actionSel = document.getElementById('actionFilter');
function refillActions(schema){
  actionSel.innerHTML = '<option value="">All actions</option>';
  const acts = META.actions.filter(k => !schema || k.startsWith(schema+'.') || k===schema);
  for (const a of acts) {
    const o=document.createElement('option'); o.value=a; o.textContent=a; actionSel.appendChild(o);
  }
}
refillActions('');

const chips = [
  {id:'all', label:'All'},
  {id:'fail', label:'Fails'},
  {id:'neg', label:'Negatives'},
  {id:'neg_fail', label:'Neg fails'},
  {id:'fired', label:'BAD_NEGATIVE fired'},
  {id:'unfair', label:'Unfair labels'},
  {id:'pos_fail', label:'Pos fails'},
];
const chipBox = document.getElementById('quickChips');
let activeChip = 'all';
chipBox.innerHTML = chips.map(c => '<button type="button" class="chip" data-chip="'+c.id+'">'+c.label+'</button>').join('');
function setChip(id){
  activeChip = id;
  for (const b of chipBox.querySelectorAll('.chip')) b.classList.toggle('on', b.dataset.chip===id);
  // apply coarse filters
  if (id==='all'){ passFilter.value=''; roleFilter.value=''; themeFilter.value=''; }
  if (id==='fail'){ passFilter.value='fail'; roleFilter.value=''; themeFilter.value=''; }
  if (id==='neg'){ passFilter.value=''; roleFilter.value='neg'; themeFilter.value=''; }
  if (id==='neg_fail'){ passFilter.value='fail'; roleFilter.value='neg'; themeFilter.value=''; }
  if (id==='fired'){ passFilter.value=''; roleFilter.value='neg'; themeFilter.value='BAD_NEGATIVE_fired'; }
  if (id==='unfair'){ passFilter.value=''; roleFilter.value='neg'; themeFilter.value='unfair'; }
  if (id==='pos_fail'){ passFilter.value='fail'; roleFilter.value='pos'; themeFilter.value=''; }
  page=0; render();
}
chipBox.addEventListener('click', e => {
  const b=e.target.closest('.chip'); if(!b) return; setChip(b.dataset.chip);
});

const q = document.getElementById('q');
const passFilter = document.getElementById('passFilter');
const roleFilter = document.getElementById('roleFilter');
const themeFilter = document.getElementById('themeFilter');
const pageSizeEl = document.getElementById('pageSize');
const body = document.getElementById('body');
const empty = document.getElementById('empty');
const rowCount = document.getElementById('rowCount');
const pageInfo = document.getElementById('pageInfo');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const detail = document.getElementById('detail');

let page = 0;
let filtered = CASES.slice();
let selectedId = null;

function matchTheme(c, t){
  if (!t) return true;
  if (t==='unfair') return !!c.unfair || (c.themes||[]).includes('unfair_label');
  return (c.themes||[]).includes(t) || c.nk===t;
}

function applyFilters(){
  const qq = q.value.trim().toLowerCase();
  const m = modelSel.value;
  const pf = passFilter.value;
  const rf = roleFilter.value;
  const sf = schemaSel.value;
  const af = actionSel.value;
  const tf = themeFilter.value;
  filtered = CASES.filter(c => {
    if (m && c.m !== m) return false;
    if (pf==='pass' && !c.pass) return false;
    if (pf==='fail' && c.pass) return false;
    if (rf && c.role !== rf) return false;
    if (sf && c.schema !== sf) return false;
    if (af && c.key !== af) return false;
    if (!matchTheme(c, tf)) return false;
    if (qq) {
      const blob = [
        c.u, c.id, c.key, c.schema, c.action, c.nk, c.reason,
        c.sc.diag, (c.themes||[]).join(' '),
        pretty(c.exp), pretty(c.ch), c.m
      ].join(' ').toLowerCase();
      if (!blob.includes(qq)) return false;
    }
    return true;
  });
}

function showDetail(c){
  if (!c) { detail.hidden = true; return; }
  selectedId = c.id + '|' + c.m;
  detail.hidden = false;
  document.getElementById('detailTitle').textContent =
    (c.pass?'PASS':'FAIL') + ' · ' + c.role + ' · ' + (c.ms||c.m) + (c.unfair?' · UNFAIR':'') + (c.badNeg?' · BAD_NEGATIVE':'');
  document.getElementById('dUtt').textContent = c.u || '';
  document.getElementById('dId').textContent = c.id || '';
  document.getElementById('dExp').textContent = pretty(c.exp);
  document.getElementById('dCh').textContent = pretty(c.ch);
  const sc = c.sc || {};
  const rows = [
    ['passed', String(!!sc.passed)],
    ['exact', String(!!sc.exact)],
    ['schemaValid', String(!!sc.sv)],
    ['expected/chosen', (sc.expN??0) + ' / ' + (sc.chN??0)],
    ['routed', String(sc.routed??0)],
    ['paramMatches', String(sc.pm??0)],
    ['firedOnNegative', String(!!sc.fired)],
    ['negativeKind', c.nk || '—'],
    ['unfair', String(!!c.unfair)],
    ['themes', (c.themes||[]).join(', ') || '—'],
    ['reason', c.reason || '—'],
    ['latencyMs', String(c.msElapsed??'—')],
    ['costUsd', c.cost!=null ? Number(c.cost).toFixed(4) : '—'],
    ['diagnostics', sc.diag || '—'],
  ];
  document.getElementById('dScore').innerHTML = rows.map(([k,v]) =>
    '<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>'
  ).join('');
  // highlight selected row
  for (const tr of body.querySelectorAll('tr')) {
    tr.classList.toggle('selected', tr.dataset.sid === selectedId);
  }
}

function render(){
  applyFilters();
  const ps = Number(pageSizeEl.value) || 50;
  const pages = Math.max(1, Math.ceil(filtered.length / ps));
  if (page >= pages) page = pages - 1;
  if (page < 0) page = 0;
  const start = page * ps;
  const slice = filtered.slice(start, start + ps);
  rowCount.textContent = fmt(filtered.length) + ' match · ' + fmt(META.total) + ' total';
  pageInfo.textContent = 'page ' + (page+1) + ' / ' + pages;
  prevBtn.disabled = page <= 0;
  nextBtn.disabled = page >= pages - 1;
  empty.hidden = slice.length > 0;
  body.innerHTML = slice.map(c => {
    const sid = c.id + '|' + c.m;
    const themeHtml = (c.themes||[]).slice(0,4).map(t => {
      const cls = (t==='BAD_NEGATIVE_fired') ? 'theme bad' : (t.startsWith('unfair')||t==='unfair_label'||t==='unknown'||t==='audit_flag') ? 'theme' : 'theme okish';
      return '<span class="'+cls+'">'+esc(t)+'</span>';
    }).join('');
    const scoreLine = c.role==='neg'
      ? (c.sc.fired ? 'fired FP' : 'quiet') + (c.pass ? ' · pass' : ' · fail')
      : 'r'+(c.sc.routed??0)+' pm'+(c.sc.pm??0)+(c.pass?'':' · fail');
    const cls = [c.unfair?'unfair':'', c.badNeg?'badneg':'', sid===selectedId?'selected':''].filter(Boolean).join(' ');
    return '<tr class="'+cls+'" data-sid="'+esc(sid)+'">'+
      '<td><span class="status '+(c.pass?'pass':'fail')+'">'+(c.pass?'pass':'fail')+'</span></td>'+
      '<td><span class="role '+c.role+'">'+c.role+'</span></td>'+
      '<td class="mono">'+esc(c.ms||c.m)+'</td>'+
      '<td><span class="pill" title="'+esc(c.key)+'">'+esc(c.key||'—')+'</span></td>'+
      '<td><div class="utt">'+esc(c.u)+'</div><div style="margin-top:6px">'+themeHtml+
        (c.nk && !(c.themes||[]).includes(c.nk) ? ' <span class="theme okish">'+esc(c.nk)+'</span>' : '')+
      '</div></td>'+
      '<td class="mono">'+esc(scoreLine)+'</td>'+
    '</tr>';
  }).join('');
}

body.addEventListener('click', e => {
  const tr = e.target.closest('tr'); if (!tr) return;
  const sid = tr.dataset.sid;
  const c = filtered.find(x => (x.id+'|'+x.m) === sid) || CASES.find(x => (x.id+'|'+x.m) === sid);
  showDetail(c);
});

for (const el of [q, modelSel, passFilter, roleFilter, themeFilter, pageSizeEl]) {
  el.addEventListener('input', () => { page=0; render(); });
  el.addEventListener('change', () => { page=0; render(); });
}
schemaSel.addEventListener('change', () => {
  refillActions(schemaSel.value);
  actionSel.value = '';
  page=0; render();
});
actionSel.addEventListener('change', () => { page=0; render(); });
prevBtn.addEventListener('click', () => { page -= 1; render(); });
nextBtn.addEventListener('click', () => { page += 1; render(); });

document.getElementById('footer').textContent =
  'generated ' + META.generatedAt +
  ' · unfair audit rate ' + (META.fairness.unfair_negative_rate!=null ? (META.fairness.unfair_negative_rate*100).toFixed(2)+'%' : '—') +
  ' · source artifacts/eval-results.json + fairness-audit*';

setChip('all');
// deep-link helpers via hash
try {
  const h = new URLSearchParams((location.hash||'').replace(/^#/, ''));
  if (h.get('theme')) { themeFilter.value = h.get('theme'); activeChip='all'; page=0; render(); }
  if (h.get('role')) { roleFilter.value = h.get('role'); page=0; render(); }
  if (h.get('pass')) { passFilter.value = h.get('pass'); page=0; render(); }
} catch {}
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(outHtml), { recursive: true });
fs.writeFileSync(outHtml, html);
console.log("wrote", outHtml, "bytes", html.length, "cases", cases.length);

try {
    fs.mkdirSync(gwDir, { recursive: true });
    fs.copyFileSync(outHtml, gw);
    // also copy sibling reports if present
    for (const name of ["dataset.html", "eval-progress.html", "index.html"]) {
        const src = path.join(RUN, "viz", name);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(gwDir, name));
    }
    console.log("copied gateway", gw);
} catch (e) {
    console.warn("gateway copy failed", e.message);
}
