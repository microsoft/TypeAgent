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
    historyBatchByteLimit,
    historyBatchRequests,
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
    createBenchmarkStateWriter,
    engineIdentity,
    recordBenchmarkAttemptFailure,
    runBenchmarkQuestion,
    completedOutcome,
    main,
} from "./longmemeval-live.mjs";

test("startup failures do not mutate a previous invocation's active question", () => {
    const state = {
        currentQuestionId: "previous",
        cases: {
            previous: { status: "interrupted" },
            current: { status: "ingesting" },
        },
    };
    const attempt = {};
    const error = new Error("Preflight failed");
    const signal = new AbortController().signal;
    recordBenchmarkAttemptFailure(state, attempt, error, signal, undefined);
    assert.equal(state.cases.previous.status, "interrupted");
    assert.equal(state.cases.current.status, "ingesting");
    assert.equal(state.outcome, "FAILED_REAL_BENCHMARK");
    assert.deepEqual(attempt.error, benchmarkFailure(error));
    recordBenchmarkAttemptFailure(state, attempt, error, signal, "current");
    assert.equal(state.cases.previous.status, "interrupted");
    assert.equal(state.cases.current.status, "failed");
});

test("state publications serialize captured snapshots and retain writer failures", async () => {
    const first = Promise.withResolvers();
    const state = { sequence: 1 };
    const writes = [];
    let active = 0;
    const persist = createBenchmarkStateWriter(
        "unit-state",
        state,
        async (_file, snapshot) => {
            assert.equal(++active, 1);
            writes.push(snapshot);
            if (snapshot.sequence === 1) await first.promise;
            active--;
        },
    );
    const one = persist();
    state.sequence = 2;
    const two = persist();
    state.sequence = 3;
    await Promise.resolve();
    assert.deepEqual(writes, [{ sequence: 1 }]);
    first.resolve();
    await Promise.all([one, two]);
    assert.deepEqual(writes, [{ sequence: 1 }, { sequence: 2 }]);
    let calls = 0;
    const failed = createBenchmarkStateWriter("unit-state", state, async () => {
        calls++;
        throw new Error("Writer failed");
    });
    await assert.rejects(failed(), /Writer failed/);
    await assert.rejects(failed(), /Writer failed/);
    assert.equal(calls, 1);
});

test("benchmark engine identity includes checkpoint observation implementation", async () => {
    const files = [];
    const before = await engineIdentity(async (file) => {
        files.push(file);
        return "original";
    });
    assert.ok(files.includes("knowledge-observer.mjs"));
    const after = await engineIdentity(async (file) =>
        file === "knowledge-observer.mjs" ? "changed" : "original",
    );
    assert.notEqual(before, after);
});

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
    assert.equal(
        state.arm.questionViewInputAdmission,
        "configured-complete-request-v1",
    );
    recordBenchmarkArm(state, capabilities, true);
    const legacy = structuredClone(state);
    delete legacy.arm.questionViewInputAdmission;
    assert.throws(
        () => recordBenchmarkArm(legacy, capabilities, true),
        /Product memory configuration changed/,
    );
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

for (const [field, key, lanes] of [
    [
        "wikiAssessmentConcurrency",
        "TYPEAGENT_MEMORY_WIKI_ASSESSMENT_CONCURRENCY",
        3,
    ],
    [
        "maintenanceBuildConcurrency",
        "TYPEAGENT_MEMORY_VIEW_BUILD_CONCURRENCY",
        2,
    ],
])
    test(`${field} lanes are frozen and changed lanes cannot resume`, () => {
        const prior = process.env[key];
        const capabilities = { features: { sourceSynopses: true } };
        try {
            delete process.env[key];
            const serial = {};
            recordBenchmarkArm(serial, capabilities, false);
            assert.equal(serial.arm[field], 1);
            process.env[key] = String(lanes);
            assert.throws(
                () => recordBenchmarkArm(serial, capabilities, true),
                /Product memory configuration changed/,
            );
            const parallel = {};
            recordBenchmarkArm(parallel, capabilities, false);
            assert.equal(parallel.arm[field], lanes);
            recordBenchmarkArm(parallel, capabilities, true);
            process.env[key] = "4";
            assert.throws(
                () => recordBenchmarkArm(parallel, capabilities, true),
                /Product memory configuration changed/,
            );
            delete parallel.arm[field];
            process.env[key] = String(lanes);
            assert.throws(
                () => recordBenchmarkArm(parallel, capabilities, true),
                /Product memory configuration changed/,
            );
        } finally {
            if (prior === undefined) delete process.env[key];
            else process.env[key] = prior;
        }
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
    for (const value of ["0", "-1", "1.5", "361", "NaN"]) {
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
    assert.equal(benchmarkInvocationAllowance("360"), 365 * 60000);
    for (const value of ["Infinity", "", "null", "0", "-1", "361"]) {
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

test("publication failures still close the service and restore the observer", async () => {
    for (const failAt of [1, 2]) {
        const state = { outcome: "PARTIAL_BOUNDED_WORK" };
        const attempt = {};
        const failure = new Error("Controlled publication failure");
        let writes = 0;
        let closed = false;
        let restored = false;
        const persist = createBenchmarkStateWriter(
            "unit-state",
            state,
            async () => {
                if (++writes === failAt) throw failure;
            },
        );
        await assert.rejects(
            closeBenchmarkService(
                {
                    close: async () => {
                        closed = true;
                    },
                },
                state,
                attempt,
                persist,
                (error) => ({ name: error.name }),
                () => {
                    restored = true;
                },
            ),
            (error) => error === failure,
        );
        assert.equal(closed, true);
        assert.equal(restored, true);
        assert.equal(attempt.supportedClose, "COMPLETE");
    }
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

test("production scopes release on successful ingestion, failure and cancellation", async () => {
    for (const outcome of ["success", "failure", "cancelled"]) {
        const f = fixture();
        const controller = new AbortController();
        f.controls.signal = controller.signal;
        if (outcome === "cancelled")
            f.controls.persist = async () =>
                controller.abort(new Error("Producer cancelled"));
        if (outcome === "failure")
            f.controls.waitForMemoryJob = async () => {
                throw new Error("Producer failed");
            };
        const pending = executeMemoryCase(
            f.service,
            construction,
            reader,
            reference,
            f.record,
            f.controls,
        );
        if (outcome === "success") await pending;
        else await assert.rejects(pending, /Producer/);
        assert.deepEqual(f.calls.topicScopes, [
            { corpusId: "corpus", state: "held" },
            { corpusId: "corpus", state: "released" },
        ]);
        assert.equal(f.record.topicMaintenanceCoalesced, true);
    }
});

function fixture() {
    const sources = [];
    const calls = {
        topicScopes: [],
        ingestion: [],
        batches: [],
        search: [],
        answer: [],
        wait: [],
        judge: [],
    };
    let batch;
    const service = {
        deferTopicMaintenance(corpusId) {
            calls.topicScopes.push({ corpusId, state: "held" });
            return () =>
                calls.topicScopes.push({ corpusId, state: "released" });
        },
        listSources: async () => sources,
        ingestDocument: async ({ source }) => {
            calls.ingestion.push(source);
            const id = source.sourceId ?? `source-${sources.length}`;
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
        startBatchImport: async (request) => {
            calls.batches.push(structuredClone(request));
            if (batch) return structuredClone(batch);
            batch = {
                batchId: "durable-batch",
                corpusId: request.corpusId,
                state: "running",
                members: request.documents.map((_document, index) => ({
                    memberId: String(index),
                    clientKey: request.documentKeys[index],
                    state: "pending",
                    warnings: [],
                })),
            };
            for (const [index, document] of request.documents.entries()) {
                const result = await service.ingestDocument(document);
                const job = await controls.waitForMemoryJob(
                    service,
                    result.jobId,
                    { signal: controls.signal },
                );
                Object.assign(batch.members[index], result, {
                    state: job.state === "complete" ? "complete" : "failed",
                });
            }
            batch.state = batch.members.every(
                (member) => member.state === "complete",
            )
                ? "complete"
                : "failed";
            return structuredClone(batch);
        },
        getBatchImport: async () => structuredClone(batch),
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

async function flushRunner() {
    for (let index = 0; index < 100; index++) await Promise.resolve();
}

function controlledBatchFixture() {
    const f = fixture();
    let batch;
    let request;
    let retries = 0;
    let cancellations = 0;
    f.service.startBatchImport = async (input) => {
        f.calls.batches.push(structuredClone(input));
        if (request) assert.deepEqual(input, request);
        else request = structuredClone(input);
        batch ??= {
            batchId: "controlled-batch",
            corpusId: input.corpusId,
            state: "running",
            members: input.documents.map((_document, index) => ({
                clientKey: input.documentKeys[index],
                memberId: String(index),
                state: "pending",
                warnings: [],
            })),
        };
        return structuredClone(batch);
    };
    f.service.getBatchImport = async () => structuredClone(batch);
    f.service.retryBatchImport = async (batchId) => {
        assert.equal(batchId, batch.batchId);
        retries++;
        batch.state = "running";
        for (const member of batch.members)
            if (["failed", "cancelled", "interrupted"].includes(member.state))
                member.state = "pending";
        return structuredClone(batch);
    };
    f.service.cancelBatchImport = async (batchId) => {
        assert.equal(batchId, batch.batchId);
        cancellations++;
        for (const member of batch.members)
            if (member.state === "pending") member.state = "cancelled";
        batch.state = "cancelled";
        return structuredClone(batch);
    };
    return {
        ...f,
        retries: () => retries,
        cancellations: () => cancellations,
        batch: () => batch,
        async complete(index) {
            Object.assign(
                batch.members[index],
                await f.service.ingestDocument(request.documents[index]),
                { state: "complete" },
            );
        },
        run: () =>
            executeMemoryCase(
                f.service,
                construction,
                reader,
                reference,
                f.record,
                f.controls,
            ),
    };
}

function groupedBatchFixture(count = 53) {
    const f = fixture();
    const input = {
        ...construction,
        sessions: Array.from({ length: count }, (_unused, position) => ({
            ...construction.sessions[position % 2],
            position,
        })),
    };
    const batches = [];
    const requests = [];
    let reads = 0;
    let retries = 0;
    let cancellations = 0;
    f.service.startBatchImport = async (request) => {
        assert.ok(request.documents.length <= 50);
        assert.ok(
            Buffer.byteLength(JSON.stringify(request)) <= historyBatchByteLimit,
        );
        f.calls.batches.push(structuredClone(request));
        let index = requests.findIndex(
            (entry) => entry.idempotencyKey === request.idempotencyKey,
        );
        if (index >= 0) assert.deepEqual(request, requests[index]);
        else {
            assert.ok(
                batches.filter((batch) => batch.state === "running").length < 4,
            );
            index = requests.push(structuredClone(request)) - 1;
            batches.push({
                batchId: `group-${index}`,
                corpusId: request.corpusId,
                state: "running",
                members: request.documents.map((_document, member) => ({
                    memberId: String(member),
                    clientKey: request.documentKeys[member],
                    state: "pending",
                    warnings: [],
                })),
            });
        }
        return structuredClone(batches[index]);
    };
    f.service.getBatchImport = async (batchId) => {
        reads++;
        return structuredClone(
            batches.find((batch) => batch.batchId === batchId),
        );
    };
    f.service.retryBatchImport = async (batchId) => {
        retries++;
        const batch = batches.find((entry) => entry.batchId === batchId);
        for (const member of batch.members)
            if (member.state !== "complete") member.state = "pending";
        batch.state = "running";
        return structuredClone(batch);
    };
    f.service.cancelBatchImport = async (batchId) => {
        cancellations++;
        const batch = batches.find((entry) => entry.batchId === batchId);
        for (const member of batch.members)
            if (member.state !== "complete") member.state = "cancelled";
        batch.state = "cancelled";
        return structuredClone(batch);
    };
    return {
        ...f,
        input,
        batches,
        requests,
        reads: () => reads,
        retries: () => retries,
        cancellations: () => cancellations,
        async finish(index, failedMember) {
            const batch = batches[index];
            for (const [memberIndex, member] of batch.members.entries()) {
                if (member.state === "complete") continue;
                if (memberIndex === failedMember) {
                    Object.assign(member, {
                        state: "failed",
                        reason: "group member failed",
                    });
                    continue;
                }
                Object.assign(
                    member,
                    await f.service.ingestDocument(
                        requests[index].documents[memberIndex],
                    ),
                    { state: "complete" },
                );
            }
            batch.state = batch.members.every(
                (member) => member.state === "complete",
            )
                ? "complete"
                : "partial";
        },
        run: () =>
            executeMemoryCase(
                f.service,
                input,
                reader,
                reference,
                f.record,
                f.controls,
            ),
    };
}

test("more than fifty original sessions are admitted as bounded durable groups before waiting", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = groupedBatchFixture();
    let checkpoints = 0;
    f.service.createKnowledgeCheckpoint = async () => {
        checkpoints++;
        assert.equal(f.record.operations.length, 53);
        assert.ok(f.batches.every((batch) => batch.state === "complete"));
        return { checkpointId: "knowledge", state: "ready", reasons: [] };
    };
    f.service.waitForKnowledgeCheckpoint = async () =>
        f.record.knowledgeCheckpoint;
    const running = f.run();
    await flushRunner();
    assert.deepEqual(
        f.requests.map((request) => request.documents.length),
        [50, 3],
    );
    assert.equal(f.reads(), 0);
    assert.equal(checkpoints, 0);
    await f.finish(1);
    t.mock.timers.tick(250);
    await flushRunner();
    assert.equal(f.record.operations.length, 0);
    assert.equal(checkpoints, 0);
    await f.finish(0);
    t.mock.timers.tick(250);
    await running;
    assert.equal(checkpoints, 1);
    assert.equal(f.calls.ingestion.length, 53);
    assert.equal(Object.keys(f.record.mappings).length, 53);
    assert.equal(
        new Set(f.requests.map((request) => request.idempotencyKey)).size,
        2,
    );
    const originals = f.input.sessions.map((session) =>
        sessionSource("case", session),
    );
    for (const [index, document] of f.requests
        .flatMap((request) => request.documents)
        .entries()) {
        const { sourceId, ...source } = document.source;
        assert.ok(sourceId);
        assert.deepEqual(source, originals[index].source);
    }
});

test("partial grouped imports preserve later committed sources and retry only missing members", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = groupedBatchFixture();
    const first = assert.rejects(
        f.run(),
        /batch did not complete: partial.*group member failed/,
    );
    await flushRunner();
    await f.finish(0, 1);
    await f.finish(1);
    t.mock.timers.tick(250);
    await first;
    assert.equal(f.record.operations.length, 1);
    assert.equal(f.calls.ingestion.length, 52);
    assert.equal(
        f.record.batchImport.batches[0].members[1].reason,
        "group member failed",
    );
    const second = f.run();
    await flushRunner();
    assert.equal(f.retries(), 1);
    await f.finish(0);
    t.mock.timers.tick(250);
    await second;
    assert.equal(f.calls.ingestion.length, 53);
    assert.equal(f.record.operations.length, 53);
    assert.equal(f.calls.batches.length, 4);
    assert.deepEqual(f.calls.batches.slice(0, 2), f.calls.batches.slice(2));
});

test("cancellation drains every admitted group before resumable retries", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = groupedBatchFixture();
    const controller = new AbortController();
    f.controls.signal = controller.signal;
    const reason = new Error("cancel all original histories");
    const first = assert.rejects(f.run(), (error) => error === reason);
    await flushRunner();
    controller.abort(reason);
    await first;
    assert.equal(f.cancellations(), 2);
    assert.equal(f.record.batchImport.state, "cancelled");
    assert.equal(f.record.operations.length, 0);
    f.controls.signal = new AbortController().signal;
    const second = f.run();
    await flushRunner();
    assert.equal(f.retries(), 2);
    await f.finish(0);
    await f.finish(1);
    t.mock.timers.tick(250);
    await second;
    assert.equal(f.calls.ingestion.length, 53);
});

test("queued groups beyond service concurrency are admitted while other groups remain active", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = groupedBatchFixture(201);
    const running = f.run();
    await flushRunner();
    assert.equal(f.requests.length, 4);
    await f.finish(0);
    t.mock.timers.tick(250);
    await flushRunner();
    assert.equal(f.requests.length, 5);
    assert.equal(
        f.batches.filter((batch) => batch.state === "running").length,
        4,
    );
    for (let index = 1; index < 5; index++) await f.finish(index);
    t.mock.timers.tick(250);
    await running;
    assert.equal(f.calls.ingestion.length, 201);
});

test("group byte limits use exact UTF-8 request bytes and split without changing source documents", () => {
    const first = sessionSource("case", construction.sessions[0]);
    const second = sessionSource("case", construction.sessions[1]);
    const overhead = Buffer.byteLength(
        JSON.stringify(historyBatchRequests("corpus", [first]).requests[0]),
    );
    const padding = historyBatchByteLimit - overhead;
    first.source.text += "x".repeat(padding);
    const exact = historyBatchRequests("corpus", [first]).requests;
    assert.equal(exact.length, 1);
    assert.equal(
        Buffer.byteLength(JSON.stringify(exact[0])),
        historyBatchByteLimit,
    );
    const split = historyBatchRequests("corpus", [first, second]).requests;
    assert.deepEqual(
        split.map((request) => request.documents.length),
        [1, 1],
    );
    assert.equal(split[0].documents[0].source.text, first.source.text);
    assert.ok(
        split.every(
            (request) =>
                Buffer.byteLength(JSON.stringify(request)) <=
                historyBatchByteLimit,
        ),
    );
    first.source.text += "é";
    assert.throws(
        () => historyBatchRequests("corpus", [first]),
        /History session .* exceeds .*8 MB/,
    );
});

test("an individually oversized history is rejected before any batch is admitted", async () => {
    const f = fixture();
    const input = {
        ...construction,
        sessions: [
            construction.sessions[0],
            {
                ...construction.sessions[1],
                turns: [
                    {
                        role: "user",
                        content: "x".repeat(historyBatchByteLimit),
                    },
                ],
            },
        ],
    };
    await assert.rejects(
        executeMemoryCase(
            f.service,
            input,
            reader,
            reference,
            f.record,
            f.controls,
        ),
        /History session .* exceeds .*8 MB/,
    );
    assert.equal(f.calls.batches.length, 0);
    assert.equal(f.calls.ingestion.length, 0);
});

test("valid histories larger than eight megabytes ingest every original source through separate groups", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = groupedBatchFixture(2);
    f.input.sessions = f.input.sessions.map((session, index) => ({
        ...session,
        turns: [
            {
                role: index ? "assistant" : "user",
                content: "é".repeat(2200000),
            },
        ],
    }));
    const running = f.run();
    await flushRunner();
    assert.deepEqual(
        f.requests.map((request) => request.documents.length),
        [1, 1],
    );
    assert.equal(f.reads(), 0);
    await f.finish(0);
    await f.finish(1);
    t.mock.timers.tick(250);
    await running;
    assert.equal(f.calls.ingestion.length, 2);
    for (const [index, operation] of f.record.operations.entries())
        assert.equal(
            operation.fixtureSha256,
            sessionSource("case", f.input.sessions[index]).sha256,
        );
});

test("all original histories share one durable batch before knowledge maintenance starts", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = controlledBatchFixture();
    let checkpoints = 0;
    f.service.createKnowledgeCheckpoint = async () => {
        assert.equal(f.batch().state, "complete");
        assert.equal(f.record.operations.length, construction.sessions.length);
        checkpoints++;
        return { checkpointId: "knowledge", state: "ready", reasons: [] };
    };
    f.service.waitForKnowledgeCheckpoint = async () =>
        f.record.knowledgeCheckpoint;
    const running = f.run();
    await flushRunner();
    assert.equal(f.calls.batches.length, 1);
    assert.equal(checkpoints, 0);
    await f.complete(0);
    t.mock.timers.tick(250);
    await flushRunner();
    assert.equal(f.record.operations.length, 1);
    assert.equal(checkpoints, 0);
    await f.complete(1);
    f.batch().state = "complete";
    t.mock.timers.tick(250);
    await running;
    assert.equal(checkpoints, 1);
    assert.equal(f.calls.ingestion.length, 2);
    for (const [index, document] of f.calls.batches[0].documents.entries()) {
        const { sourceId, ...source } = document.source;
        assert.ok(sourceId);
        assert.deepEqual(
            source,
            sessionSource("case", construction.sessions[index]).source,
        );
    }
});

test("partial batch errors survive and a later attempt retries only missing history", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = controlledBatchFixture();
    const first = assert.rejects(
        f.run(),
        /batch did not complete: partial.*member failure/,
    );
    await flushRunner();
    await f.complete(0);
    Object.assign(f.batch().members[1], {
        state: "failed",
        reason: "member failure",
    });
    f.batch().state = "partial";
    t.mock.timers.tick(250);
    await first;
    assert.equal(f.record.operations.length, 1);
    assert.equal(f.record.batchImport.members[1].reason, "member failure");
    assert.equal(f.calls.answer.length, 0);
    const second = f.run();
    await flushRunner();
    assert.equal(f.retries(), 1);
    assert.equal(f.calls.ingestion.length, 1);
    await f.complete(1);
    f.batch().state = "complete";
    t.mock.timers.tick(250);
    await second;
    assert.equal(f.calls.ingestion.length, 2);
    assert.equal(f.record.operations.length, 2);
    assert.deepEqual(f.calls.batches[0], f.calls.batches[1]);
});

test("batch cancellation is drained and retained before an idempotent retry", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = controlledBatchFixture();
    const controller = new AbortController();
    f.controls.signal = controller.signal;
    const reason = new Error("owned attempt cancelled");
    const first = assert.rejects(f.run(), (error) => error === reason);
    await flushRunner();
    await f.complete(0);
    controller.abort(reason);
    await first;
    assert.equal(f.cancellations(), 1);
    assert.equal(f.record.batchImport.state, "cancelled");
    assert.equal(f.record.operations.length, 1);
    assert.equal(f.calls.answer.length, 0);
    f.controls.signal = new AbortController().signal;
    const second = f.run();
    await flushRunner();
    assert.equal(f.retries(), 1);
    await f.complete(1);
    f.batch().state = "complete";
    t.mock.timers.tick(250);
    await second;
    assert.equal(f.calls.ingestion.length, 2);
});

test("an admitted batch with no published receipt resumes all unacknowledged sources without duplication", async () => {
    const f = fixture();
    let intent;
    f.controls.persist = async () => {
        if (!f.record.batchImport.batchId) intent = structuredClone(f.record);
        else throw new Error("publication interrupted");
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
        /publication interrupted/,
    );
    for (const key of Object.keys(f.record)) delete f.record[key];
    Object.assign(f.record, intent);
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
    assert.equal(f.record.operations.length, 2);
    assert.equal(f.calls.batches.length, 2);
    assert.deepEqual(f.calls.batches[0], f.calls.batches[1]);
});

test("missing durable batch support never falls back to independent admissions", async () => {
    const f = fixture();
    delete f.service.startBatchImport;
    await assert.rejects(
        executeMemoryCase(
            f.service,
            construction,
            reader,
            reference,
            f.record,
            f.controls,
        ),
        /Durable batch imports are unavailable/,
    );
    assert.equal(f.calls.ingestion.length, 0);
});

test("a failed required question blocks its case while slow independent topics still run", async () => {
    const f = fixture();
    const topic = Promise.withResolvers();
    const failure = {
        family: "questions",
        state: "failed",
        reasons: ["QUESTION_SELECTION_FAILED"],
        jobIds: ["question-job"],
        viewIds: ["question-view"],
    };
    const checkpoint = {
        checkpointId: "knowledge",
        state: "running",
        families: ["questions", "topics"],
        reasons: [],
        requiredFailures: [failure],
    };
    f.service.createKnowledgeCheckpoint = async () =>
        structuredClone(checkpoint);
    f.service.getKnowledgeCheckpoint = async () => structuredClone(checkpoint);
    f.service.waitForKnowledgeCheckpoint = () => topic.promise;
    await assert.rejects(
        executeMemoryCase(
            f.service,
            construction,
            reader,
            reference,
            f.record,
            f.controls,
        ),
        (error) =>
            error.code === "EKNOWLEDGENOTREADY" &&
            error.message.includes("QUESTION_SELECTION_FAILED"),
    );
    assert.equal(f.record.knowledgeWait.outcome, "failed");
    assert.deepEqual(f.record.knowledgeCheckpoint.requiredFailures, [failure]);
    assert.equal(f.calls.answer.length, 0);
    assert.equal(f.calls.judge.length, 0);
    assert.equal(f.record.knowledgeObservation.active, false);
    topic.resolve({ ...checkpoint, state: "failed" });
});

test("a failed view construction is logged and retained while a later question is answered and judged", async () => {
    const blocked = fixture();
    const healthy = fixture();
    const checkpoint = {
        checkpointId: "blocked-checkpoint",
        state: "failed",
        reasons: [],
        requiredFailures: [
            {
                family: "wiki",
                state: "failed",
                reasons: ["Controlled view construction failure"],
                jobIds: ["blocked-job"],
                viewIds: ["blocked-view"],
            },
        ],
    };
    blocked.service.createKnowledgeCheckpoint = async () => checkpoint;
    blocked.service.waitForKnowledgeCheckpoint = async () => checkpoint;
    const state = {
        cases: { blocked: blocked.record, healthy: healthy.record },
    };
    const attempt = {};
    const events = [];
    const writes = [];
    const controls = {
        signal: new AbortController().signal,
        stage: () => "knowledge",
        persist: async () => writes.push(structuredClone(state)),
        log: (event) => events.push(event),
    };
    for (const [id, f] of [
        ["blocked", blocked],
        ["healthy", healthy],
    ]) {
        await runBenchmarkQuestion(
            state,
            attempt,
            id,
            () =>
                executeMemoryCase(
                    f.service,
                    construction,
                    reader,
                    reference,
                    f.record,
                    f.controls,
                ),
            controls,
        );
    }
    assert.equal(blocked.record.status, "failed");
    assert.equal(blocked.record.failureStage, "knowledge");
    assert.equal(blocked.calls.answer.length, 0);
    assert.equal(blocked.calls.judge.length, 0);
    assert.equal(healthy.record.status, "complete");
    assert.equal(healthy.calls.answer.length, 1);
    assert.equal(healthy.calls.judge.length, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].cases.blocked.status, "failed");
    assert.equal(events.length, 1);
    assert.equal(events[0].questionId, "blocked");
    assert.equal(events[0].error.category, "KNOWLEDGE_NOT_READY");
    assert.deepEqual(events[0].requiredViewFamilies, ["wiki"]);
    assert.deepEqual(attempt.caseFailures, events);
    await runBenchmarkQuestion(
        state,
        attempt,
        "blocked",
        async () => {
            assert.fail("Failed questions must not be retried");
        },
        controls,
    );
});

test("answer, judge and local readiness timeout failures do not abort later questions", async () => {
    for (const stage of ["answer", "judge", "knowledge"]) {
        const state = {
            cases: { bad: { status: stage }, good: { status: "ingesting" } },
        };
        const events = [];
        const failure =
            stage === "knowledge"
                ? new DOMException("Local readiness limit", "TimeoutError")
                : new Error("Controlled case failure");
        const controls = {
            signal: new AbortController().signal,
            stage: () => stage,
            persist: async () => {},
            log: (event) => events.push(event),
        };
        await runBenchmarkQuestion(
            state,
            {},
            "bad",
            async () => {
                throw failure;
            },
            controls,
        );
        await runBenchmarkQuestion(
            state,
            {},
            "good",
            async () => {
                state.cases.good.status = "complete";
            },
            controls,
        );
        assert.equal(state.cases.bad.status, "failed");
        assert.equal(state.cases.bad.failureStage, stage);
        assert.equal(state.cases.good.status, "complete");
        assert.equal(events.length, 1);
    }
});

test("global cancellation, replay/cleanup guards and filesystem failures remain fatal", async () => {
    for (const kind of [
        "cancel",
        "EREPLAYMISS",
        "EREPLAYNONDETERMINISTIC",
        "EBENCHMARKCLEANUP",
        "filesystem",
    ]) {
        const controller = new AbortController();
        const failure = new Error("Controlled fatal failure");
        if (kind === "cancel") controller.abort(failure);
        else if (kind === "filesystem") failure.syscall = "write";
        else failure.code = kind;
        const state = { cases: { current: { status: "ingesting" } } };
        await assert.rejects(
            runBenchmarkQuestion(
                state,
                {},
                "current",
                async () => {
                    throw failure;
                },
                {
                    signal: controller.signal,
                    stage: () => "ingestion",
                    persist: async () =>
                        assert.fail("Fatal errors must not be swallowed"),
                    log: () =>
                        assert.fail(
                            "Fatal errors must reach the attempt handler",
                        ),
                },
            ),
            (error) => error === failure,
        );
        assert.equal(state.cases.current.status, "ingesting");
    }
});

test("failure persistence errors stop continuation rather than losing a failed case", async () => {
    const writerFailure = new Error("Controlled writer failure");
    const state = { cases: { current: { status: "answering" } } };
    const attempt = {};
    await assert.rejects(
        runBenchmarkQuestion(
            state,
            attempt,
            "current",
            async () => {
                throw new Error("Controlled answer failure");
            },
            {
                signal: new AbortController().signal,
                stage: () => "answer",
                persist: async () => {
                    throw writerFailure;
                },
                log: () =>
                    assert.fail(
                        "Must not report durable failure before it is saved",
                    ),
            },
        ),
        (error) => error === writerFailure,
    );
    assert.equal(attempt.caseFailures.length, 1);
});

test("completed selections with failures are distinct from success and interrupted work", () => {
    const cases = [{ id: "one" }, { id: "two" }];
    const state = {
        cases: { one: { status: "failed" }, two: { status: "complete" } },
    };
    assert.equal(
        completedOutcome(cases, state, ["one", "two"]),
        "DIAGNOSTIC_SELECTION_COMPLETED_WITH_FAILURES",
    );
    assert.equal(
        completedOutcome(cases, state),
        "FULL_500_COMPLETED_WITH_FAILURES",
    );
    state.cases.one.status = "complete";
    assert.equal(
        completedOutcome(cases, state, ["one", "two"]),
        "DIAGNOSTIC_SELECTION_COMPLETED",
    );
    state.cases.one.status = "interrupted";
    assert.equal(
        completedOutcome(cases, state, ["one", "two"]),
        "PARTIAL_QUESTION_LIMIT",
    );
});

test("a later wait timeout retains the original durable required-family cause", async () => {
    const f = fixture();
    const checkpoint = {
        checkpointId: "knowledge",
        state: "running",
        families: ["questions", "topics"],
        reasons: [],
    };
    const failure = {
        family: "questions",
        state: "failed",
        reasons: ["QUESTION_AUDIT_FAILED"],
        jobIds: ["question-job"],
        viewIds: [],
    };
    let reads = 0;
    f.service.createKnowledgeCheckpoint = async () => checkpoint;
    f.service.getKnowledgeCheckpoint = async () => ({
        ...checkpoint,
        ...(reads++ ? { requiredFailures: [failure] } : {}),
    });
    f.service.waitForKnowledgeCheckpoint = async () => {
        throw new Error(
            "Timed out waiting for knowledge checkpoint; work continues",
        );
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
        (error) => {
            assert.match(error.message, /Timed out waiting/);
            assert.equal(error.cause.code, "EKNOWLEDGENOTREADY");
            assert.deepEqual(error.cause.cause, [failure]);
            return true;
        },
    );
    assert.equal(f.record.knowledgeWait.outcome, "timed-out");
    assert.deepEqual(f.record.knowledgeCheckpoint.requiredFailures, [failure]);
    assert.equal(f.calls.answer.length, 0);
});

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

test("retained preflight bounds reads while a slow first corpus does not block later publications", async () => {
    const first = Promise.withResolvers();
    const records = Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [
            String(index),
            { corpusId: String(index) },
        ]),
    );
    let active = 0;
    let peak = 0;
    const published = [];
    const pending = preflightRetainedKnowledge(
        {
            async getKnowledgeStatus(id) {
                peak = Math.max(peak, ++active);
                try {
                    if (id === "0") await first.promise;
                    else await new Promise((resolve) => setImmediate(resolve));
                    return {
                        discovery: {
                            receipts: id === "1" ? [{ state: "running" }] : [],
                        },
                    };
                } finally {
                    active--;
                }
            },
        },
        records,
        {
            signal: new AbortController().signal,
            failure: benchmarkFailure,
            persist: async () => {
                published.push(structuredClone(records));
            },
        },
    );
    try {
        for (let index = 0; index < 60; index++)
            await new Promise((resolve) => setImmediate(resolve));
        assert.equal(peak, 2);
        assert.equal(active, 1);
        assert.equal(published.length, 39);
        const interrupted = records["1"].retainedKnowledgePreflight.attempts[0];
        assert.equal(interrupted.status, "blocked");
        assert.deepEqual(interrupted.interruptedReceipts, [
            { state: "running" },
        ]);
    } finally {
        first.resolve();
        await pending;
    }
    assert.equal(published.length, 40);
});

test("a terminal observation is authoritatively refreshed before required readiness is accepted", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    const f = fixture();
    const waited = Promise.withResolvers();
    let checkpoint = {
        checkpointId: "observed",
        state: "ready",
        reasons: [],
        families: ["wiki"],
    };
    f.service.createKnowledgeCheckpoint = async () =>
        structuredClone(checkpoint);
    f.service.getKnowledgeCheckpoint = async () => structuredClone(checkpoint);
    f.service.waitForKnowledgeCheckpoint = () => waited.promise;
    const running = executeMemoryCase(
        f.service,
        construction,
        reader,
        reference,
        f.record,
        f.controls,
    );
    const checked = assert.rejects(running, { name: "KnowledgeNotReadyError" });
    for (let index = 0; index < 60; index++) await Promise.resolve();
    assert.equal(f.record.knowledgeObservation.durableState, "ready");
    const old = structuredClone(checkpoint);
    checkpoint = {
        ...checkpoint,
        state: "superseded",
        reasons: ["Source changed"],
    };
    waited.resolve(old);
    await checked;
    assert.equal(f.record.knowledgeCheckpoint.state, "superseded");
    assert.equal(
        f.record.knowledgeObservation.requiredCheckpointSatisfied,
        false,
    );
    assert.equal(f.calls.answer.length, 0);
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
            retrievedSourceIds: [f.calls.ingestion[1].sourceId],
            messageSourceIds: [],
            knowledgeSourceIds: [f.calls.ingestion[1].sourceId],
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
    assert.equal(f.record.batchImport.state, "failed");
    assert.equal(f.record.batchImport.members[0].state, "failed");
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
