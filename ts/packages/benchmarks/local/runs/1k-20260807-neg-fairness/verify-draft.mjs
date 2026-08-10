#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Verify a draft/approved TB jsonl before eval.
 * Usage: node verify-draft.mjs <draft.jsonl> [allowlist.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const draftPath = process.argv[2];
if (!draftPath || !fs.existsSync(draftPath)) {
    console.error("usage: verify-draft.mjs <draft.jsonl>");
    process.exit(2);
}
const THIS_TS = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../",
);
const bmMod = await import(
    pathToFileURL(
        path.join(
            THIS_TS,
            "packages/benchmarks/dist/translationBench/synthesizer/benchmark.js",
        ),
    ).href
);
const elMod = await import(
    pathToFileURL(
        path.join(
            THIS_TS,
            "packages/benchmarks/dist/translationBench/synthesizer/eligibleActions.js",
        ),
    ).href
);

const text = fs.readFileSync(draftPath, "utf8");
const benchmark = bmMod.parseTranslationBenchBenchmarkJsonl(text, draftPath);
const allow = elMod.getPackagedEligibleGoldActionIds().allowlist;

const targets = new Set();
const utts = new Map();
let banned = 0;
let roles = { seed: 0, positive: 0, negative: 0, other: 0 };
let emptyGoldPos = 0;
let nonEmptyNeg = 0;

for (const c of benchmark.cases) {
    const id = `${c.targetAction.schemaName}.${c.targetAction.actionName}`;
    targets.add(id);
    if (!allow.has(id)) banned += 1;
    if (c.seed?.utterance) {
        utts.set(c.seed.utterance, (utts.get(c.seed.utterance) || 0) + 1);
        roles.seed += 1;
    }
    for (const g of c.generalizations || []) {
        const role = g.selection?.role || g.role || "other";
        if (role === "positive") roles.positive += 1;
        else if (role === "negative") roles.negative += 1;
        else roles.other += 1;
        const acts = g.expectedActions || [];
        if (role === "positive" && acts.length === 0) emptyGoldPos += 1;
        if (role === "negative" && acts.length > 0) nonEmptyNeg += 1;
        if (g.utterance)
            utts.set(g.utterance, (utts.get(g.utterance) || 0) + 1);
    }
}
const dupUtts = [...utts.entries()].filter(([, n]) => n > 1).length;
const report = {
    path: draftPath,
    cases: benchmark.cases.length,
    uniqueTargets: targets.size,
    roles,
    notOnAllowlist: banned,
    duplicateUtterances: dupUtts,
    emptyGoldPositive: emptyGoldPos,
    nonEmptyNegative: nonEmptyNeg,
    approval: benchmark.metadata?.approval?.status,
    ok:
        benchmark.cases.length >= 1 &&
        banned === 0 &&
        emptyGoldPos === 0 &&
        nonEmptyNeg === 0,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
