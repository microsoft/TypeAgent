// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    benchmarkProgress,
    persistBenchmarkProgress,
    observedJudgeModel,
    benchmarkFailure,
    benchmarkInvocationAllowance,
    benchmarkStartupAllowance,
    closeBenchmarkService,
    acknowledgeStopAfterQuestion,
    selectConstructionCases,
    benchmarkQuestionIds,
    acceptBenchmarkEngine,
    archiveBenchmarkArtifacts,
    runBenchmarkQuestion,
    completedOutcome,
    createBenchmarkMemoryService,
    recordBenchmarkArm,
    main,
} from "./longmemeval-live.mjs";

test("startup-timeout archival records missing admission but never ignores missing benchmark evidence", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "benchmark-startup-archive-"),
    );
    try {
        const archive = path.join(root, "archive");
        await mkdir(archive);
        for (const name of [
            "benchmark-state.json",
            "progress.json",
            "scorecard.json",
            "hypotheses.json",
            "termination.json",
            "admission-verified.json",
        ])
            await writeFile(path.join(root, name), JSON.stringify({ name }));
        assert.deepEqual(
            await archiveBenchmarkArtifacts(root, archive, {
                phase: "startup",
            }),
            ["admitted.json"],
        );
        assert.deepEqual(
            JSON.parse(
                await readFile(
                    path.join(archive, "benchmark-state.json"),
                    "utf8",
                ),
            ),
            { name: "benchmark-state.json" },
        );
        await assert.rejects(
            archiveBenchmarkArtifacts(root, archive, {
                phase: "admitted-work",
            }),
            { code: "ENOENT" },
        );
        await rm(path.join(root, "admission-verified.json"));
        assert.deepEqual(
            await archiveBenchmarkArtifacts(root, archive, {
                phase: "startup",
            }),
            ["admitted.json", "admission-verified.json"],
        );
        await rm(path.join(root, "progress.json"));
        await assert.rejects(
            archiveBenchmarkArtifacts(root, archive, { phase: "startup" }),
            { code: "ENOENT" },
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("startup extensions are explicit and bounded independently of benchmark work", async () => {
    assert.equal(benchmarkStartupAllowance("2"), 120000);
    assert.equal(benchmarkStartupAllowance("10"), 600000);
    assert.equal(benchmarkStartupAllowance("1"), 60000);
    for (const value of ["0", "11", "unlimited", "1.5", "NaN", ""])
        assert.throws(
            () => benchmarkStartupAllowance(value),
            /Startup minutes/,
        );
    await assert.rejects(
        main(["--authorized-live-benchmark", "--startup-minutes", "11"]),
        /Startup minutes/,
    );
});

test("import continuation freezes the original fifty including old grades and failed questions", () => {
    const construction = Array.from({ length: 60 }, (_, i) => ({
        id: `q${i}`,
        sessions: [],
    }));
    const ids = construction.slice(0, 50).map((row) => row.id);
    const state = {
        attempts: [{ questionIds: ids }],
        cases: {
            q0: { status: "complete", autoeval_label: { label: true } },
            q1: { status: "failed", failurePhase: "import" },
        },
    };
    assert.deepEqual(benchmarkQuestionIds(construction, state, 50, true), ids);
    assert.throws(
        () => benchmarkQuestionIds(construction, state, 49, true),
        /Frozen question target changed/,
    );
    const attempt = { questionIds: ids, continueAfterImportFailure: true };
    const p = benchmarkProgress(construction, state, attempt);
    assert.equal(p.targetQuestions, 50);
    assert.equal(p.gradedQuestions, 1);
    assert.equal(p.skippedImportQuestions, 1);
    assert.equal(p.processedQuestions, 2);
    assert.equal(p.processedPercentage, 4);
    assert.equal(p.completionPercentage, 2);
    assert.equal(p.targetProcessed, false);
    for (const id of ids.slice(2))
        state.cases[id] = {
            status: "complete",
            autoeval_label: { label: false },
        };
    const final = benchmarkProgress(construction, state, attempt);
    assert.equal(final.targetProcessed, true);
    assert.equal(final.targetGraded, false);
    assert.equal(final.executionFailures, 1);
    assert.equal(final.gradedQuestions, 49);
    assert.equal(
        completedOutcome(construction, state, undefined, attempt),
        "QUESTION_TARGET_COMPLETED_WITH_IMPORT_FAILURES",
    );
});

test("harness migration requires exact reviewed prior engine and does not erase identity history", () => {
    const state = { engineHash: "old", compiledDigest: "unchanged" };
    for (const spec of [
        {},
        { resume: true },
        {
            resume: true,
            continueAfterImportFailure: true,
            previousEngineHash: "wrong",
        },
    ])
        assert.throws(
            () => acceptBenchmarkEngine(state, "new", spec),
            /explicit prior-engine authorization/,
        );
    acceptBenchmarkEngine(state, "new", {
        resume: true,
        continueAfterImportFailure: true,
        previousEngineHash: "old",
    });
    assert.equal(state.engineHash, "new");
    assert.equal(state.compiledDigest, "unchanged");
    assert.equal(state.harnessTransitions[0].previousEngineHash, "old");
    acceptBenchmarkEngine(state, "new", {});
    assert.equal(state.harnessTransitions.length, 1);
});

test("progress reports question X of the invocation target and pass percentage of graded answers only", () => {
    const construction = Array.from({ length: 60 }, (_, i) => ({
        id: `q${i}`,
        sessions: [{}, {}, {}],
    }));
    const attempt = {
        questionIds: construction.slice(0, 50).map((entry) => entry.id),
    };
    const state = { runId: "run", outcome: "IN_PROGRESS", cases: {} };
    const empty = benchmarkProgress(construction, state, attempt);
    assert.equal(empty.targetQuestions, 50);
    assert.equal(empty.scheduledQuestions, 60);
    assert.equal(empty.passPercentage, null);
    assert.equal(empty.currentQuestion, null);
    for (let i = 0; i < 10; i++)
        state.cases[`q${i}`] = {
            status: "complete",
            autoeval_label: { label: i < 7 },
        };
    state.currentQuestionId = "q10";
    state.cases.q10 = {
        status: "ingesting",
        operations: [{}, {}],
        inFlight: { sourceKey: "2:source" },
    };
    const progress = benchmarkProgress(construction, state, attempt);
    assert.equal(progress.gradedQuestions, 10);
    assert.equal(progress.passedQuestions, 7);
    assert.equal(progress.failedQuestions, 3);
    assert.equal(progress.passPercentage, 70);
    assert.equal(progress.completionPercentage, 20);
    assert.deepEqual(progress.currentQuestion, {
        id: "q10",
        number: 11,
        total: 50,
        status: "ingesting",
        historiesCompleted: 2,
        historiesTotal: 3,
        sourceKey: "2:source",
    });
    assert.equal(progress.targetGraded, false);
    assert.ok(Number.isFinite(Date.parse(progress.updatedAt)));
});

test("progress isolates resumed or selected invocation grades and distinguishes execution failures from wrong answers", () => {
    const construction = ["old", "a", "b"].map((id) => ({ id, sessions: [] }));
    const state = {
        runId: "resumed",
        currentQuestionId: "b",
        outcome: "FAILED_REAL_BENCHMARK",
        cases: {
            old: { status: "complete", autoeval_label: { label: true } },
            a: { status: "complete", autoeval_label: { label: false } },
            b: { status: "failed" },
        },
    };
    const attempt = { questionIds: ["a", "b"], supportedClose: "COMPLETE" };
    const progress = benchmarkProgress(construction, state, attempt);
    assert.equal(progress.currentQuestion.number, 2);
    assert.equal(progress.targetQuestions, 2);
    assert.equal(progress.gradedQuestions, 1);
    assert.equal(progress.failedQuestions, 1);
    assert.equal(progress.executionFailures, 1);
    assert.equal(progress.passPercentage, 0);
    assert.equal(progress.supportedClose, "COMPLETE");
    state.cases.b = { status: "complete", autoeval_label: { label: true } };
    state.outcome = "PARTIAL_QUESTION_LIMIT";
    const completed = benchmarkProgress(construction, state, attempt);
    assert.equal(completed.targetGraded, true);
    assert.equal(completed.passPercentage, 50);
    delete state.cases.b.autoeval_label;
    assert.throws(
        () => benchmarkProgress(construction, state, attempt),
        /Completed progress record lacks a grade/,
    );
});

test("persistence writes the ledger then lightweight progress using atomic file replacements", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "longmemeval-progress-"),
    );
    try {
        const construction = [{ id: "a", sessions: [] }];
        const state = { runId: "run", outcome: "IN_PROGRESS", cases: {} };
        const attempt = { questionIds: ["a"] };
        await persistBenchmarkProgress(directory, construction, state, attempt);
        assert.deepEqual(
            JSON.parse(
                await readFile(
                    path.join(directory, "benchmark-state.json"),
                    "utf8",
                ),
            ),
            state,
        );
        const progress = JSON.parse(
            await readFile(path.join(directory, "progress.json"), "utf8"),
        );
        assert.equal(progress.targetQuestions, 1);
        assert.equal(progress.passPercentage, null);
        assert.equal("providerRequests" in progress, false);
        await assert.rejects(
            persistBenchmarkProgress(
                path.join(directory, "missing"),
                construction,
                state,
                attempt,
            ),
            { code: "ENOENT" },
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
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

test("a failed import is persisted without an answer or grade, and the next question runs", async () => {
    const first = fixture();
    first.controls.continueAfterImportFailure = true;
    first.controls.waitForMemoryJob = async () => ({
        jobId: "failed-job",
        state: "failed",
        progress: { stage: "extracting-knowledge", completed: 4, total: 9 },
        error: "Response is not JSON:\n",
    });
    let persisted = 0;
    first.controls.persist = async () => {
        persisted++;
    };
    await runBenchmarkQuestion(
        first.service,
        construction,
        reader,
        reference,
        first.record,
        first.controls,
    );
    assert.equal(first.record.status, "failed");
    assert.equal(first.record.failurePhase, "import");
    assert.equal(
        first.record.importFailure.responseFailure,
        "empty-json-response",
    );
    assert.equal(first.record.importFailure.completed, 4);
    assert.equal(first.record.operations.length, 0);
    assert.equal(first.calls.answer.length, 0);
    assert.equal(first.calls.judge.length, 0);
    assert.ok(persisted > 1);
    const next = fixture();
    next.controls.continueAfterImportFailure = true;
    await runBenchmarkQuestion(
        next.service,
        construction,
        reader,
        reference,
        next.record,
        next.controls,
    );
    assert.equal(next.record.status, "complete");
    assert.equal(next.calls.judge.length, 1);
});

test("resuming reviews the saved failed import job without reimporting its partial corpus", async () => {
    const f = fixture();
    f.record.status = "failed";
    f.record.inFlight = { jobId: "saved-job", sourceKey: "failed-source" };
    f.record.error = { name: "AssertionError", code: "ERR_ASSERTION" };
    f.controls.continueAfterImportFailure = true;
    f.service.getJob = async (id) => {
        assert.equal(id, "saved-job");
        return { jobId: id, state: "failed", error: "Response is not JSON:\n" };
    };
    await runBenchmarkQuestion(
        f.service,
        construction,
        reader,
        reference,
        f.record,
        f.controls,
    );
    assert.equal(f.record.failurePhase, "import");
    assert.equal(f.record.error.code, "ERR_ASSERTION");
    assert.equal(f.calls.ingestion.length, 0);
    assert.equal(f.calls.answer.length, 0);
    f.service.getJob = async () => ({ state: "running" });
    await assert.rejects(
        runBenchmarkQuestion(
            f.service,
            construction,
            reader,
            reference,
            f.record,
            f.controls,
        ),
        /not terminally failed/,
    );
});

test("continuation does not swallow answer, persistence, cancellation or strict-mode failures", async () => {
    for (const mode of ["answer", "persist", "abort", "strict"]) {
        const f = fixture();
        f.controls.continueAfterImportFailure = mode !== "strict";
        if (mode === "answer")
            f.service.answer = async () => {
                throw new Error("answer failed");
            };
        if (mode === "persist")
            f.controls.persist = async () => {
                throw new Error("write failed");
            };
        if (mode === "abort")
            f.controls.signal = AbortSignal.abort(new Error("cancelled"));
        if (mode === "strict")
            f.controls.waitForMemoryJob = async () => ({ state: "failed" });
        await assert.rejects(
            runBenchmarkQuestion(
                f.service,
                construction,
                reader,
                reference,
                f.record,
                f.controls,
            ),
        );
        assert.equal(f.record.failurePhase, undefined);
    }
});

test("the production extractor retries empty and malformed JSON, but never fabricates success after exhaustion", async () => {
    const { createKnowledgeExtractor } = await import(
        "../../packages/knowledgeProcessor/dist/conversation/knowledge.js"
    );
    const valid = JSON.stringify({
        entities: [],
        actions: [],
        inverseActions: [],
        topics: [],
    });
    for (const malformed of ["", '{"entities": invalid}']) {
        let calls = 0;
        const extractor = createKnowledgeExtractor({
            complete: async () => ({
                success: true,
                data: ++calls === 1 ? malformed : valid,
            }),
        });
        const result = await extractor.extractWithRetry(
            "Ordinary source text",
            2,
        );
        assert.equal(result.success, true);
        assert.equal(calls, 2);
    }
    let calls = 0;
    const extractor = createKnowledgeExtractor({
        complete: async () => {
            calls++;
            return { success: true, data: "" };
        },
    });
    const result = await extractor.extractWithRetry("Ordinary source text", 2);
    assert.equal(result.success, false);
    assert.match(result.message, /^Response is not JSON:\s*$/);
    assert.ok(calls >= 2 && calls <= 3);
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

    assert.equal(result.abstention.scored, 0);
    assert.equal(result.abstention.observedAccuracy, null);
    assert.equal(result.knownTotalTokens, 12);
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
