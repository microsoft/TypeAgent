// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    benchmarkScorecard,
    digest,
    executeMemoryCase,
    judgePrompt,
    officialJudgeTemplates,
    sessionSource,
} from "./longmemeval-runner.mjs";
import {
    benchmarkConfiguration,
    benchmarkFailure,
    benchmarkInvocationAllowance,
    closeBenchmarkService,
    acknowledgeStopAfterQuestion,
    main,
} from "./longmemeval-live.mjs";

test("cooperative question-boundary stops acknowledge durably and malformed controls fail explicitly", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "longmemeval-stop-"),
    );
    try {
        const state = { currentQuestionId: "graded-question" };
        let persisted;
        const persist = async () => {
            persisted = structuredClone(state);
        };
        assert.equal(
            await acknowledgeStopAfterQuestion(directory, state, persist),
            false,
        );
        await writeFile(
            path.join(directory, "stop-after-question.json"),
            JSON.stringify({ stop: true }),
        );
        assert.equal(
            await acknowledgeStopAfterQuestion(directory, state, persist),
            true,
        );
        assert.equal(
            persisted.stopAfterQuestion.lastQuestionId,
            "graded-question",
        );
        assert.ok(persisted.stopAfterQuestion.acknowledgedEpochMs);
        await writeFile(
            path.join(directory, "stop-after-question.json"),
            JSON.stringify({ stop: false }),
        );
        await assert.rejects(
            acknowledgeStopAfterQuestion(directory, state, persist),
            /stop: true/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("Azure configuration identity survives persisted JSON without an optional model name", () => {
    const settings = {
        provider: "azure",
        endpoint: "https://test.invalid",
        requestConstraints: { contextTokens: 1000 },
    };
    const identity = benchmarkConfiguration(settings);
    assert.deepEqual(JSON.parse(JSON.stringify(identity)), identity);
    assert.equal("modelName" in identity, false);
    assert.equal(
        benchmarkConfiguration({ ...settings, modelName: "configured" })
            .modelName,
        "configured",
    );
    assert.notDeepEqual(
        identity,
        benchmarkConfiguration({
            ...settings,
            endpoint: "https://other.invalid",
        }),
    );
});

test("question-count bounds are rejected before creating or opening a run", async () => {
    for (const value of ["0", "-1", "1.5", "501", "NaN"]) {
        await assert.rejects(
            main(["--authorized-live-benchmark", `--max-questions=${value}`]),
            /Batch question limit/,
        );
    }
});

test("invocation work allowance is bounded before opening a run", async () => {
    for (const value of ["0", "-1", "1.5", "31", "NaN"]) {
        await assert.rejects(
            main(["--authorized-live-benchmark", `--work-minutes=${value}`]),
            /Invocation work minutes/,
        );
    }
});

test("unlimited evaluation is explicit while normal invocation budgets remain unchanged", () => {
    assert.equal(benchmarkInvocationAllowance("unlimited"), null);
    assert.equal(benchmarkInvocationAllowance("30"), 35 * 60000);
    assert.equal(benchmarkInvocationAllowance("1"), 6 * 60000);
    for (const value of ["Infinity", "", "null", "0", "-1", "31"]) {
        assert.throws(
            () => benchmarkInvocationAllowance(value),
            /Invocation work minutes/,
        );
    }
});

test("benchmark failure diagnostics retain filesystem codes and frame locations without raw messages", () => {
    const error = Object.assign(new Error("PRIVATE_MESSAGE_SENTINEL"), {
        code: "EPERM",
        syscall: "rename",
        stack: "Error: PRIVATE_MESSAGE_SENTINEL\n at async writeJson (file:///private/harness.mjs:90:5)\n at async runWorker (file:///private/longmemeval-live.mjs:360:9)",
    });
    const failure = benchmarkFailure(error);
    assert.equal(failure.code, "EPERM");
    assert.equal(failure.syscall, "rename");
    assert.deepEqual(failure.ownedHarnessFrames, [
        "harness.mjs:90:5",
        "longmemeval-live.mjs:360:9",
    ]);
    assert.ok(!JSON.stringify(failure).includes("PRIVATE_MESSAGE_SENTINEL"));
    assert.ok(!JSON.stringify(failure).includes("/private/"));
    assert.equal(
        benchmarkFailure({
            code: "PRIVATE_MESSAGE_SENTINEL",
            syscall: "PRIVATE_MESSAGE_SENTINEL",
        }).code,
        undefined,
    );
});

test("bounded outcome is durable before close waits, and close failures remain failures", async () => {
    const state = { outcome: "PARTIAL_BOUNDED_WORK" };
    const attempt = {};
    const writes = [];
    let release;
    const closed = new Promise((resolve) => {
        release = resolve;
    });
    const closing = closeBenchmarkService(
        { close: () => closed },
        state,
        attempt,
        async () => {
            writes.push(structuredClone({ state, attempt }));
        },
        (error) => ({ name: error.name }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].attempt.outcome, "PARTIAL_BOUNDED_WORK");
    assert.ok(writes[0].attempt.closeStartedEpochMs);
    assert.equal(writes[0].attempt.supportedClose, undefined);
    release();
    await closing;
    assert.equal(writes.at(-1).attempt.supportedClose, "COMPLETE");
    await closeBenchmarkService(
        {
            async close() {
                throw new Error("Controlled close failure");
            },
        },
        state,
        attempt,
        async () => {
            writes.push(structuredClone({ state, attempt }));
        },
        (error) => ({ name: error.name }),
    );
    assert.equal(state.outcome, "FAILED_SUPPORTED_CLOSE");
    assert.deepEqual(attempt.supportedClose, { name: "Error" });
});

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
    assert.equal(f.calls.answer[0].question, reader.question);
    assert.deepEqual(f.calls.answer[0].temporalContext, {
        referenceTime: reader.question_date,
        availabilityPolicy: "supplied-history",
    });
    assert.equal(
        f.calls.ingestion[0].temporalContext.scopes[0].messageTime,
        construction.sessions[0].date,
    );
    assert.ok(
        !JSON.stringify(f.calls.answer).includes("EVALUATOR_GOLD_SENTINEL"),
    );
    assert.equal(f.calls.judge[0][0].answer, reference.answer);
    assert.equal(f.record.evidenceSessionRecallAt20Matches, 1);
});

test("preliminary retrieval, answer retrieval and actual reader coverage have separate denominators", async () => {
    const f = fixture();
    const distinct = {
        ...construction,
        sessions: construction.sessions.map((session, index) => ({
            ...session,
            id: `synthetic-${index}`,
        })),
    };
    const expected = {
        ...reference,
        answer_session_ids: ["synthetic-0", "synthetic-1"],
    };
    const originalAnswer = f.service.answer;
    f.service.answer = async (request) => ({
        ...(await originalAnswer(request)),
        readerContext: {
            retrievedMessageOrdinals: [1],
            messageOrdinals: [],
            knowledgeMessageOrdinals: [1],
            retrievedSourceIds: ["source-1"],
            messageSourceIds: [],
            knowledgeSourceIds: ["source-1"],
            completedChunks: 1,
            serializedContextChars: 100,
        },
    });
    await executeMemoryCase(
        f.service,
        distinct,
        reader,
        expected,
        f.record,
        f.controls,
    );
    assert.equal(f.record.evidenceSessionRecallAt20Matches, 1);
    assert.equal(f.record.answerRetrievalEvidenceSessionRecall, 0.5);
    assert.equal(f.record.readerMessageEvidenceSessionRecall, 0);
    assert.equal(f.record.readerKnowledgeEvidenceSessionRecall, 0.5);
    const scorecard = benchmarkScorecard(
        {
            evaluatorOnly: { references: [expected] },
            manifest: { provenance: {} },
        },
        { case: f.record },
        [],
    );
    assert.deepEqual(
        scorecard.evidenceCoverage.readerMessageEvidenceSessionRecall,
        { measuredQuestions: 1, mean: 0 },
    );
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
