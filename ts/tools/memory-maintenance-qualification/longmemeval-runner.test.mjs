// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { observeProvider } from "./live-stages.mjs";
import {
    benchmarkScorecard,
    digest,
    executeMemoryCase,
    judgePrompt,
    officialJudgeTemplates,
    preflightRetainedKnowledge,
    sessionSource,
} from "./longmemeval-runner.mjs";
import {
    benchmarkConfiguration,
    observedJudgeModel,
    benchmarkFailure,
    benchmarkInvocationAllowance,
    benchmarkKnowledgeTimeout,
    closeBenchmarkService,
    acknowledgeStopAfterQuestion,
    selectConstructionCases,
    createBenchmarkMemoryService,
    createRetainedKnowledgeReader,
    recordBenchmarkArm,
    recordKnowledgeAllowance,
    continuedBenchmarkState,
    main,
} from "./longmemeval-live.mjs";

test("explicit readiness allowances remain within the product API bound", () => {
    assert.equal(benchmarkKnowledgeTimeout("10"), 600000);
    assert.equal(benchmarkKnowledgeTimeout("60"), 3600000);
    for (const value of ["0", "61", "1.5", "unlimited", "not-a-number"])
        assert.throws(() => benchmarkKnowledgeTimeout(value));
});

test("the production factory forwards diagnostic receipts without replacing inference", async () => {
    const receipts = [];
    const callback = (receipt) => receipts.push(receipt);
    const service = {};
    const result = await createBenchmarkMemoryService(
        async () => ({
            createDurableMemoryService(root, sink) {
                assert.equal(root, "isolated-store");
                assert.equal(sink, callback);
                sink({ stage: "packing", durationMs: 1 });
                return service;
            },
        }),
        "isolated-store",
        callback,
    );
    assert.equal(result, service);
    assert.deepEqual(receipts, [{ stage: "packing", durationMs: 1 }]);
});

test("readiness allowance identity defaults legacy state and rejects changed resumes", () => {
    const legacy = {};
    recordKnowledgeAllowance(legacy);
    assert.equal(legacy.knowledgeTimeoutMs, 600000);
    assert.throws(
        () => recordKnowledgeAllowance(legacy, 3600000),
        /Knowledge readiness allowance changed/,
    );
    const extended = { knowledgeTimeoutMs: 3600000 };
    recordKnowledgeAllowance(extended, 3600000);
    assert.throws(
        () => recordKnowledgeAllowance(extended),
        /Knowledge readiness allowance changed/,
    );
});

test("an explicit warm continuation gets new accounting without mutating its interrupted parent", () => {
    const prior = {
        runId: "parent",
        outcome: "PARTIAL_BOUNDED_WORK",
        knowledgeTimeoutMs: 600000,
        arm: { knowledgeTimeoutMs: 600000 },
        engineHash: "old",
        cases: {
            case1: {
                status: "interrupted",
                operations: [{ state: "complete" }],
                mappings: { source: { sourceId: "s", revisionId: "r" } },
                knowledgeCheckpoint: { state: "cancelled" },
                error: { category: "timeout" },
            },
        },
        providerRequests: [{ model: "parent-model" }],
        roleCalls: [{}],
        attempts: [{}],
        scorecard: { scored: 0 },
    };
    const frozen = structuredClone(prior);
    const state = continuedBenchmarkState(prior, "child", 1800000, "new", {
        parentRunDirectory: path.resolve("parent"),
        parentStateSha256: "a".repeat(64),
    });
    assert.deepEqual(prior, frozen);
    assert.equal(state.runId, "child");
    assert.equal(state.knowledgeTimeoutMs, 1800000);
    assert.equal(state.arm.knowledgeTimeoutMs, 1800000);
    assert.equal(state.cases.case1.knowledgeCheckpoint, undefined);
    assert.equal(state.cases.case1.error, undefined);
    assert.deepEqual(
        state.cases.case1.operations,
        prior.cases.case1.operations,
    );
    assert.deepEqual(state.cases.case1.mappings, prior.cases.case1.mappings);
    assert.deepEqual(state.providerRequests, []);
    assert.deepEqual(state.attempts, []);
    assert.equal(state.scorecard, undefined);
    assert.equal(state.continuation.reusedCompletedImports, 1);
    assert.equal(state.continuation.previousKnowledgeTimeoutMs, 600000);
    assert.equal(state.engineHash, "new");
    assert.throws(
        () => continuedBenchmarkState(prior, "child", 600000, "new", {}),
        /larger readiness allowance/,
    );
    assert.throws(
        () =>
            continuedBenchmarkState(
                { ...prior, outcome: "FAILED_REAL_BENCHMARK" },
                "child",
                1800000,
                "new",
                {},
            ),
        /bounded interruption/,
    );
    const answered = structuredClone(prior);
    answered.cases.case1.hypothesis = "Retained answer";
    assert.throws(
        () => continuedBenchmarkState(answered, "child", 1800000, "new", {}),
        /existing hypothesis/,
    );
});

test("provider timing identifies Decision packets even without a reported response model", async () => {
    const original = globalThis.fetch;
    const events = [];
    let restore;
    try {
        globalThis.fetch = async () =>
            new Response(JSON.stringify({ answers: {} }), {
                headers: { "content-type": "application/json" },
            });
        restore = observeProvider(events, () => "knowledge:pilot");
        await fetch(
            "https://example.invalid/providers/microsoft/v1/systemone",
            {
                method: "POST",
                body: JSON.stringify({
                    model: "decision-1",
                    questions: { disposition_n0: {}, salience_n0: {} },
                }),
            },
        );
        assert.equal(events[0].type, "decision");
        assert.equal(events[0].requestedModel, "decision-1");
        assert.equal(events[0].decisionQuestionCount, 2);
        assert.equal(events[0].model, undefined);
        assert.equal(events[0].role, "knowledge:pilot");
        assert.ok(events[0].durationMs >= 0);
    } finally {
        restore?.();
        globalThis.fetch = original;
    }
});

test("the live benchmark uses the product durable-memory factory without feature overrides", async () => {
    const service = {};
    const loaded = [];
    let receivedRoot;
    const actual = await createBenchmarkMemoryService(async (file) => {
        loaded.push(file);
        return {
            createDurableMemoryService(root, ...overrides) {
                receivedRoot = root;
                assert.deepEqual(overrides, []);
                return service;
            },
        };
    }, "isolated-benchmark-store");
    assert.equal(actual, service);
    assert.equal(receivedRoot, "isolated-benchmark-store");
    assert.deepEqual(loaded, [
        "packages\\agentServer\\server\\dist\\durableMemoryService.js",
    ]);
});

test("effective product capabilities are recorded and configuration changes cannot resume silently", () => {
    const state = {};
    const capabilities = {
        features: { sourceSynopses: true },
        derivedViews: { informationalWiki: true, drafts: true },
    };
    recordBenchmarkArm(state, capabilities, false);
    assert.equal(state.arm.sourceSynopses, true);
    assert.equal(state.arm.informationalViews, true);
    assert.equal(state.arm.viewDrafts, true);
    recordBenchmarkArm(state, capabilities, true);
    assert.throws(
        () =>
            recordBenchmarkArm(
                state,
                { features: { sourceSynopses: false } },
                true,
            ),
        /Product memory configuration changed/,
    );
    assert.equal(state.arm.informationalViews, true);
});

test("diagnostic selection is exact, validated and retains the frozen construction order", () => {
    const cases = ["a", "b", "c"].map((id) => ({ id }));
    assert.deepEqual(selectConstructionCases(cases, ["c", "a"]), [
        cases[0],
        cases[2],
    ]);
    assert.equal(selectConstructionCases(cases, undefined), cases);
    for (const invalid of [[], ["a", "a"], ["unknown"]])
        assert.throws(
            () => selectConstructionCases(cases, invalid),
            /Diagnostic|Unknown/,
        );
});

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

test("judge identity ignores concurrent maintenance responses and never reuses an earlier judge model", () => {
    const events = [
        { role: "benchmarkJudge.complete", model: "previous-judge" },
        { role: "ingestion:case", model: "source-synopsis" },
        { role: "benchmarkJudge.complete", model: "current-judge" },
        { role: "judge:case", model: "background-maintenance" },
    ];
    assert.equal(observedJudgeModel(events, 1), "current-judge");
    assert.throws(
        () => observedJudgeModel(events, 3),
        /Judge provider response omitted model identity/,
    );
    assert.throws(
        () =>
            observedJudgeModel(
                [...events, { role: "benchmarkJudge.complete" }],
                4,
            ),
        /Judge provider response omitted model identity/,
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
    for (const value of ["0", "-1", "1.5", "61", "NaN"]) {
        await assert.rejects(
            main(["--authorized-live-benchmark", `--work-minutes=${value}`]),
            /Invocation work minutes/,
        );
    }
});

test("unlimited evaluation is explicit while normal invocation budgets remain unchanged", () => {
    assert.equal(benchmarkInvocationAllowance("unlimited"), null);
    assert.equal(benchmarkInvocationAllowance("30"), 35 * 60000);
    assert.equal(benchmarkInvocationAllowance("60"), 65 * 60000);
    assert.equal(benchmarkInvocationAllowance("1"), 6 * 60000);
    for (const value of ["Infinity", "", "null", "0", "-1", "61"]) {
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
    const calls = {
        ingestion: [],
        search: [],
        answer: [],
        wait: [],
        judge: [],
    };
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
        search: async (request) => {
            calls.search.push(request);
            throw new Error(
                "The product-default benchmark must not add a preliminary search",
            );
        },
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
        waitForMemoryJob: async (_service, _jobId, options) => {
            calls.wait.push(options);
            return { state: "complete" };
        },
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

for (const outcome of ["returned", "timed-out"]) {
    test(`required checkpoint observation retains durable readiness independently of wait ${outcome}`, async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
        const f = fixture();
        const waited = Promise.withResolvers();
        let checkpoint = {
            checkpointId: "observed",
            state: "running",
            reasons: [],
            updatedAt: "initial",
            families: ["wiki", "topics"],
        };
        f.service.createKnowledgeCheckpoint = async () =>
            structuredClone(checkpoint);
        f.service.getKnowledgeCheckpoint = async () =>
            structuredClone(checkpoint);
        f.service.waitForKnowledgeCheckpoint = () => waited.promise;
        const running = executeMemoryCase(
            f.service,
            construction,
            reader,
            reference,
            f.record,
            f.controls,
        );
        const expected =
            outcome === "timed-out"
                ? assert.rejects(running, /Timed out waiting/)
                : running;
        for (let index = 0; index < 60; index++) await Promise.resolve();
        assert.equal(f.record.knowledgeWait.outcome, "running");
        checkpoint = {
            ...checkpoint,
            state: "ready",
            updatedAt: "durable-ready",
        };
        t.mock.timers.tick(30000);
        for (let index = 0; index < 60; index++) await Promise.resolve();
        assert.equal(f.record.knowledgeCheckpoint.state, "ready");
        assert.equal(
            f.record.knowledgeObservation.requiredCheckpointSatisfied,
            true,
        );
        assert.equal(f.calls.answer.length, 0);
        if (outcome === "timed-out")
            waited.reject(
                new Error(
                    "Timed out waiting for knowledge checkpoint; work continues",
                ),
            );
        else waited.resolve(structuredClone(checkpoint));
        await expected;
        assert.equal(f.record.knowledgeWait.outcome, outcome);
        assert.equal(f.record.knowledgeCheckpoint.state, "ready");
        assert.equal(f.record.knowledgeObservation.active, false);
        assert.equal(f.calls.answer.length, outcome === "returned" ? 1 : 0);
    });
}

test("retained preflight publishes independent blockers without waiting for the first corpus", async () => {
    const first = Promise.withResolvers();
    const records = {
        first: { corpusId: "first" },
        blocked: { corpusId: "blocked" },
    };
    const persisted = [];
    const discovery = (receipts) => ({ discovery: { receipts } });
    const pending = preflightRetainedKnowledge(
        {
            getKnowledgeStatus() {
                throw new Error("Must use read-only committed receipts");
            },
        },
        records,
        {
            signal: new AbortController().signal,
            readRetainedKnowledgeStatus: (id) =>
                id === "first"
                    ? first.promise
                    : Promise.resolve(
                          discovery([
                              { fingerprint: "failed", state: "failed" },
                          ]),
                      ),
            failure: benchmarkFailure,
            persist: async () => {
                persisted.push(structuredClone(records));
            },
        },
    );
    for (let index = 0; index < 20; index++) await Promise.resolve();
    assert.equal(
        persisted[0].blocked.retainedKnowledgePreflight.attempts[0].status,
        "blocked",
    );
    first.resolve(discovery([]));
    await pending;
    assert.equal(
        records.first.retainedKnowledgePreflight.attempts[0].status,
        "clear",
    );
    assert.equal(
        records.blocked.retainedKnowledgePreflight.attempts[0].failedReceipts
            .length,
        1,
    );
});

test("retained preflight read and persistence failures remain explicit", async () => {
    const record = { corpusId: "failed-read" };
    await assert.rejects(
        preflightRetainedKnowledge(
            {
                getKnowledgeStatus: async () => {
                    throw new Error("Read failed");
                },
            },
            { record },
            {
                signal: new AbortController().signal,
                failure: benchmarkFailure,
                persist: async () => {
                    throw new Error("Persistence failed");
                },
            },
        ),
        (error) => {
            assert.ok(error instanceof AggregateError);
            assert.match(
                error.errors[0].message,
                /status and persistence failed/,
            );
            assert.equal(
                record.retainedKnowledgePreflight.attempts[0].status,
                "unknown",
            );
            return true;
        },
    );
});

test("the retained status reader reads committed receipts without initializing maintenance", async () => {
    const calls = [];
    const read = await createRetainedKnowledgeReader(
        async () => ({
            TypedViewStore: class {
                constructor(root) {
                    calls.push(root);
                }
                getKnowledgeState(id) {
                    calls.push(id);
                    return { discovery: { receipts: [] } };
                }
            },
        }),
        "isolated-store",
    );
    assert.deepEqual(await read("corpus"), { discovery: { receipts: [] } });
    assert.deepEqual(calls, ["isolated-store", "corpus"]);
});

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
    assert.deepEqual(f.calls.answer[0], {
        corpusId: f.record.corpusId,
        question: reader.question,
        temporalContext: {
            referenceTime: reader.question_date,
            availabilityPolicy: "supplied-history",
        },
        includeDiagnostics: true,
    });
    assert.equal(f.calls.search.length, 0);
    for (const options of f.calls.wait)
        assert.deepEqual(options, { signal: f.controls.signal });
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
    assert.equal(f.record.evidenceSessionRecallAt20Matches, undefined);
});

test("product reader coverage uses actual answer diagnostics without an extra retrieval", async () => {
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
            answerPath: "indexed-fragments",
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
    assert.equal(f.calls.search.length, 0);
    assert.equal(f.record.answerPath, "indexed-fragments");
    assert.equal(f.record.evidenceSessionRecallAt20Matches, undefined);
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
    assert.deepEqual(
        scorecard.evidenceCoverage.evidenceSessionRecallAt20Matches,
        { measuredQuestions: 0, mean: null },
    );
});

test("knowledge readiness is frozen before the reader query is accessed", async () => {
    const f = fixture();
    const events = [];
    const checkpoint = {
        checkpointId: "knowledge",
        state: "pending",
        reasons: [],
    };
    f.service.createKnowledgeCheckpoint = async (request) => {
        events.push("create");
        assert.equal(request.producerComplete, true);
        assert.equal(request.timeoutMs, 600000);
        assert.equal(request.sourceIds.length, 2);
        assert.ok(!JSON.stringify(request).includes("SENTINEL"));
        return checkpoint;
    };
    f.service.waitForKnowledgeCheckpoint = async (request) => {
        events.push("wait");
        assert.equal(request.checkpointId, "knowledge");
        assert.equal(request.timeoutMs, 600000);
        return { ...checkpoint, state: "ready" };
    };
    const isolatedReader = {
        question_date: reader.question_date,
        get question() {
            events.push("query");
            assert.equal(f.record.knowledgeCheckpoint.state, "ready");
            return reader.question;
        },
    };
    await executeMemoryCase(
        f.service,
        construction,
        isolatedReader,
        reference,
        f.record,
        f.controls,
    );
    assert.deepEqual(events, ["create", "wait", "query"]);
    assert.equal(f.calls.answer[0].knowledgeCheckpointId, "knowledge");
    assert.equal(f.calls.answer[0].retrievalPolicy, "sourcesAndViews");
});

test("an explicit benchmark readiness allowance applies to execution and waiting", async () => {
    const f = fixture();
    f.controls.knowledgeTimeoutMs = 3600000;
    f.service.createKnowledgeCheckpoint = async (request) => {
        assert.equal(request.timeoutMs, 3600000);
        return { checkpointId: "knowledge", state: "pending", reasons: [] };
    };
    f.service.waitForKnowledgeCheckpoint = async (request) => {
        assert.equal(request.timeoutMs, 3600000);
        return { checkpointId: "knowledge", state: "ready", reasons: [] };
    };
    await executeMemoryCase(
        f.service,
        construction,
        reader,
        reference,
        f.record,
        f.controls,
    );
    assert.equal(f.record.knowledgeCheckpoint.state, "ready");
});

test("a thrown readiness wait retains durable failure status without answering", async () => {
    const f = fixture();
    f.service.createKnowledgeCheckpoint = async () => ({
        checkpointId: "knowledge",
        state: "pending",
        reasons: [],
    });
    f.service.waitForKnowledgeCheckpoint = async () => {
        throw new Error("controlled readiness wait timeout");
    };
    f.service.getKnowledgeCheckpoint = async () => ({
        checkpointId: "knowledge",
        state: "cancelled",
        reasons: ["Knowledge checkpoint deadline exceeded"],
    });
    await assert.rejects(
        executeMemoryCase(
            f.service,
            construction,
            reader,
            reference,
            f.record,
            f.controls,
        ),
        /controlled readiness wait timeout/,
    );
    assert.equal(f.record.knowledgeCheckpoint.state, "cancelled");
    assert.equal(f.calls.answer.length, 0);
});

test("partial derived knowledge is retained but cannot qualify as a ready benchmark arm", async () => {
    const f = fixture();
    f.service.createKnowledgeCheckpoint = async () => ({
        checkpointId: "knowledge",
        state: "pending",
        reasons: [],
    });
    f.service.waitForKnowledgeCheckpoint = async () => ({
        checkpointId: "knowledge",
        state: "partial",
        reasons: ["Discovery window limit"],
    });
    await assert.rejects(
        executeMemoryCase(
            f.service,
            construction,
            reader,
            reference,
            f.record,
            f.controls,
        ),
        /Knowledge is not ready: partial; Discovery window limit/,
    );
    assert.equal(f.record.knowledgeCheckpoint.state, "partial");
    assert.equal(f.calls.answer.length, 0);
    assert.equal(f.calls.judge.length, 0);
});

test("failed knowledge is not mislabeled as an unavailable model endpoint", async () => {
    const f = fixture();
    f.service.createKnowledgeCheckpoint = async () => ({
        checkpointId: "knowledge",
        state: "pending",
        reasons: [],
    });
    f.service.waitForKnowledgeCheckpoint = async () => ({
        checkpointId: "knowledge",
        state: "failed",
        reasons: ["The configured selection rubric rejected PRIVATE_EVIDENCE"],
    });
    await assert.rejects(
        executeMemoryCase(
            f.service,
            construction,
            reader,
            reference,
            f.record,
            f.controls,
        ),
        (error) => {
            const failure = benchmarkFailure(error);
            assert.equal(failure.category, "KNOWLEDGE_NOT_READY");
            assert.equal(failure.code, "EKNOWLEDGENOTREADY");
            assert.equal(failure.rawProviderMessageSuppressed, true);
            assert.ok(!JSON.stringify(failure).includes("PRIVATE_EVIDENCE"));
            return true;
        },
    );
    assert.equal(f.record.knowledgeCheckpoint.state, "failed");
    assert.equal(f.calls.answer.length, 0);
    assert.equal(f.calls.judge.length, 0);
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
        { usage: { input_tokens: 20, output_tokens: 3 } },
        {
            usage: {
                prompt_tokens: 5,
                completion_tokens: 0,
                input_tokens: 999,
                output_tokens: 999,
                total_tokens: 5,
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

    assert.equal(result.abstention.scored, 0);
    assert.equal(result.abstention.observedAccuracy, null);
    assert.equal(result.knownPromptTokens, 35);
    assert.equal(result.knownCompletionTokens, 5);
    assert.equal(result.knownTotalTokens, 40);
    assert.equal(result.dollarCost, null);
    assert.equal(result.answerLatencyMs.p95, 100);
});

test("the live benchmark entrypoint refuses inference without explicit authorization", async () => {
    const unused = path.join(os.tmpdir(), "longmemeval-unauthorized-input");
    await assert.rejects(
        main([
            "--product",
            unused,
            "--dataset",
            unused,
            "--judge-source",
            unused,
            "--output",
            unused,
        ]),
        {
            code: "ERR_ASSERTION",
            actual: undefined,
            expected: true,
            operator: "strictEqual",
        },
    );
});

test("the live benchmark entrypoint rejects authorized invocations with missing inputs", async () => {
    await assert.rejects(main(["--authorized-live-benchmark"]), {
        code: "ERR_ASSERTION",
    });
});
