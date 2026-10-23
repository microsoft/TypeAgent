// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createCampaignPlan } from "../macro-eval-plan.mjs";
import { summarizeCampaign } from "../macro-eval-report.mjs";

const cases = [
    { id: "source", kind: "training", familyId: "documents" },
    { id: "read-a", kind: "positive", familyId: "documents" },
    { id: "read-b", kind: "positive", familyId: "documents" },
    { id: "negated", kind: "negative", familyId: "documents" },
];
const options = {
    mode: "paired",
    seed: 17,
    caseIds: ["read-a", "read-b"],
    repetitions: 10,
    rootModel: "gpt-5.6-sol",
    maxTargetModelTurns: 150,
    maxDurationMs: 900000,
};

function results(plan, baselineMs = 100, reuseMs = 50) {
    return plan.schedule.map((item) => ({
        ...item,
        grade: { status: "passed", taskCorrect: true, grammarHit: true },
        timing: {
            boundary: plan.timingBoundary,
            elapsedMs: item.condition === "baseline" ? baselineMs : reuseMs,
        },
    }));
}

test("paired schedules preserve identical tasks and deterministic randomized order", () => {
    const plan = createCampaignPlan(cases, options);
    assert.deepEqual(plan, createCampaignPlan(cases, options));
    assert.equal(plan.schedule.length, 40);
    for (let index = 0; index < plan.schedule.length; index += 2) {
        const pair = plan.schedule.slice(index, index + 2);
        assert.equal(pair[0].pairId, pair[1].pairId);
        assert.equal(pair[0].scenarioId, pair[1].scenarioId);
        assert.deepEqual(pair.map((item) => item.condition).sort(), [
            "baseline",
            "reuse",
        ]);
    }
    assert.equal(plan.samplingSeed, null);
    assert.equal(plan.acceptance, "unexecuted");
});

test("plans require explicit models, budgets, valid IDs and positive performance cases", () => {
    for (const override of [
        { rootModel: "" },
        { runnerModel: "gpt-5.6-sol" },
        { maxTargetModelTurns: 0 },
        { maxDurationMs: -1 },
        { seed: -1 },
        { caseIds: ["unknown"] },
        { caseIds: ["read-a", "read-a"] },
        { caseIds: ["negated"] },
    ])
        assert.throws(() =>
            createCampaignPlan(cases, { ...options, ...override }),
        );
});

test("stress schedule distinguishes warm trials from the genuine midpoint restart", () => {
    const plan = createCampaignPlan(cases, {
        ...options,
        mode: "stress",
        caseIds: ["read-a"],
        repetitions: 20,
    });
    assert.deepEqual(
        plan.schedule
            .filter((item) => item.freshSession)
            .map((item) => item.repetition),
        [0, 10],
    );
    assert.equal(plan.schedule.filter((item) => item.restartBefore).length, 1);
    assert.equal(
        plan.schedule.some((item) => item.restoreLearnedStore),
        false,
    );
});

test("performance campaigns cannot pool different task families", () => {
    assert.throws(
        () =>
            createCampaignPlan(
                [cases[1], { ...cases[2], familyId: "files" }],
                options,
            ),
        /one task family/,
    );
});

test("report computes observed paired savings and preparation break-even", () => {
    const plan = createCampaignPlan(cases, options);
    const report = summarizeCampaign(plan, results(plan), { elapsedMs: 225 });
    assert.equal(report.performance.matchedCorrectGrammarPairs, 20);
    assert.equal(report.performance.medianPairedRatio, 0.5);
    assert.deepEqual(report.performance.breakEven, {
        status: "observed-estimate",
        reuseCount: 5,
    });
    assert.equal(report.usage.rootModelTokens, null);
});

test("slower reuse has no observed break-even; missing preparation stays unknown", () => {
    const plan = createCampaignPlan(cases, options);
    assert.equal(
        summarizeCampaign(plan, results(plan, 50, 100), { elapsedMs: 225 })
            .performance.breakEven.status,
        "no-observed-break-even",
    );
    assert.equal(
        summarizeCampaign(plan, results(plan)).performance.breakEven.status,
        "unknown",
    );
    assert.equal(
        summarizeCampaign(plan, results(plan, 50, 100)).performance.breakEven
            .status,
        "no-observed-break-even",
    );
});

test("missing trials, grammar misses and failed outcomes remain in denominators", () => {
    const plan = createCampaignPlan(cases, options);
    const rows = results(plan).slice(0, -1);
    rows[0].grade.status = "failed";
    rows.slice(2, 4).find((row) => row.condition === "reuse").grade.grammarHit =
        false;
    const report = summarizeCampaign(plan, rows);
    assert.equal(report.complete, false);
    assert.equal(report.missing, 1);
    assert.equal(report.outcomes.failed, 1);
    assert.equal(report.performance.matchedCorrectGrammarPairs, 17);
    assert.equal(report.grammar.misses, 1);
});

test("report rejects mixed timing boundaries, duplicate trials and identity changes", () => {
    const plan = createCampaignPlan(cases, options);
    const rows = results(plan);
    assert.throws(() => summarizeCampaign(plan, [...rows, rows[0]]));
    assert.throws(() =>
        summarizeCampaign(plan, [
            { ...rows[0], timing: { boundary: "host-only", elapsedMs: 1 } },
        ]),
    );
    assert.throws(() =>
        summarizeCampaign(plan, [{ ...rows[0], condition: "not-scheduled" }]),
    );
    assert.throws(() =>
        summarizeCampaign(
            { ...plan, schedule: [...plan.schedule, plan.schedule[0]] },
            rows,
        ),
    );
    assert.throws(() =>
        summarizeCampaign({ ...plan, corpusHash: "frozen-oracle" }, [
            { ...rows[0], corpusHash: "different-oracle" },
        ]),
    );
});
