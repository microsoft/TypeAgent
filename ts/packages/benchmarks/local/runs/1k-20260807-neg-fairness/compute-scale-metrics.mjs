#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Read-only metrics from draft + eval checkpoint (no gold rewrites).
 * Emits kind mix, pass-by-kind, fire-on-empty, pos abstention-FNR.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUN = path.dirname(fileURLToPath(import.meta.url));
const art = path.join(RUN, "artifacts");
const draftPath =
    process.env.TB_DRAFT_PATH || path.join(art, "benchmark-draft-1000.jsonl");
const ckptPath =
    process.env.TB_EVAL_CHECKPOINT ||
    path.join(art, "eval-checkpoint-azure-gpt56.jsonl");
const fairnessPath =
    process.env.TB_FAIRNESS_OUT || path.join(art, "fairness-audit.json");
const outPath =
    process.env.TB_SCALE_OUT || path.join(art, "scale-metrics.json");

function loadJsonl(p) {
    return fs
        .readFileSync(p, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
}

const kindByCase = new Map();
const kindMix = {};
let rows = 0;
for (const rec of loadJsonl(draftPath)) {
    if (rec.recordType !== "case") continue;
    rows += 1;
    for (const g of rec.generalizations || []) {
        const role = g.selection?.role || g.role;
        const acts = g.expectedActions || [];
        if (role !== "negative" && acts.length !== 0) continue;
        if (acts.length !== 0) continue;
        const kind =
            g.selection?.dimensions?.negativeKind ||
            g.dimensions?.negativeKind ||
            "unknown";
        kindMix[kind] = (kindMix[kind] || 0) + 1;
        kindByCase.set(rec.id, kind);
    }
}

const byKind = {};
const byModel = {};
let cells = 0;
let passed = 0;
let negCells = 0;
let negPassed = 0;
let negFired = 0;
let posCells = 0;
let posPassed = 0;
let posEmpty = 0;
let toolSum = 0;
let toolN = 0;
let paramSum = 0;
let paramN = 0;

for (const rec of loadJsonl(ckptPath)) {
    if (rec.kind !== "translation-bench-row") continue;
    const v = rec.value || {};
    const exp = v.expectedActions || [];
    const chosen = v.chosenActions || [];
    const score = v.score || {};
    const isPass = !!score.passed;
    const model = rec.model || v.model || "?";
    const isNeg = exp.length === 0;
    cells += 1;
    if (isPass) passed += 1;

    byModel[model] ||= {
        cells: 0,
        passed: 0,
        neg_cells: 0,
        neg_passed: 0,
        pos_cells: 0,
        pos_passed: 0,
    };
    const bm = byModel[model];
    bm.cells += 1;
    if (isPass) bm.passed += 1;

    if (isNeg) {
        negCells += 1;
        bm.neg_cells += 1;
        if (isPass) {
            negPassed += 1;
            bm.neg_passed += 1;
        }
        if (chosen.length > 0) negFired += 1;
        const kind =
            v.dimensions?.negativeKind ||
            kindByCase.get(rec.caseId) ||
            "unknown";
        byKind[kind] ||= { n: 0, pass: 0, fired: 0, zero: 0 };
        const bk = byKind[kind];
        bk.n += 1;
        if (isPass) bk.pass += 1;
        if (chosen.length > 0) bk.fired += 1;
        else bk.zero += 1;
    } else {
        posCells += 1;
        bm.pos_cells += 1;
        if (isPass) {
            posPassed += 1;
            bm.pos_passed += 1;
        }
        if (chosen.length === 0) posEmpty += 1;
        if (typeof score.routed === "number" && exp.length > 0) {
            toolSum += score.routed / exp.length;
            toolN += 1;
        }
        if (
            typeof score.exactParamMatches === "number" &&
            typeof score.paramMatches === "number"
        ) {
            // prefer report summary when available; keep simple here
        }
    }
}

// Prefer report summary tool/param if present
let toolRate = toolN ? toolSum / toolN : null;
let paramRate = null;
const summaryPath = path.join(art, "eval-report-summary.json");
if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    const s = summary.summary || {};
    if (typeof s.toolScore === "number") toolRate = s.toolScore;
    if (typeof s.parameterScore === "number") paramRate = s.parameterScore;
    if (typeof s.tool === "number") toolRate = s.tool;
    if (typeof s.param === "number") paramRate = s.param;
    // nested rates
    for (const [k, v] of Object.entries(s)) {
        if (toolRate == null && /tool/i.test(k) && typeof v === "number")
            toolRate = v;
        if (paramRate == null && /param/i.test(k) && typeof v === "number")
            paramRate = v;
    }
}

let unfair_neg_count = null;
let unfair_neg_rate = null;
let fairness_ok = null;
let fairness_method = null;
let fairness_audited = null;
if (fs.existsSync(fairnessPath)) {
    const f = JSON.parse(fs.readFileSync(fairnessPath, "utf8"));
    unfair_neg_count = f.unfair_count ?? null;
    unfair_neg_rate = f.unfair_negative_rate ?? null;
    fairness_ok = f.ok ?? null;
    fairness_method = f.method ?? "llm_structured_assessment";
    fairness_audited = f.audited ?? f.neg_count ?? null;
}

const passByKind = Object.fromEntries(
    Object.entries(byKind).map(([k, v]) => [
        k,
        {
            cells: v.n,
            passed: v.pass,
            pass_rate: v.n ? v.pass / v.n : 0,
            fire_rate: v.n ? v.fired / v.n : 0,
            zero_rate: v.n ? v.zero / v.n : 0,
        },
    ]),
);

const out = {
    rows,
    eval_cells: cells,
    pass_rate: cells ? passed / cells : 0,
    tool_rate: toolRate,
    param_rate: paramRate,
    neg_pass_rate: negCells ? negPassed / negCells : 0,
    neg_cells: negCells,
    neg_passed: negPassed,
    neg_fire_on_empty_rate: negCells ? negFired / negCells : 0,
    pos_pass_rate: posCells ? posPassed / posCells : 0,
    pos_abstention_fnr: posCells ? posEmpty / posCells : 0,
    kind_mix: kindMix,
    pass_by_kind: passByKind,
    unfair_neg_count,
    unfair_neg_rate,
    fairness_ok,
    fairness_method,
    fairness_audited,
    models: Object.keys(byModel),
    by_model: Object.fromEntries(
        Object.entries(byModel).map(([m, v]) => [
            m,
            {
                pass_rate: v.cells ? v.passed / v.cells : 0,
                neg_pass_rate: v.neg_cells ? v.neg_passed / v.neg_cells : 0,
                pos_pass_rate: v.pos_cells ? v.pos_passed / v.pos_cells : 0,
                cells: v.cells,
            },
        ]),
    ),
    generatedAt: new Date().toISOString(),
};

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
