// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    auditGenerativeWikiLedger,
    createGenerativeWikiDecisionModel,
} from "./wiki-generative-quality.mjs";
import {
    boundedWikiDecision,
    nativeWikiJudgment,
} from "./wiki-decision-quality.mjs";
import { sessionSource } from "./longmemeval-runner.mjs";
import {
    wikiJudgePacket,
    validateWikiJudgment,
} from "./wiki-admission-evaluation.mjs";
import { validateLedgerCoverage } from "./wiki-admission-judge.mjs";
import { wikiShipScorecard } from "./wiki-ship-scorecard.mjs";

const signal = () => new AbortController().signal;
function fixture() {
    const calls = [];
    const choices = {};
    const chat = {
        inspectRequest() {
            return {
                constraints: {
                    metadata: "configured",
                    declaredLimits: { inputTokens: 1000000 },
                },
            };
        },
        async complete(messages, _a, format) {
            calls.push(messages);
            return {
                success: true,
                data: JSON.stringify(
                    Object.fromEntries(
                        Object.entries(format.schema.properties).map(
                            ([id, property]) => [
                                id,
                                choices[id] ??
                                    [
                                        "4",
                                        "supported",
                                        "no",
                                        "none",
                                        "same",
                                        "tie",
                                    ].find((value) =>
                                        property.enum.includes(value),
                                    ) ??
                                    property.enum.find((value) =>
                                        /w\d+$/.test(value),
                                    ) ??
                                    property.enum[0],
                            ],
                        ),
                    ),
                ),
            };
        },
    };
    const model = createGenerativeWikiDecisionModel(chat);
    return { calls, choices, chat, model };
}

test("staged chat backend requires exactly the supplied choice keys and preserves provider traces", async () => {
    const f = fixture();
    const traces = [];
    const result = await boundedWikiDecision(
        f.model,
        "check",
        { full: "A".repeat(9000) },
        {
            item: {
                type: "choice",
                instructions: "Choose.",
                criteria: { yes: "Yes.", no: "No." },
            },
        },
        signal(),
        (trace) => traces.push(trace),
    );
    assert.equal(result.item, "no");
    assert.equal(traces.length, 2);
    assert.ok(
        traces.every(
            (trace) => trace.qualityBackend === "generative-staged-v2",
        ),
    );
    assert.equal(JSON.parse(f.calls[0][1].content).state.full.length, 9000);
    f.chat.complete = async () => ({ success: true, data: '{"extra":"yes"}' });
    await assert.rejects(
        boundedWikiDecision(
            f.model,
            "check",
            {},
            {
                item: {
                    type: "choice",
                    instructions: "Choose.",
                    criteria: { yes: "Yes." },
                },
            },
            signal(),
        ),
        /Missing\/extra/,
    );
});

test("source audits account for 1001 facts with complete context and explicit non-support, not early exit", async () => {
    const f = fixture();
    f.choices.fact0_support = "unsupported";
    f.choices.fact1_support = "uncertain";
    f.choices.fact2_critical = "uncertain";
    const construction = {
        id: "history",
        sessions: [
            {
                id: "session",
                position: 0,
                date: "2026-01-01",
                turns: [
                    {
                        role: "user",
                        content: "Context ".repeat(1100) + "Exact fact.",
                    },
                ],
            },
        ],
    };
    const source = sessionSource(construction.id, construction.sessions[0]);
    const ledger = {
        facts: Array.from({ length: 1001 }, (_, index) => ({
            id: `fact${index}`,
            statement: "Exact fact.",
            quote: "Exact fact.",
            sourceKey: source.sourceKey,
            sourceHash: source.sha256,
        })),
    };
    await auditGenerativeWikiLedger(ledger, construction, f.model, signal());
    assert.equal(ledger.auditStatus, "complete");
    assert.equal(ledger.facts.length, 1001);
    assert.equal(f.calls.length, 251);
    assert.equal(ledger.facts[0].sourceAudit.support, "unsupported");
    assert.equal(ledger.facts[1].sourceAudit.support, "uncertain");
    assert.equal(ledger.facts[2].critical, true);
    assert.ok(ledger.facts.every((fact) => fact.sourceAudit));
    for (const call of f.calls) {
        const state = JSON.parse(call[1].content).state;
        assert.ok(state.facts.length <= 4);
        assert.equal(state.originalSource.text, source.source.text);
    }
    ledger.facts[0].sourceHash = "changed";
    await assert.rejects(
        auditGenerativeWikiLedger(ledger, construction, f.model, signal()),
    );
    assert.equal(f.calls.length, 251);
});

function page(text) {
    return {
        viewId: "page",
        definition: {
            wiki: {
                query: "A source-grounded purpose",
                aliases: ["Alternate purpose"],
            },
        },
        content: {
            title: "Title",
            summary: "First claim.",
            sections: [{ body: text }],
            citations: [
                { sourceId: "original", revisionId: "r1", locator: "p0" },
            ],
        },
        generation: {
            input: {
                inputs: [
                    {
                        passages: [
                            {
                                sourceId: "original",
                                revisionId: "r1",
                                locator: "p0",
                                excerpt: text,
                            },
                        ],
                    },
                ],
            },
        },
    };
}

test("full-page witnesses support compound facts across 1000-character boundaries and never drop unresolved source facts", async () => {
    const f = fixture();
    const body =
        "Opening claim. " + "middle ".repeat(1200) + "Final qualification.";
    const views = [page(body)];
    const ledger = {
        facts: [
            {
                id: "fact0",
                statement: "Opening claim and final qualification.",
                critical: true,
                sourceAudit: { support: "supported", criticality: "yes" },
            },
            {
                id: "fact1",
                statement: "Unresolved source fact.",
                critical: true,
                sourceAudit: { support: "uncertain", criticality: "uncertain" },
            },
        ],
    };
    const packet = wikiJudgePacket(views, views, false);
    const judgment = await nativeWikiJudgment(
        packet,
        ledger,
        { A: views, B: views },
        f.model,
        signal(),
    );
    validateWikiJudgment(judgment, packet);
    validateLedgerCoverage(judgment, packet, ledger);
    assert.equal(judgment.coverage.length, 2);
    assert.equal(judgment.coverage[0].A, "covered");
    assert.ok(judgment.coverage[0].AQuote.includes("Opening claim."));
    assert.ok(judgment.coverage[0].AQuote.includes("Final qualification."));
    assert.equal(judgment.coverage[1].A, "uncertain");
    assert.equal(judgment.coverage[1].B, "uncertain");
    const coverageCalls = f.calls
        .map((messages) => JSON.parse(messages[1].content).state)
        .filter((state) => state.proseWitnesses);
    assert.ok(
        coverageCalls.every(
            (state) =>
                state.facts.length === 1 &&
                state.proseWitnesses[0].text.includes(body),
        ),
    );
    const pageCalls = f.calls
        .map((messages) => JSON.parse(messages[1].content).state)
        .filter((state) => state.page && !state.proseWitnesses);
    assert.equal(pageCalls[0].page.query, views[0].definition.wiki.query);
    assert.deepEqual(
        pageCalls[0].page.aliases,
        views[0].definition.wiki.aliases,
    );
    assert.deepEqual(
        pageCalls[0].page.content.citations,
        views[0].content.citations,
    );
    const matches = f.calls
        .map((messages) => JSON.parse(messages[1].content).state)
        .filter((state) => state.A && state.B);
    assert.equal(matches[0].A.query, views[0].definition.wiki.query);
});

test("uncertain page scores remain explicit conservative bounds and block qualification", async () => {
    const f = fixture();
    f.choices.support = "uncertain";
    f.choices.defect = "uncertain";
    const views = [page("Exact fact.")];
    const packet = wikiJudgePacket(views, views, false);
    const judgment = await nativeWikiJudgment(
        packet,
        { facts: [] },
        { A: views, B: views },
        f.model,
        signal(),
    );
    assert.equal(judgment.pageScores.A[0].scores.support, 1);
    assert.deepEqual(judgment.pageScores.A[0].unresolvedDimensions, [
        "support",
    ]);
    assert.equal(judgment.pageScores.A[0].supportUncertain, true);
});

test("successful construction from different checkpoints is diagnostic, not a paired latency win", () => {
    const f = scoreFixture();
    f.quality.comparisons[0].readinessComparable = false;
    const result = wikiShipScorecard(f.campaign, f.quality);
    assert.equal(result.histories[0].construction.comparable, false);
    assert.equal(result.histories[0].construction.reduction, null);
});

function scoreFixture() {
    const scores = {
        usefulness: 5,
        support: 5,
        completeness: 5,
        scope: 5,
        qualifications: 5,
        citations: 5,
    };
    const judgment = {
        winner: "tie",
        pageScores: {
            A: [{ pageId: "a", scores }],
            B: [{ pageId: "b", scores }],
        },
        coverage: [{ factId: "f", A: "covered", B: "covered" }],
        matches: [{ A: "a", B: "b" }],
        defects: [],
    };
    return {
        campaign: {
            trials: [
                {
                    id: "h",
                    arm: "G0",
                    repetition: 0,
                    status: "complete",
                    readinessMs: 1000,
                },
                {
                    id: "h",
                    arm: "D1",
                    repetition: 0,
                    status: "complete",
                    readinessMs: 700,
                },
            ],
        },
        quality: {
            execution: "live",
            qualityMode: "generative-staged-v2",
            failures: [],
            ledgers: [
                {
                    questionId: "h",
                    facts: [
                        {
                            id: "f",
                            critical: true,
                            sourceAudit: {
                                support: "supported",
                                criticality: "yes",
                            },
                        },
                    ],
                },
            ],
            comparisons: [
                {
                    id: "h",
                    arm: "D1",
                    repetition: 0,
                    judgments: [
                        {
                            reversed: false,
                            judgment: structuredClone(judgment),
                        },
                        {
                            reversed: true,
                            judgment: {
                                ...structuredClone(judgment),
                                matches: [{ A: "b", B: "a" }],
                            },
                        },
                    ],
                },
            ],
        },
    };
}

test("ship scorecards never convert censored construction, unresolved labels or an incomplete audit into a ship decision", () => {
    const f = scoreFixture();
    let result = wikiShipScorecard(f.campaign, f.quality);
    assert.equal(result.recommendation, "HOLD");
    assert.equal(
        result.histories[0].construction.reduction,
        0.30000000000000004,
    );
    assert.equal(result.histories[0].sourceLedger.unresolved, 0);
    f.campaign.trials[0].status = "censored";
    f.quality.ledgers[0].facts[0].sourceAudit.support = "uncertain";
    f.quality.comparisons[0].judgments.pop();
    result = wikiShipScorecard(f.campaign, f.quality);
    assert.equal(result.histories[0].construction.reduction, null);
    assert.equal(result.histories[0].sourceLedger.unresolved, 1);
    assert.equal(result.recommendation, "HOLD");
    assert.equal(
        result.histories[0].gates.find(
            (gate) => gate.name === "both-order-complete-evaluation",
        ).status,
        "unmeasured",
    );
});

test("ship scorecards retain raw quality deltas and critical coverage losses instead of rounding them away", () => {
    const f = scoreFixture();
    const order = f.quality.comparisons[0].judgments[0].judgment;
    order.pageScores.B = Array.from({ length: 4 }, (_, index) => ({
        pageId: `b${index}`,
        scores: { ...order.pageScores.B[0].scores, support: index ? 5 : 4 },
    }));
    order.coverage[0].B = "missing";
    const result = wikiShipScorecard(f.campaign, f.quality);
    assert.equal(result.recommendation, "NO-GO");
    assert.equal(result.histories[0].orders[0].dimensionDeltas.support, -0.25);
    assert.equal(
        result.histories[0].orders[0].retainedBaselineFacts.criticalLost,
        1,
    );
    assert.equal(
        result.histories[0].orders[0].retainedBaselineFacts.lowerBound,
        0,
    );
});
