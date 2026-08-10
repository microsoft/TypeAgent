#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const RUN = path.dirname(fileURLToPath(import.meta.url));
const ckpt = path.join(RUN, "artifacts/eval-checkpoint-azure-gpt56.jsonl");
const log = path.join(RUN, "logs/eval.log");
const out = process.argv[2] || path.join(RUN, "viz/eval-progress.html");
const gw =
    "/Users/dominicnguyen/Documents/mygithub.com/dom-files-gateway/.data/plans/translation-bench-1k-neg-fairness/eval-progress.html";

const MODELS = [
    "azure/gpt-5.6-sol",
    "azure/gpt-5.6-terra",
    "azure/gpt-5.6-luna",
];
let header = null;
const byModel = Object.fromEntries(
    MODELS.map((m) => [
        m,
        { done: 0, pass: 0, fail: 0, err: 0, lat: [], last: null },
    ]),
);
let totalRows = 0;
if (fs.existsSync(ckpt)) {
    const lines = fs.readFileSync(ckpt, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
        let o;
        try {
            o = JSON.parse(line);
        } catch {
            continue;
        }
        if (o.kind === "translation-bench-checkpoint") {
            header = o;
            continue;
        }
        const v = o.value || o;
        const model = o.model || v.model;
        if (!model || !byModel[model]) continue;
        totalRows += 1;
        const b = byModel[model];
        b.done += 1;
        const score = v.score || {};
        if (score.passed) b.pass += 1;
        else b.fail += 1;
        if (v.error || score.diagnostics?.invalidJsonOrTranslationFailure)
            b.err += 1;
        if (typeof v.elapsedMs === "number") b.lat.push(v.elapsedMs);
        b.last = {
            caseId: v.caseId || o.caseId,
            passed: !!score.passed,
            utterance: (v.utterance || "").slice(0, 120),
        };
    }
}
const suiteCaseCount = header?.settings?.suiteCaseCount || 0;
const expected = suiteCaseCount * MODELS.length || 0;
const logTail = fs.existsSync(log)
    ? fs.readFileSync(log, "utf8").trim().split("\n").slice(-12)
    : [];
const pidAlive = (() => {
    try {
        const pid = Number(
            fs.readFileSync(path.join(RUN, "logs/eval.pid"), "utf8").trim(),
        );
        process.kill(pid, 0);
        return pid;
    } catch {
        return null;
    }
})();

function pct(a, b) {
    return b ? ((a / b) * 100).toFixed(1) : "0.0";
}
function med(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}
function p95(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

const cards = MODELS.map((m) => {
    const b = byModel[m];
    const target = suiteCaseCount || Math.max(b.done, 1);
    return {
        model: m,
        done: b.done,
        target,
        pass: b.pass,
        fail: b.fail,
        err: b.err,
        passRate: b.done ? b.pass / b.done : 0,
        medMs: med(b.lat),
        p95Ms: p95(b.lat),
        last: b.last,
    };
});

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="refresh" content="15"/>
<title>TB 1k neg-fairness · eval progress</title>
<style>
:root{--bg:#07090c;--panel:#10151c;--line:#243041;--text:#e8eef7;--muted:#8b9bb0;--ok:#3dd68c;--bad:#ff6b6b;--accent:#6ea8fe;--warn:#f5a524}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,sans-serif;background:radial-gradient(1000px 500px at 10% -10%,#152033,var(--bg) 55%);color:var(--text);min-height:100vh}
header{padding:22px 28px;border-bottom:1px solid var(--line)}
h1{margin:0 0 4px;font-size:22px;letter-spacing:-.03em}.sub{color:var(--muted);font-size:13px}
.wrap{max-width:1200px;margin:0 auto;padding:20px 28px 48px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}
.card{background:linear-gradient(180deg,#141b24,var(--panel));border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.07em;font-weight:600}
.value{font-size:28px;font-weight:750;margin-top:6px;font-variant-numeric:tabular-nums}
.hint{color:var(--muted);font-size:12px;margin-top:4px}
.bar{height:8px;background:#1a2230;border-radius:999px;overflow:hidden;margin-top:12px}
.bar>i{display:block;height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6 70%,#3dd68c)}
.badge{display:inline-flex;gap:8px;align-items:center;padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:var(--panel);font-size:12px;font-weight:600}
.badge.ok{color:var(--ok);border-color:rgba(61,214,140,.35)}.badge.run{color:var(--accent);border-color:rgba(110,168,254,.35)}.badge.dead{color:var(--warn)}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
pre{background:#0c1118;border:1px solid var(--line);border-radius:12px;padding:12px;overflow:auto;color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid var(--line);padding:10px;text-align:left}th{color:var(--muted);font-size:11px;text-transform:uppercase}
.pass{color:var(--ok)}.fail{color:var(--bad)}
@media(max-width:900px){.grid{grid-template-columns:1fr}}
</style></head><body>
<header>
  <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
    <div>
      <h1>1k neg-fairness · multi-model eval</h1>
      <div class="sub">azure/gpt-5.6-sol · terra · luna · concurrency 10 each · auto-refresh 15s</div>
    </div>
    <div class="badge ${pidAlive ? "run" : totalRows && expected && totalRows >= expected ? "ok" : "dead"}">
      ${pidAlive ? "RUNNING pid " + pidAlive : totalRows && expected && totalRows >= expected ? "COMPLETE" : "IDLE / stopped"}
    </div>
  </div>
</header>
<div class="wrap">
  <div class="grid">
    <div class="card"><div class="label">Total rows done</div><div class="value">${totalRows.toLocaleString()}${expected ? " / " + expected.toLocaleString() : ""}</div>
      <div class="hint">${expected ? pct(totalRows, expected) + "% of suite×models" : "waiting for checkpoint header"}</div>
      <div class="bar"><i style="width:${expected ? Math.min(100, (totalRows / expected) * 100) : 0}%"></i></div>
    </div>
    <div class="card"><div class="label">Suite cases / model</div><div class="value">${(suiteCaseCount || 0).toLocaleString()}</div>
      <div class="hint">models=${MODELS.length} · peak in-flight=30</div></div>
    <div class="card"><div class="label">Updated</div><div class="value" style="font-size:18px;margin-top:10px">${new Date().toISOString()}</div>
      <div class="hint">source ${path.basename(ckpt)}</div></div>
  </div>
  <div class="grid">
    ${cards
        .map(
            (c) => `<div class="card">
      <div class="label">${c.model}</div>
      <div class="value">${c.done.toLocaleString()}${suiteCaseCount ? " / " + suiteCaseCount.toLocaleString() : ""}</div>
      <div class="hint"><span class="pass">${c.pass} pass</span> · <span class="fail">${c.fail} fail</span> · passRate=${(c.passRate * 100).toFixed(1)}%</div>
      <div class="hint">med ${c.medMs != null ? Math.round(c.medMs) + "ms" : "—"} · p95 ${c.p95Ms != null ? Math.round(c.p95Ms) + "ms" : "—"} · err-ish ${c.err}</div>
      <div class="bar"><i style="width:${suiteCaseCount ? Math.min(100, (c.done / suiteCaseCount) * 100) : c.done ? 100 : 0}%"></i></div>
      <div class="hint mono" style="margin-top:8px">${c.last ? (c.last.passed ? "✓ " : "✗ ") + c.last.caseId + " · " + (c.last.utterance || "") : "—"}</div>
    </div>`,
        )
        .join("")}
  </div>
  <div class="card" style="margin-top:12px">
    <div class="label">Log tail</div>
    <pre>${logTail.map((l) => l.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])).join("\n") || "(no log yet)"}</pre>
  </div>
  <p class="hint" style="margin-top:14px">Dataset explorer: <span class="mono">viz/dataset.html</span> · final report written to <span class="mono">artifacts/eval-report.html</span> on completion.</p>
</div>
</body></html>`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
try {
    fs.mkdirSync(path.dirname(gw), { recursive: true });
    fs.copyFileSync(out, gw);
} catch {}
console.log(
    "wrote",
    out,
    "rows",
    totalRows,
    "expected",
    expected,
    "pid",
    pidAlive,
);
