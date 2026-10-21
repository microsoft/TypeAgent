// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    benchmarkScorecard,
    digest,
    executeMemoryCase,
    judgePrompt,
    officialJudgeTemplates,
    sessionSource,
} from "./longmemeval-runner.mjs";

const construction = {
    id: "case",
    sessions: [0, 1].map((position) => ({
        id: "repeated-official-id",
        position,
        date: "2024/01/01 12:00",
        turns: [{ role: "user", content: position ? "" : "Original history." }],
    })),
};
const reader = {
    question_id: "case",
    question: "READER_QUESTION_SENTINEL",
    question_date: "2024/02/01 12:00",
};
const reference = {
    ...reader,
    answer: "EVALUATOR_GOLD_SENTINEL",
    question_type: "single-session-user",
    answer_session_ids: ["repeated-official-id"],
};

function fixture() {
    const sources = [];
    const calls = { ingestion: [], answer: [], judge: [] };
    const service = {
        listSources: async () => sources,
        ingestDocument: async ({ source }) => {
            calls.ingestion.push(source);
            const id = `source-${sources.length}`;
            sources.push({
                ...source,
                sourceId: id,
                activeRevisionId: id,
                revisions: [
                    {
                        revisionId: id,
                        contentHash: digest(source.text),
                        state: "ready",
                    },
                ],
            });
            return { sourceId: id, revisionId: id, jobId: id };
        },
        search: async () => ({
            matches: sources.map((source) => ({ sourceId: source.sourceId })),
        }),
        answer: async (request) => {
            calls.answer.push(request);
            return {
                answer: "A generated hypothesis.",
                mode: "synthesized",
                citations: [],
                indexVersion: "v1",
                warnings: [],
            };
        },
    };
    const controls = {
        persist: async () => {},
        signal: new AbortController().signal,
        role: () => {},
        waitForMemoryJob: async () => ({ state: "complete" }),
        judge: async (...args) => {
            calls.judge.push(args);
            return { model: "unit-controlled-model", label: true };
        },
    };
    return {
        service,
        calls,
        controls,
        record: {
            corpusId: "corpus",
            operations: [],
            mappings: {},
            status: "ingesting",
        },
    };
}

test("session projection preserves roles, dates, empty turns and repeated IDs by original position", () => {
    const first = sessionSource("case", construction.sessions[0]);
    const second = sessionSource("case", construction.sessions[1]);
    assert.notEqual(first.sourceKey, second.sourceKey);
    assert.notEqual(first.canonicalUri, second.canonicalUri);
    assert.ok(first.source.text.includes("2024/01/01 12:00"));
    assert.ok(first.source.text.includes("Turn 1: user\nOriginal history."));
    assert.ok(second.source.text.endsWith("Turn 1: user\n"));
    assert.equal(digest(first.source.text), first.sha256);
});

test("production-shaped ingestion and answering exclude reference answers and reader questions from construction", async () => {
    const f = fixture();
    await executeMemoryCase(
        f.service,
        construction,
        reader,
        reference,
        f.record,
        f.controls,
    );
    assert.equal(f.record.status, "complete");
    assert.equal(f.calls.ingestion.length, 2);
    assert.ok(
        !JSON.stringify(f.calls.ingestion).includes("EVALUATOR_GOLD_SENTINEL"),
    );
    assert.ok(
        !JSON.stringify(f.calls.ingestion).includes("READER_QUESTION_SENTINEL"),
    );
    assert.ok(f.calls.answer[0].question.includes(reader.question_date));
    assert.ok(
        !JSON.stringify(f.calls.answer).includes("EVALUATOR_GOLD_SENTINEL"),
    );
    assert.equal(f.calls.judge[0][0].answer, reference.answer);
    assert.equal(f.record.evidenceSessionRecallAt20Matches, 1);
});

test("resume after a saved hypothesis neither re-ingests histories nor regenerates the answer", async () => {
    const f = fixture();
    f.controls.persist = async () => {
        if (f.record.hypothesis)
            throw new Error("controlled interruption before judge");
    };
    await assert.rejects(
        executeMemoryCase(
            f.service,
            construction,
            reader,
            reference,
            f.record,
            f.controls,
        ),
        /controlled interruption/,
    );
    f.controls.persist = async () => {};
    await executeMemoryCase(
        f.service,
        construction,
        reader,
        reference,
        f.record,
        f.controls,
    );
    assert.equal(f.calls.ingestion.length, 2);
    assert.equal(f.calls.answer.length, 1);
    assert.equal(f.calls.judge.length, 1);
    assert.equal(f.record.status, "complete");
});

test("failed ingestion never advances the completed ledger or fabricates a hypothesis", async () => {
    const f = fixture();
    f.controls.waitForMemoryJob = async () => ({ state: "failed" });
    await assert.rejects(
        executeMemoryCase(
            f.service,
            construction,
            reader,
            reference,
            f.record,
            f.controls,
        ),
        /did not complete/,
    );
    assert.equal(f.record.operations.length, 0);
    assert.equal(f.record.hypothesis, undefined);
    assert.ok(f.record.inFlight);
});

test("judge prompts select original task/abstention templates and safely substitute arbitrary strings", () => {
    const templates = Array.from(
        { length: 5 },
        (_, i) => `template-${i} {} {} {}`,
    );
    assert.equal(
        judgePrompt(templates, reference, "hypothesis"),
        `template-0 ${reader.question} ${reference.answer} hypothesis`,
    );
    assert.ok(
        judgePrompt(
            templates,
            { ...reference, question_type: "temporal-reasoning" },
            "{}",
        ).startsWith("template-1"),
    );
    assert.ok(
        judgePrompt(
            templates,
            { ...reference, question_id: "case_abs" },
            "$&",
        ).startsWith("template-4"),
    );
    assert.throws(
        () => officialJudgeTemplates("modified official evaluator"),
        /changed/,
    );
});

test("partial scorecards report observed denominators but never a full-suite score or invented dollar cost", () => {
    const second = { ...reference, question_id: "other_abs" };
    const prepared = {
        manifest: { provenance: {} },
        evaluatorOnly: { references: [reference, second] },
    };
    const records = {
        case: {
            status: "complete",
            answerMilliseconds: 100,
            autoeval_label: { label: true, model: "controlled" },
        },
    };
    const result = benchmarkScorecard(prepared, records, [
        {
            usage: {
                prompt_tokens: 10,
                completion_tokens: 2,
                total_tokens: 12,
            },
        },
        { status: 500 },
    ]);
    assert.deepEqual(result.total, {
        scheduled: 2,
        scored: 1,
        correct: 1,
        missing: 1,
        observedAccuracy: 1,
        fullScheduleAccuracy: null,
    });

    test("the live benchmark entrypoint imports safely and refuses inference without explicit authorization", async () => {
        const { main } = await import("./longmemeval-live.mjs");
        await assert.rejects(main([]));
        await assert.rejects(main(["--authorized-live-benchmark"]));
    });
    assert.equal(result.abstention.scored, 0);
    assert.equal(result.abstention.observedAccuracy, null);
    assert.equal(result.knownTotalTokens, 12);
    assert.equal(result.dollarCost, null);
    assert.equal(result.answerLatencyMs.p95, 100);
});
