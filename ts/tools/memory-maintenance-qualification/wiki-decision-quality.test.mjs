// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    boundedWikiDecision,
    classifyWikiLedger,
    nativeWikiJudgment,
} from "./wiki-decision-quality.mjs";
import {
    wikiJudgePacket,
    validateWikiJudgment,
} from "./wiki-admission-evaluation.mjs";
import { validateLedgerCoverage } from "./wiki-admission-judge.mjs";

const signal = () => new AbortController().signal;
function fixture() {
    const requests = [];
    const selected = {};
    const model = {
        async decide(request) {
            requests.push(request);
            return {
                success: true,
                data: {
                    answers: Object.fromEntries(
                        Object.entries(request.questions).map(([id, q]) => {
                            const keys = Object.keys(q.criteria);
                            const choice =
                                selected[id] ??
                                (keys.includes("4")
                                    ? "4"
                                    : keys.includes("supported")
                                      ? "supported"
                                      : keys.includes("none")
                                        ? "none"
                                        : keys.includes("yes")
                                          ? "yes"
                                          : keys.includes("same")
                                            ? "same"
                                            : keys.includes("tie")
                                              ? "tie"
                                              : (keys.find((key) =>
                                                    /w\d+$/.test(key),
                                                ) ?? keys[0]));
                            return [
                                id,
                                {
                                    type: "choice",
                                    choice,
                                    probabilities: { [choice]: 1 },
                                },
                            ];
                        }),
                    ),
                },
            };
        },
    };
    const fact = {
        id: "fact0",
        statement: "Copper alloys are useful.",
        quote: "Copper alloys are useful.",
        sourceKey: "original",
        critical: true,
    };
    function page(text) {
        return {
            viewId: "same-stable-id",
            definition: { wiki: { query: "Copper alloys", aliases: [] } },
            content: {
                title: "Alloys",
                summary: text,
                sections: [{ body: text }],
                citations: [],
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
    return { model, selected, requests, fact, page };
}

test("native quality classifies ledger support and criticality without explanatory generation", async () => {
    const f = fixture();
    const facts = [{ ...f.fact, critical: undefined }];
    await classifyWikiLedger(facts, f.model, signal());
    assert.equal(facts[0].critical, true);
    f.selected.fact0_support = "unsupported";
    await assert.rejects(
        classifyWikiLedger(facts, f.model, signal()),
        /support rejected/,
    );
});

test("native ledger validation receives complete source context beyond a paragraph witness", async () => {
    const f = fixture();
    const fact = { ...f.fact, sourceHash: "unchanged" };
    const text =
        "## Turn 1: assistant\n" +
        "Context. ".repeat(1000) +
        f.fact.quote +
        "\nFinal qualification.";
    await classifyWikiLedger([fact], f.model, signal(), undefined, [
        {
            sourceKey: fact.sourceKey,
            sourceHash: fact.sourceHash,
            source: { text },
        },
    ]);
    const state = JSON.parse(f.requests[0].state);
    assert.equal(state.originalSources[0].source.text, text);
    assert.ok(state.originalSources[0].source.text.length > 6000);
    assert.equal(state.facts[0].quote, fact.quote);
});

test("native ledger context rejects missing, changed or unrelated original sources before inference", async () => {
    const f = fixture();
    const fact = { ...f.fact, sourceHash: "unchanged" };
    for (const sources of [
        [],
        [
            {
                sourceKey: fact.sourceKey,
                sourceHash: "changed",
                source: { text: fact.quote },
            },
        ],
        [
            {
                sourceKey: fact.sourceKey,
                sourceHash: fact.sourceHash,
                source: { text: "Unrelated." },
            },
        ],
    ])
        await assert.rejects(
            classifyWikiLedger([fact], f.model, signal(), undefined, sources),
        );
    assert.equal(f.requests.length, 0);
});

test("native ledger batches do not duplicate large quotes across different complete sources", async () => {
    const f = fixture();
    const facts = Array.from({ length: 10 }, (_, index) => ({
        ...f.fact,
        id: `fact${index}`,
        sourceKey: `source${index % 2}`,
        sourceHash: "hash",
    }));
    await classifyWikiLedger(
        facts,
        f.model,
        signal(),
        undefined,
        [0, 1].map((index) => ({
            sourceKey: `source${index}`,
            sourceHash: "hash",
            source: { text: f.fact.quote },
        })),
    );
    assert.equal(f.requests.length, 4);
    for (const request of f.requests) {
        const state = JSON.parse(request.state);
        assert.ok(state.facts.length <= 4);
        assert.equal(state.originalSources.length, 1);
        assert.ok(
            state.facts.every(
                (fact) => fact.sourceKey === state.originalSources[0].sourceKey,
            ),
        );
    }
});

test("unsupported ledger artifacts get one source-bound repair followed by native support and fidelity checks", async () => {
    const f = fixture();
    const fact = { ...f.fact, sourceHash: "hash" };
    const sources = [
        {
            sourceKey: fact.sourceKey,
            sourceHash: "hash",
            source: { text: fact.quote },
        },
    ];
    const decide = f.model.decide;
    f.model.decide = async (request) => {
        f.selected.fact0_support = f.requests.length
            ? "supported"
            : "unsupported";
        return decide(request);
    };
    let repairs = 0;
    await classifyWikiLedger(
        [fact],
        f.model,
        signal(),
        undefined,
        sources,
        async (facts) => {
            repairs++;
            return facts.map((fact) => ({
                ...fact,
                statement: "The source describes copper alloys as useful.",
            }));
        },
    );
    assert.equal(repairs, 1);
    assert.equal(f.requests.length, 2);
    assert.equal(
        fact.statement,
        "The source describes copper alloys as useful.",
    );
    assert.ok(f.requests[1].questions.fact0_repair_fidelity);
});

test("a rejected or identity-changing ledger repair cannot drop facts or retry until acceptance", async () => {
    for (const mode of ["unsupported", "fidelity", "identity"]) {
        const f = fixture();
        const fact = { ...f.fact, sourceHash: "hash" };
        f.selected.fact0_support =
            mode === "fidelity" ? "uncertain" : "unsupported";
        f.selected.fact0_repair_fidelity = "no";
        let repairs = 0;
        await assert.rejects(
            classifyWikiLedger(
                [fact],
                f.model,
                signal(),
                undefined,
                [
                    {
                        sourceKey: fact.sourceKey,
                        sourceHash: "hash",
                        source: { text: fact.quote },
                    },
                ],
                async (facts) => {
                    repairs++;
                    if (mode === "fidelity")
                        f.selected.fact0_support = "supported";
                    return facts.map((fact) => ({
                        ...fact,
                        ...(mode === "identity" ? { id: "invented" } : {}),
                    }));
                },
            ),
        );
        assert.equal(repairs, 1);
        assert.equal(f.requests.length, mode === "identity" ? 1 : 2);
    }
});

test("native quality audits complete pages/facts and binds witnesses even with equal stable IDs across arms", async () => {
    const f = fixture();
    const a = f.page("Copper alloys are useful.");
    const b = f.page("Copper alloys have qualified uses.");
    const packet = wikiJudgePacket([a], [b], false, [
        { sourceKey: "original", text: f.fact.quote },
    ]);
    const ledger = { facts: [f.fact] };
    const result = await nativeWikiJudgment(
        packet,
        ledger,
        { A: [a], B: [b] },
        f.model,
        signal(),
    );
    validateWikiJudgment(result, packet);
    validateLedgerCoverage(result, packet, ledger);
    assert.equal(result.coverage.length, 1);
    assert.equal(result.matches.length, 1);
    assert.equal(result.winner, "tie");
    const pageRequests = f.requests
        .map((r) => JSON.parse(r.state))
        .filter((state) => state.page && !state.proseWitnesses);
    assert.deepEqual(
        pageRequests[0].evidence.map((e) => e.text),
        [a.generation.input.inputs[0].passages[0].excerpt],
    );
    assert.deepEqual(
        pageRequests[1].evidence.map((e) => e.text),
        [b.generation.input.inputs[0].passages[0].excerpt],
    );
});

test("native coverage sees every full prose witness one Wiki at a time; preference consumes audited results", async () => {
    const f = fixture();
    const text = "Complete context. ".repeat(600) + "Final qualification.";
    const a = f.page(text);
    const packet = wikiJudgePacket([a], [a], false);
    await nativeWikiJudgment(
        packet,
        { facts: [f.fact] },
        { A: [a], B: [a] },
        f.model,
        signal(),
    );
    const coverage = f.requests.filter((request) =>
        Object.keys(request.questions).some((key) => key.startsWith("fact0_")),
    );
    assert.equal(coverage.length, 2);
    for (const request of coverage) {
        const state = JSON.parse(request.state);
        assert.ok(["A", "B"].includes(state.side));
        assert.equal(state.sides, undefined);
        assert.ok(
            state.proseWitnesses
                .map((witness) => witness.text)
                .join("")
                .includes(text),
        );
        assert.equal(state.pages.length, 1);
    }
    const preference = JSON.parse(
        f.requests.find((request) => request.questions.winner).state,
    );
    assert.equal(preference.sides, undefined);
    assert.equal(preference.pageScores.A.length, 1);
    assert.equal(preference.coverageCounts.A.total, 1);
});

test("native fact coverage preserves uncertainty instead of treating it as missing or covered", async () => {
    const f = fixture(),
        a = f.page(f.fact.quote);
    f.selected.fact0_A = "uncertain";
    const packet = wikiJudgePacket([a], [a], false);
    const result = await nativeWikiJudgment(
        packet,
        { facts: [f.fact] },
        { A: [a], B: [a] },
        f.model,
        signal(),
    );
    assert.equal(result.coverage[0].A, "uncertain");
    assert.equal(result.coverage[0].AQuote, "");
});

test("native quality validates every answer and captures provider errors", async () => {
    const traces = [];
    const q = {
        result: {
            type: "choice",
            instructions: "Judge.",
            criteria: { yes: "Yes." },
        },
    };
    await assert.rejects(
        boundedWikiDecision(
            { decide: async () => ({ success: false, code: "timeout" }) },
            "test",
            {},
            q,
            signal(),
            (trace) => traces.push(trace),
        ),
        /timeout/,
    );
    assert.ok(traces[0].error);
    await assert.rejects(
        boundedWikiDecision(
            { decide: async () => ({ success: true, data: { answers: {} } }) },
            "test",
            {},
            q,
            signal(),
        ),
        /Missing/,
    );
});
