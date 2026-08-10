#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Post-gen fairness audit for empty-gold TB negatives.
 * Prefer LLM structured assessments (kind + fairEmptyGold); no verb lexicons.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN = __dirname;
const tsRoot = path.resolve(RUN, "../../../../../");

function loadEnv(file) {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!m) continue;
        let v = m[2];
        if (
            (v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))
        ) {
            v = v.slice(1, -1);
        }
        if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
}
loadEnv(path.join(tsRoot, ".env.real"));

// Prefer azure/* routes (stable on this LiteLLM proxy). Also register bare IDs.
const EVAL_MODELS = [
    "azure/gpt-5.6-sol",
    "azure/gpt-5.6-terra",
    "azure/gpt-5.6-luna",
    "gpt-4o",
    "gpt-4.1",
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
];
for (const id of EVAL_MODELS) {
    if (process.env[`OPENAI_MODEL_${id}`] === undefined) {
        process.env[`OPENAI_MODEL_${id}`] = id;
    }
}
process.env.OPENAI_RESPONSE_FORMAT = process.env.OPENAI_RESPONSE_FORMAT || "1";

const MODEL =
    process.env.TB_FAIRNESS_MODEL ||
    process.env.TB_REVIEWER_MODEL ||
    "azure/gpt-5.6-sol";
const BATCH = Number(process.env.TB_FAIRNESS_BATCH || 20);
const CONCURRENCY = Number(process.env.TB_FAIRNESS_CONCURRENCY || 10);
const SAMPLE = process.env.TB_FAIRNESS_SAMPLE
    ? Number(process.env.TB_FAIRNESS_SAMPLE)
    : undefined;
// Accept if unfair rate at or below this (default 2%)
const MAX_UNFAIR_RATE = Number(process.env.TB_FAIRNESS_MAX_UNFAIR_RATE || 0.02);

// Zero-action under full catalog: only hard abstain/pure refusal is fair.
const FAIR_KINDS = new Set(["pure_refusal"]);
const ALL_KINDS = [
    "pure_refusal",
    "non_action_question",
    "missing_info",
    "unfair_contrastive",
    "unfair_imperative",
    "unfair_sibling_command",
    "unknown",
];

const draftPath = process.env.TB_DRAFT_PATH
    ? path.resolve(process.env.TB_DRAFT_PATH)
    : path.join(RUN, "artifacts/benchmark-draft-1000.jsonl");
const outPath = process.env.TB_FAIRNESS_OUT
    ? path.resolve(process.env.TB_FAIRNESS_OUT)
    : path.join(RUN, "artifacts/fairness-audit.json");
if (!fs.existsSync(draftPath)) throw new Error(`Missing draft: ${draftPath}`);

const aiclient = await import(
    pathToFileURL(path.join(tsRoot, "packages/aiclient/dist/index.js")).href
);
aiclient.initRuntimeConfigFromProcessEnv();
const available = await aiclient.getChatModelNames();
console.log("configured models:", available.join(", "));
if (!available.includes(MODEL)) {
    throw new Error(
        `Model '${MODEL}' not configured. Available: ${available.join(", ")}`,
    );
}

const model = aiclient.openai.createChatModel(
    {
        provider: "openai",
        modelType: "chat",
        apiKey: process.env.OPENAI_API_KEY,
        endpoint: process.env.OPENAI_ENDPOINT,
        modelName: MODEL,
        supportsResponseFormat: true,
        maxConcurrency: Math.max(CONCURRENCY * 2, 8),
        timeout: 180_000,
        maxRetryAttempts: 3,
    },
    {
        response_format: { type: "json_object" },
        reasoning_effort: "low",
        verbosity: "low",
        temperature: 0,
    },
    undefined,
    ["translation-bench-fairness-audit"],
);

// Parse draft: collect empty-gold negatives
const negatives = [];
const lines = fs.readFileSync(draftPath, "utf8").split("\n").filter(Boolean);
let rows = 0;
for (const line of lines) {
    const rec = JSON.parse(line);
    if (rec.recordType !== "case") continue;
    rows += 1;
    const target = rec.targetAction;
    const targetStr = target
        ? `${target.schemaName}.${target.actionName}`
        : "?";
    for (const g of rec.generalizations || []) {
        const acts = g.expectedActions || [];
        if (acts.length !== 0) continue;
        const sel = g.selection || {};
        negatives.push({
            caseId: rec.id,
            utterance: g.utterance,
            target: targetStr,
            storedKind:
                sel.dimensions?.negativeKind || sel.dimensions?.kind || null,
            storedReason: sel.dimensions?.negativeBoundaryReason || null,
        });
    }
}
console.log(`rows=${rows} empty-gold negatives=${negatives.length}`);

let sample = negatives;
if (SAMPLE && SAMPLE < negatives.length) {
    // deterministic stride sample
    const step = negatives.length / SAMPLE;
    sample = Array.from(
        { length: SAMPLE },
        (_, i) => negatives[Math.floor(i * step)],
    );
    console.log(`sampling ${sample.length} of ${negatives.length}`);
} else {
    console.log(`auditing all ${sample.length} negatives`);
}

const system = `You audit empty-gold negative cases for a tool-use translation bench.
Empty gold means expectedActions=[] and the model scores PASS only if it emits ZERO tools
across the FULL catalog (chat, help, history, lookup, and every other loaded tool — not
merely "not the target").

A negative is FAIR (fairEmptyGold=true) ONLY for:
- pure_refusal: user refuses / forbids / leave-alone the target with NO alternate task,
  NO question, and NO request for explanation. A careful translator fires no tool at all.

Mark fairEmptyGold=false for:
- non_action_question: definition/meta/status questions (invite chat/help/history)
- missing_info: underspecified asks that still invite list/lookup/clarify-via-tool
- unfair_contrastive: refuse target then ask for a sibling/alternate command
- unfair_imperative: still an imperative or soft solicit that should map to some tool
- unfair_sibling_command: asks for a different concrete action while empty-gold
- unknown: cannot classify safely → treat as unfair

Return JSON only: {"assessments":[{"i":number,"kind":string,"fairEmptyGold":boolean,"reason":string}]}
kind must be one of: ${ALL_KINDS.join(", ")}
One assessment per input item, matching i.`;

function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

async function assessBatch(batch, offset) {
    const items = batch.map((n, j) => ({
        i: offset + j,
        utterance: n.utterance,
        targetAction: n.target,
    }));
    const user = `Assess these empty-gold negatives:\n${JSON.stringify(items, null, 2)}`;
    // Match generate.mjs: json_object mode, no bare json_schema (Azure needs name).
    const result = await model.complete([
        { role: "system", content: system },
        { role: "user", content: user },
    ]);
    if (!result.success) {
        throw new Error(`LLM audit failed: ${result.message}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(result.data);
    } catch (e) {
        throw new Error(
            `Bad JSON from audit model: ${String(result.data).slice(0, 400)}`,
        );
    }
    const assessments = parsed.assessments || [];
    if (assessments.length !== batch.length) {
        // tolerate and map by i
        console.warn(
            `[fairness] batch offset=${offset} expected ${batch.length} got ${assessments.length}`,
        );
    }
    return assessments;
}

const batches = chunk(sample, BATCH);
const assessmentsByIndex = new Map();
let done = 0;
const started = Date.now();

// simple pool
let next = 0;
async function worker() {
    while (true) {
        const bi = next++;
        if (bi >= batches.length) return;
        const batch = batches[bi];
        const offset = bi * BATCH;
        let attempts = 0;
        while (true) {
            attempts += 1;
            try {
                const assessments = await assessBatch(batch, offset);
                for (const a of assessments) {
                    assessmentsByIndex.set(a.i, a);
                }
                done += batch.length;
                const elapsed = ((Date.now() - started) / 1000).toFixed(0);
                console.log(
                    `[fairness] ${done}/${sample.length} elapsed=${elapsed}s batch=${bi + 1}/${batches.length}`,
                );
                break;
            } catch (e) {
                if (attempts >= 3) throw e;
                console.warn(`[fairness] retry batch ${bi}: ${e.message || e}`);
                await new Promise((r) => setTimeout(r, 1000 * attempts));
            }
        }
    }
}
await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () =>
        worker(),
    ),
);

const kind_distribution = {};
const unfair_examples = [];
const borderline_examples = [];
const all_negatives = [];
let unfair_count = 0;
let missing = 0;

for (let i = 0; i < sample.length; i++) {
    const n = sample[i];
    const a = assessmentsByIndex.get(i);
    if (!a) {
        missing += 1;
        unfair_count += 1;
        unfair_examples.push({
            u: n.utterance,
            k: "unknown",
            t: n.target,
            reason: "missing assessment",
            caseId: n.caseId,
        });
        continue;
    }
    const kind = ALL_KINDS.includes(a.kind) ? a.kind : "unknown";
    const fair = Boolean(a.fairEmptyGold) && FAIR_KINDS.has(kind);
    kind_distribution[kind] = (kind_distribution[kind] || 0) + 1;
    all_negatives.push({ u: n.utterance, k: kind, t: n.target });
    if (!fair) {
        unfair_count += 1;
        if (unfair_examples.length < 50) {
            unfair_examples.push({
                u: n.utterance,
                k: kind,
                t: n.target,
                reason: a.reason,
                caseId: n.caseId,
                fairEmptyGold: a.fairEmptyGold,
            });
        }
    }
}

const unfair_negative_rate = sample.length ? unfair_count / sample.length : 0;
const ok = unfair_negative_rate <= MAX_UNFAIR_RATE && missing === 0;

// also report stored-kind agreement if present
let stored_disagreement = 0;
let stored_present = 0;
for (let i = 0; i < sample.length; i++) {
    const n = sample[i];
    const a = assessmentsByIndex.get(i);
    if (!n.storedKind || !a) continue;
    stored_present += 1;
    const storedFair = FAIR_KINDS.has(n.storedKind);
    const llmFair = Boolean(a.fairEmptyGold) && FAIR_KINDS.has(a.kind);
    if (storedFair !== llmFair) stored_disagreement += 1;
}

const report = {
    source: draftPath,
    rows,
    neg_count: negatives.length,
    audited: sample.length,
    unfair_count,
    unfair_negative_rate,
    missing_assessments: missing,
    kind_distribution,
    unfair_examples,
    borderline_count: borderline_examples.length,
    borderline_examples,
    stored_kind_present: stored_present,
    stored_vs_llm_disagreement: stored_disagreement,
    model: MODEL,
    max_unfair_rate: MAX_UNFAIR_RATE,
    ok,
    all_negatives,
    elapsedSec: (Date.now() - started) / 1000,
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(
    JSON.stringify(
        {
            outPath,
            rows,
            neg_count: negatives.length,
            audited: sample.length,
            unfair_count,
            unfair_negative_rate,
            kind_distribution,
            ok,
            elapsedSec: report.elapsedSec,
        },
        null,
        2,
    ),
);

if (!ok) {
    console.error(
        `[fairness] FAIL unfair_rate=${unfair_negative_rate} > max=${MAX_UNFAIR_RATE} or missing=${missing}`,
    );
    process.exit(2);
}
console.log("[fairness] PASS");
