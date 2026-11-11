// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import {
    assertCheckpoint,
    checkpointExpectationHash,
    snapshotCompiledCheckpoint,
    writeJson,
} from "./harness.mjs";
import { alive, supervise } from "./watchdog.mjs";
import { withLiveRunLock } from "./live-resume.mjs";
import {
    liveDependencyCheckpoint,
    observedRoles,
    observeProvider,
} from "./live-stages.mjs";
import { safeFailure } from "./live-qualification.mjs";
import { prepareLongMemEval, publicPins } from "./quality-adapters.mjs";
import {
    benchmarkScorecard,
    digest,
    executeMemoryCase,
    judgePrompt,
    officialJudgeTemplates,
    preflightRetainedKnowledge,
} from "./longmemeval-runner.mjs";
import {
    finishIndexingCase,
    measureIndexingCase,
    startIndexingCase,
} from "./longmemeval-indexing-lifecycle.mjs";
import {
    assertPilotProviderConfiguration,
    indexingTreatments,
} from "./longmemeval-indexing-contract.mjs";

const datasetSha256 =
    "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442";
const datasetRevision = "98d7416c24c778c2fee6e6f3006e7a073259d48f";
const cleanupReserveMs = 5 * 60 * 1000;
const maximumWorkMinutes = 360;
const workAllowanceMs = maximumWorkMinutes * 60000 + cleanupReserveMs;
const seed = "typeagent-longmemeval-full-2026-10-20";
const productFactory =
    "packages\\agentServer\\server\\dist\\durableMemoryService.js";

export async function createBenchmarkMemoryService(
    load,
    rootDirectory,
    onReceipt,
) {
    const { createDurableMemoryService } = await load(productFactory);
    if (onReceipt) return createDurableMemoryService(rootDirectory, onReceipt);
    return createDurableMemoryService(rootDirectory);
}

export async function createRetainedKnowledgeReader(load, rootDirectory) {
    const { TypedViewStore } = await load(
        "packages\\memory\\service\\dist\\viewStore.js",
    );
    const store = new TypedViewStore(rootDirectory);
    return (corpusId) => store.getKnowledgeState(corpusId);
}

export function recordBenchmarkArm(state, capabilities, resume, options = {}) {
    const arm = {
        name: "TypeAgent production document-backed conversation memory",
        productFactory,
        viewModelEndpointHash: digest(
            process.env.TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT?.trim() ?? "",
        ),
        ingestion:
            "One Markdown source per original session position; dates, roles and turn text preserved",
        topicCuration: {
            inputTokenTarget:
                process.env.TYPEAGENT_MEMORY_TOPIC_INPUT_TOKENS ?? null,
            concurrency: process.env.TYPEAGENT_MEMORY_TOPIC_CONCURRENCY ?? null,
            priorContextFraction:
                process.env.TYPEAGENT_MEMORY_TOPIC_PRIOR_FRACTION ?? null,
        },
        wikiAssessmentConcurrency: Number(
            process.env.TYPEAGENT_MEMORY_WIKI_ASSESSMENT_CONCURRENCY ?? 1,
        ),
        maintenanceBuildConcurrency: Number(
            process.env.TYPEAGENT_MEMORY_VIEW_BUILD_CONCURRENCY ?? 1,
        ),
        nativeTimingEnabled: process.env.TYPEAGENT_MEMORY_SEARCH_TRACE === "1",
        questionViewInputAdmission: "configured-complete-request-v1",
        answerMode: "default",
        preparedIndexing:
            process.env.TYPEAGENT_MEMORY_PREPARED_INDEXING === "1",
        indexingParallel: (process.env.TYPEAGENT_MEMORY_PERF_EXPERIMENTS ?? "")
            .split(",")
            .some((name) => name.trim() === "indexing-parallel"),
        indexingTreatments: indexingTreatments(),
        searchTrace: process.env.TYPEAGENT_MEMORY_SEARCH_TRACE === "1",
        indexingLifecycle: options.indexingPilot === true,
        caseStoreIsolation: options.indexingPilot
            ? "fresh-store-per-case"
            : "shared-run-store",
        readerProvenance:
            "Opt-in public diagnostics identify actual indexed reader fragments and selection; citations identify supplied evidence, not independent entailment.",
        answerLimit: "product-default",
        questionFailurePolicy: "log-failed-case-and-continue-unattempted-v1",
        knowledgeTimeoutMs: state.knowledgeTimeoutMs ?? 600000,
        preliminarySearch: false,
        readerDate:
            "Original question date supplied to retrieval and reader as temporal metadata",
        judge: "Pinned official prompts; normal configured model and default generation settings, not official GPT-4o evaluator",
        humanGold:
            "Official LongMemEval references; no assertion of independent review of local artifact gold",
        sourceSynopses: capabilities.features.sourceSynopses,
        informationalViews:
            capabilities.derivedViews?.informationalWiki === true,
        viewDrafts: capabilities.derivedViews?.drafts === true,
        knowledgeReadiness: capabilities.derivedViews?.knowledge === true,
        integratedAnswering:
            capabilities.derivedViews?.integratedAnswering === true,
    };
    if (resume)
        assert.deepEqual(
            state.arm,
            arm,
            "Product memory configuration changed",
        );
    state.arm = arm;
}

async function benchmarkCheckpoint(productRoot) {
    const hashes = await snapshotCompiledCheckpoint(productRoot);
    for (const file of [
        productFactory,
        "packages\\agentServer\\server\\dist\\viewModelOptions.js",
    ])
        hashes[file] = digest(await readFile(path.join(productRoot, file)));
    return hashes;
}

function validateBenchmarkSpec(spec) {
    assert.equal(
        spec.authorizedLiveBenchmark,
        true,
        "Explicit benchmark inference authorization is required",
    );
    assert.equal(spec.mode, "longmemeval-full500");
    assert.equal(spec.startupAllowanceMs, 120000);
    assert.ok(
        spec.workAllowanceMs === null ||
            (Number.isSafeInteger(spec.workAllowanceMs) &&
                spec.workAllowanceMs > cleanupReserveMs &&
                spec.workAllowanceMs <= workAllowanceMs),
    );
    assert.equal(spec.totalAllowanceMs, spec.workAllowanceMs);
    assert.ok(
        Number.isSafeInteger(spec.knowledgeTimeoutMs ?? 600000) &&
            (spec.knowledgeTimeoutMs ?? 600000) >= 60000 &&
            (spec.knowledgeTimeoutMs ?? 600000) <= 3600000,
        "Knowledge readiness timeout must be between one and sixty minutes",
    );
    assert.equal(typeof spec.resume, "boolean");
    if (spec.indexingPilot) {
        assert.equal(
            spec.resume,
            false,
            "Pilot arms require fresh case stores",
        );
        assert.ok(
            !spec.continuation,
            "Pilot arms do not permit warm continuations",
        );
        assert.ok(
            spec.questionIds?.length === 3 ||
                (["indexing-parallel", "indexing-ablation"].includes(
                    spec.indexingComparison,
                ) &&
                    spec.questionIds?.length === 1),
            "Indexing pilot requires three questions, or one complete parallel-comparison history",
        );
        assert.match(spec.expectedConfigurationHash ?? "", /^[a-f0-9]{64}$/);
        assert.match(spec.expectedDependencyHash ?? "", /^[a-f0-9]{64}$/);
        assert.match(
            spec.expectedEmbeddingConfigurationHash ?? "",
            /^[a-f0-9]{64}$/,
        );
        assert.match(
            spec.expectedRuntimeConfigurationHash ?? "",
            /^[a-f0-9]{64}$/,
        );
    }
    if (spec.continuation) {
        assert.equal(spec.resume, false, "Continuation requires a fresh run");
        assert.ok(path.isAbsolute(spec.continuation.parentRunDirectory));
        assert.match(spec.continuation.parentStateSha256, /^[a-f0-9]{64}$/);
    }
    assert.ok(
        Number.isSafeInteger(spec.maximumCompletedQuestions) &&
            spec.maximumCompletedQuestions > 0 &&
            spec.maximumCompletedQuestions <= 500,
        "Batch question limit must be between 1 and 500",
    );
    for (const key of [
        "productRoot",
        "datasetPath",
        "judgeSourcePath",
        "runDirectory",
    ])
        assert.ok(path.isAbsolute(spec[key]));
    assertCheckpoint(spec.expectedCheckpoint.hashes, spec.expectedCheckpoint);
}

export function benchmarkInvocationAllowance(value) {
    if (value === "unlimited") return null;
    const minutes = Number(value);
    assert.ok(
        Number.isSafeInteger(minutes) &&
            minutes >= 1 &&
            minutes <= maximumWorkMinutes,
        `Invocation work minutes must be an integer from 1 to ${maximumWorkMinutes}, or unlimited`,
    );
    return minutes * 60000 + cleanupReserveMs;
}

export function benchmarkKnowledgeTimeout(value) {
    const minutes = Number(value);
    assert.ok(
        Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 60,
        "Knowledge readiness minutes must be an integer from 1 to 60",
    );
    return minutes * 60000;
}

export async function acknowledgeStopAfterQuestion(
    runDirectory,
    state,
    persist,
) {
    let text;
    try {
        text = await readFile(
            path.join(runDirectory, "stop-after-question.json"),
            "utf8",
        );
    } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
    const request = JSON.parse(text);
    assert.equal(
        request.stop,
        true,
        "Stop-after-question request must contain stop: true",
    );
    state.stopAfterQuestion = {
        acknowledgedEpochMs: Date.now(),
        lastQuestionId: state.currentQuestionId ?? null,
    };
    await persist();
    return true;
}

export function benchmarkFailure(error) {
    return {
        ...safeFailure(error),
        ...(error?.code === "EREPLAYNONDETERMINISTIC"
            ? { category: "REPLAY_CAPTURE_INCONSISTENT_OUTPUT" }
            : error?.code === "EREPLAYMISS"
              ? { category: "REPLAY_INPUT_NOT_CAPTURED" }
              : {}),
        ...(/^E[A-Z0-9_]+$/.test(error?.code ?? "")
            ? { code: error.code }
            : {}),
        ...(["open", "rename", "read", "write", "stat", "unlink"].includes(
            error?.syscall,
        )
            ? { syscall: error.syscall }
            : {}),
        ownedHarnessFrames: [
            ...(error?.stack ?? "").matchAll(
                /[\\/]([\w.-]+\.(?:mjs|js):\d+:\d+)/g,
            ),
        ].map((match) => match[1]),
    };
}

export function recordBenchmarkAttemptFailure(
    state,
    attempt,
    error,
    signal,
    activeQuestionId,
) {
    const bounded = signal.aborted || error.name === "TimeoutError";
    state.outcome = bounded ? "PARTIAL_BOUNDED_WORK" : "FAILED_REAL_BENCHMARK";
    attempt.error = benchmarkFailure(error);
    const record =
        activeQuestionId === undefined
            ? undefined
            : state.cases[activeQuestionId];
    if (record && record.status !== "complete") {
        record.status = bounded ? "interrupted" : "failed";
        record.error = benchmarkFailure(error);
    }
}

export async function runBenchmarkQuestion(
    state,
    attempt,
    questionId,
    work,
    controls,
) {
    const record = state.cases[questionId];
    assert.ok(record, "Question startup must persist a case before execution");
    if (["complete", "failed"].includes(record.status)) return;
    try {
        await work();
    } catch (error) {
        if (
            controls.signal.aborted ||
            error.syscall ||
            [
                "EREPLAYMISS",
                "EREPLAYNONDETERMINISTIC",
                "EBENCHMARKCLEANUP",
            ].includes(error.code)
        )
            throw error;
        const event = {
            kind: "benchmark-question-failed",
            questionId,
            stage: controls.stage(),
            observedEpochMs: Date.now(),
            requiredViewFamilies: [
                ...new Set(
                    (record.knowledgeCheckpoint?.requiredFailures ?? []).map(
                        (failure) => failure.family,
                    ),
                ),
            ],
            error: benchmarkFailure(error),
        };
        record.status = "failed";
        record.failureStage = event.stage;
        record.failedEpochMs = event.observedEpochMs;
        record.error = event.error;
        (attempt.caseFailures ??= []).push(event);
        await controls.persist();
        (
            controls.log ??
            ((entry) => process.stderr.write(JSON.stringify(entry) + "\n"))
        )(event);
    }
}

export function createBenchmarkStateWriter(file, state, write = writeJson) {
    let tail = Promise.resolve();
    return () => {
        const snapshot = structuredClone(state);
        tail = tail.then(() => write(file, snapshot));
        return tail;
    };
}

export async function engineIdentity(
    readSource = (file) => readFile(new URL(file, import.meta.url)),
) {
    const files = [
        "longmemeval-live.mjs",
        "longmemeval-indexing-lifecycle.mjs",
        "longmemeval-indexing-contract.mjs",
        "longmemeval-runner.mjs",
        "knowledge-observer.mjs",
        "quality-adapters.mjs",
        "live-resume.mjs",
    ];
    return digest(
        JSON.stringify(
            await Promise.all(
                files.map(async (file) => [
                    file,
                    digest(await readSource(file)),
                ]),
            ),
        ),
    );
}

export async function loadPrepared(spec) {
    const bytes = await readFile(spec.datasetPath);
    assert.equal(
        digest(bytes),
        datasetSha256,
        "Pinned official dataset bytes changed",
    );
    return prepareLongMemEval(JSON.parse(bytes.toString("utf8")), {
        scope: "full500",
        historyPolicy: "official-supplied",
        seed,
        provenance: {
            ...publicPins.longMemEval,
            path: "longmemeval_s_cleaned.json",
            sha256: datasetSha256,
            datasetRepository:
                "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned",
            datasetRevision,
        },
    });
}

export function benchmarkConfiguration(settings) {
    return {
        provider: settings.provider,
        ...(settings.modelName === undefined
            ? {}
            : { modelName: settings.modelName }),
        endpointHash: digest(settings.endpoint),
        requestConstraints: settings.requestConstraints,
    };
}

export function benchmarkProviderConfiguration(client) {
    return {
        ...benchmarkConfiguration(client.openai.getChatModelSettings()),
        poolMembers: client.openai
            .getChatModelPool()
            .members.map(({ settings }) => benchmarkConfiguration(settings)),
    };
}

export function observedJudgeModel(events, firstRequest) {
    const model = events
        .slice(firstRequest)
        .findLast((event) => event.role === "benchmarkJudge.complete")?.model;
    assert.ok(model, "Judge provider response omitted model identity");
    return model;
}

export async function closeBenchmarkService(
    service,
    state,
    attempt,
    persist,
    failure,
    restoreObserver = () => {},
) {
    attempt.outcome = state.outcome;
    attempt.closeStartedEpochMs = Date.now();
    try {
        try {
            await persist();
        } finally {
            try {
                await service.close();
                attempt.supportedClose = "COMPLETE";
            } catch (error) {
                attempt.supportedClose = failure(error);
                state.outcome = "FAILED_SUPPORTED_CLOSE";
            }
        }
        await persist();
    } finally {
        restoreObserver();
    }
}

export function selectConstructionCases(construction, selection) {
    if (selection !== undefined) {
        assert.ok(
            Array.isArray(selection) &&
                selection.length > 0 &&
                new Set(selection).size === selection.length,
            "Diagnostic question IDs must be nonempty and unique",
        );
        const available = new Set(construction.map((entry) => entry.id));
        assert.ok(
            selection.every((id) => available.has(id)),
            "Unknown diagnostic question ID",
        );
    }
    return selection === undefined
        ? construction
        : construction.filter((entry) => selection.includes(entry.id));
}

export function completedOutcome(constructionCases, state, selection) {
    const statuses = constructionCases.map(
        (entry) => state.cases[entry.id]?.status,
    );
    if (
        statuses.includes("failed") &&
        statuses.every((status) => ["complete", "failed"].includes(status))
    )
        return selection === undefined
            ? "FULL_500_COMPLETED_WITH_FAILURES"
            : "DIAGNOSTIC_SELECTION_COMPLETED_WITH_FAILURES";
    if (
        !constructionCases.every(
            (entry) => state.cases[entry.id]?.status === "complete",
        )
    )
        return state.stopAfterQuestion
            ? "PARTIAL_STOP_AFTER_QUESTION"
            : "PARTIAL_QUESTION_LIMIT";
    return selection === undefined
        ? "FULL_500_COMPLETED_CONFIGURED_JUDGE_PROTOCOL"
        : "DIAGNOSTIC_SELECTION_COMPLETED";
}

export function recordKnowledgeAllowance(state, timeoutMs = 600000) {
    assert.equal(
        state.knowledgeTimeoutMs ?? 600000,
        timeoutMs,
        "Knowledge readiness allowance changed",
    );
    state.knowledgeTimeoutMs = timeoutMs;
}

export function continuedBenchmarkState(
    prior,
    runId,
    timeoutMs,
    engineHash,
    origin,
) {
    assert.equal(
        prior.outcome,
        "PARTIAL_BOUNDED_WORK",
        "Only a bounded interruption can seed a continuation",
    );
    benchmarkKnowledgeTimeout(String(timeoutMs / 60000));
    assert.ok(
        timeoutMs > (prior.knowledgeTimeoutMs ?? 600000),
        "Continuation requires an explicitly larger readiness allowance",
    );
    const state = structuredClone(prior);
    for (const record of Object.values(state.cases)) {
        assert.equal(
            record.status,
            "interrupted",
            "Continuation requires interrupted, unscored cases",
        );
        assert.ok(!record.hypothesis, "Do not discard an existing hypothesis");
        delete record.knowledgeCheckpoint;
        delete record.error;
    }
    state.runId = runId;
    state.knowledgeTimeoutMs = timeoutMs;
    if (state.arm) state.arm.knowledgeTimeoutMs = timeoutMs;
    state.engineHash = engineHash;
    state.providerRequests = [];
    state.roleCalls = [];
    state.attempts = [];
    state.outcome = "IN_PROGRESS";
    state.continuation = {
        ...origin,
        parentRunId: prior.runId,
        previousKnowledgeTimeoutMs: prior.knowledgeTimeoutMs ?? 600000,
        knowledgeTimeoutMs: timeoutMs,
        reusedCompletedImports: Object.values(prior.cases).reduce(
            (count, record) => count + record.operations.length,
            0,
        ),
        timingScope:
            "Warm continuation; parent ingestion and maintenance latency excluded",
    };
    delete state.scorecard;
    delete state.stopAfterQuestion;
    return state;
}

async function prepareContinuation(parent, spec) {
    const parentRunDirectory = await realpath(parent);
    return withLiveRunLock(parentRunDirectory, async () => {
        const termination = JSON.parse(
            await readFile(
                path.join(parentRunDirectory, "termination.json"),
                "utf8",
            ),
        );
        const owner = JSON.parse(
            await readFile(
                path.join(parentRunDirectory, "ownership.json"),
                "utf8",
            ),
        );
        assert.equal(termination.receiptId, owner.receiptId);
        assert.equal(termination.workerExited, true);
        assert.equal(
            alive(termination.workerPid),
            false,
            "Parent worker is still present",
        );
        assert.equal(
            alive(termination.watchdogPid),
            false,
            "Parent watchdog is still present",
        );
        const bytes = await readFile(
            path.join(parentRunDirectory, "benchmark-state.json"),
        );
        const prior = JSON.parse(bytes.toString("utf8"));
        assert.equal(prior.runId, owner.receiptId);
        const origin = { parentRunDirectory, parentStateSha256: digest(bytes) };
        const state = continuedBenchmarkState(
            prior,
            spec.receiptId,
            spec.knowledgeTimeoutMs,
            await engineIdentity(),
            origin,
        );
        assert.equal(
            state.compiledDigest,
            digest(JSON.stringify(spec.expectedCheckpoint.hashes)),
            "Production build changed before continuation",
        );
        assert.deepEqual(
            state.questionIds ?? null,
            spec.questionIds ?? null,
            "Continuation selection changed",
        );
        assert.deepEqual(
            state.dependencies,
            await liveDependencyCheckpoint(spec.productRoot),
            "Model/config dependencies changed before continuation",
        );
        await cp(
            path.join(parentRunDirectory, "isolated-store"),
            path.join(spec.runDirectory, "isolated-store"),
            {
                recursive: true,
                force: false,
                errorOnExist: true,
            },
        );
        await writeJson(
            path.join(spec.runDirectory, "benchmark-state.json"),
            state,
        );
        await writeJson(
            path.join(spec.runDirectory, "continuation-origin.json"),
            state.continuation,
        );
        return origin;
    });
}

async function loadBenchmarkWorkerState(spec, manifestHash) {
    const selection = spec.questionIds;
    const hashes = await benchmarkCheckpoint(spec.productRoot);
    assertCheckpoint(hashes, spec.expectedCheckpoint);
    const compiledDigest = digest(JSON.stringify(hashes));
    const dependencies = await liveDependencyCheckpoint(spec.productRoot);
    if (spec.expectedDependencyHash)
        assert.equal(
            digest(JSON.stringify(dependencies)),
            spec.expectedDependencyHash,
            "Approved dependencies changed",
        );
    const engineHash = await engineIdentity();
    const statePath = path.join(spec.runDirectory, "benchmark-state.json");
    const seeded = spec.resume || !!spec.continuation;
    const state = seeded
        ? JSON.parse(await readFile(statePath, "utf8"))
        : {
              runId: spec.receiptId,
              manifestHash,
              compiledDigest,
              knowledgeTimeoutMs: spec.knowledgeTimeoutMs,
              dependencies,
              engineHash,
              questionIds: selection ?? null,
              cases: {},
              providerRequests: [],
              roleCalls: [],
              attempts: [],
          };
    assert.equal(state.runId, spec.receiptId);
    recordKnowledgeAllowance(state, spec.knowledgeTimeoutMs);
    assert.deepEqual(
        state.questionIds ?? null,
        selection ?? null,
        "Diagnostic selection changed",
    );
    assert.equal(
        state.manifestHash,
        manifestHash,
        "Dataset or construction plan changed",
    );
    assert.equal(
        state.compiledDigest,
        compiledDigest,
        "Production compiled checkpoint changed",
    );
    assert.deepEqual(
        state.dependencies,
        dependencies,
        "Model/config dependencies changed",
    );
    assert.equal(
        state.engineHash,
        engineHash,
        "Benchmark implementation changed",
    );
    return { state, statePath, seeded, compiledDigest };
}

async function runWorker(spec) {
    const prepared = await loadPrepared(spec);
    const selection = spec.questionIds;
    const constructionCases = selectConstructionCases(
        prepared.construction,
        selection,
    );
    const templates = officialJudgeTemplates(
        await readFile(spec.judgeSourcePath, "utf8"),
    );
    const { state, statePath, seeded, compiledDigest } =
        await loadBenchmarkWorkerState(spec, prepared.manifest.sha256);
    const persist = createBenchmarkStateWriter(statePath, state);
    const attempt = {
        startedEpochMs: spec.spawnedEpochMs,
        workerPid: process.pid,
        workDeadlineEpochMs:
            spec.workAllowanceMs === null
                ? null
                : spec.spawnedEpochMs + spec.workAllowanceMs - cleanupReserveMs,
        totalDeadlineEpochMs:
            spec.workAllowanceMs === null
                ? null
                : spec.spawnedEpochMs + spec.workAllowanceMs,
        maximumCompletedQuestions: spec.maximumCompletedQuestions,
        maximumAttemptedQuestions: spec.maximumCompletedQuestions,
    };
    state.attempts.push(attempt);
    state.outcome = "IN_PROGRESS";
    await persist();
    await writeJson(
        path.join(spec.runDirectory, "manifest.json"),
        prepared.manifest,
    );
    const load = (relative) =>
        import(pathToFileURL(path.join(spec.productRoot, relative)).href);
    const config = await load("packages\\config\\dist\\index.js");
    const client = await load("packages\\aiclient\\dist\\index.js");
    config.loadConfigSync();
    client.initRuntimeConfigFromProcessEnv();
    const configuration = benchmarkProviderConfiguration(client);
    assertPilotProviderConfiguration(spec, client, config, configuration);
    if (seeded)
        assert.deepEqual(
            state.configuration,
            configuration,
            "Configured model changed",
        );
    state.configuration = configuration;
    const { waitForMemoryJob } = await load(
        "packages\\memory\\service\\dist\\rpcFacade.js",
    );
    const model = observedRoles(
        client.openai.createChatModel(),
        "benchmarkJudge",
        state,
    );
    const signal =
        attempt.workDeadlineEpochMs === null
            ? new AbortController().signal
            : AbortSignal.timeout(
                  Math.max(1, attempt.workDeadlineEpochMs - Date.now()),
              );
    let role = "benchmark-startup";
    const { currentSearchTraceId } = await load(
        "packages\\knowPro\\dist\\index.js",
    );
    const restoreObserver = observeProvider(
        state.providerRequests,
        () => role,
        currentSearchTraceId,
    );
    let serviceStore = path.join(spec.runDirectory, "isolated-store");
    const openService = (root) =>
        createBenchmarkMemoryService(load, root, (receipt) =>
            appendFileSync(
                path.join(spec.runDirectory, "topic-operations.jsonl"),
                `${JSON.stringify({
                    ...receipt,
                    timestamp: new Date().toISOString(),
                    role,
                })}\n`,
                { encoding: "utf8", flag: "a" },
            ),
        );
    let service = await openService(serviceStore);
    const judge = async (reference, hypothesis, abortSignal) => {
        const firstRequest = state.providerRequests.length;
        const result = await model.complete(
            judgePrompt(templates, reference, hypothesis),
            undefined,
            undefined,
            undefined,
            abortSignal,
        );
        if (!result.success) throw new Error(result.message);
        assert.match(
            result.data.trim(),
            /^(yes|no)[.!]?$/i,
            "Invalid judge response; no fabricated label",
        );
        const actual = observedJudgeModel(state.providerRequests, firstRequest);
        return { model: actual, label: /^yes/i.test(result.data.trim()) };
    };
    let activeQuestionId;
    try {
        if (Object.values(state.cases).some((record) => record?.corpusId)) {
            const readRetainedKnowledgeStatus =
                await createRetainedKnowledgeReader(
                    load,
                    path.join(spec.runDirectory, "isolated-store"),
                );
            await preflightRetainedKnowledge(service, state.cases, {
                persist,
                signal,
                failure: benchmarkFailure,
                readRetainedKnowledgeStatus,
            });
        }
        await service.initialize();
        recordBenchmarkArm(
            state,
            await service.getCapabilities(),
            seeded,
            spec,
        );
        await persist();
        const admittedEpochMs = Date.now();
        await writeJson(path.join(spec.runDirectory, "admitted.json"), {
            receiptId: spec.receiptId,
            workerPid: process.pid,
            admittedEpochMs,
            workDeadlineEpochMs:
                spec.workAllowanceMs === null
                    ? null
                    : admittedEpochMs + spec.workAllowanceMs,
            checkpointExpectationHash: checkpointExpectationHash(
                spec.expectedCheckpoint,
            ),
            compiledHashesHash: compiledDigest,
        });
        const readers = new Map(
            prepared.readerOnly.questions.map((row) => [row.question_id, row]),
        );
        const references = new Map(
            prepared.evaluatorOnly.references.map((row) => [
                row.question_id,
                row,
            ]),
        );
        let attemptedThisBatch = 0;
        for (const construction of constructionCases) {
            activeQuestionId = undefined;
            signal.throwIfAborted();
            if (
                await acknowledgeStopAfterQuestion(
                    spec.runDirectory,
                    state,
                    persist,
                )
            )
                break;
            const id = construction.id;
            if (["complete", "failed"].includes(state.cases[id]?.status))
                continue;
            state.currentQuestionId = id;
            activeQuestionId = id;
            role = `case-startup:${id}`;
            const isolated = await startIndexingCase(service, {
                enabled: spec.indexingPilot,
                store: serviceStore,
                runDirectory: spec.runDirectory,
                open: openService,
            });
            service = isolated.service;
            serviceStore = isolated.store;
            const name = `LongMemEval ${state.runId} ${id}`;
            const matches = (await service.listCorpora()).filter(
                (corpus) => corpus.name === name,
            );
            assert.ok(
                matches.length <= 1,
                "Duplicate benchmark corpus identity",
            );
            const record = (state.cases[id] ??= {
                corpusId: (matches[0] ?? (await service.createCorpus(name)))
                    .corpusId,
                status: "ingesting",
                operations: [],
                mappings: {},
                storeDirectory: path.relative(spec.runDirectory, serviceStore),
            });
            await persist();
            await runBenchmarkQuestion(
                state,
                attempt,
                id,
                async () => {
                    await measureIndexingCase(record, spec.indexingPilot, () =>
                        executeMemoryCase(
                            service,
                            construction,
                            readers.get(id),
                            references.get(id),
                            record,
                            {
                                persist,
                                signal,
                                waitForMemoryJob,
                                judge,
                                role: (value) => {
                                    role = value;
                                },
                                knowledgeTimeoutMs: state.knowledgeTimeoutMs,
                            },
                        ),
                    );
                    if (spec.indexingPilot) role = `lifecycle:${id}`;
                    service = await finishIndexingCase(service, {
                        enabled: spec.indexingPilot,
                        store: serviceStore,
                        runDirectory: spec.runDirectory,
                        open: openService,
                        record,
                        question: readers.get(id).question,
                        signal,
                        persist,
                    });
                },
                {
                    signal,
                    persist,
                    stage: () => role.split(":")[0],
                },
            );
            if (
                await acknowledgeStopAfterQuestion(
                    spec.runDirectory,
                    state,
                    persist,
                )
            )
                break;
            if (++attemptedThisBatch >= spec.maximumCompletedQuestions) break;
        }
        state.outcome = completedOutcome(constructionCases, state, selection);
    } catch (error) {
        recordBenchmarkAttemptFailure(
            state,
            attempt,
            error,
            signal,
            activeQuestionId,
        );
    } finally {
        state.scorecard = benchmarkScorecard(
            prepared,
            state.cases,
            state.providerRequests,
        );
        await closeBenchmarkService(
            service,
            state,
            attempt,
            persist,
            safeFailure,
            restoreObserver,
        );
        attempt.finishedEpochMs = Date.now();
        attempt.elapsedMs = attempt.finishedEpochMs - attempt.startedEpochMs;
        attempt.outcome = state.outcome;
        state.scorecard = benchmarkScorecard(
            prepared,
            state.cases,
            state.providerRequests,
        );
        await persist();
        await writeJson(
            path.join(spec.runDirectory, `attempt-${spec.spawnedEpochMs}.json`),
            attempt,
        );
        await writeJson(
            path.join(spec.runDirectory, "scorecard.json"),
            state.scorecard,
        );
        const hypotheses = Object.entries(state.cases)
            .filter(([, record]) => record.hypothesis)
            .map(([question_id, record]) => ({
                question_id,
                hypothesis: record.hypothesis,
                ...(record.autoeval_label
                    ? { autoeval_label: record.autoeval_label }
                    : {}),
            }));
        await writeJson(
            path.join(spec.runDirectory, "hypotheses.json"),
            hypotheses,
        );
    }
    return state.outcome;
}

export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            product: { type: "string" },
            dataset: { type: "string" },
            "judge-source": { type: "string" },
            output: { type: "string" },
            resume: { type: "string" },
            "continue-from": { type: "string" },
            spec: { type: "string" },
            "authorized-live-benchmark": { type: "boolean" },
            "max-questions": { type: "string", default: "500" },
            "work-minutes": { type: "string", default: "30" },
            "question-ids": { type: "string" },
            "knowledge-minutes": { type: "string", default: "10" },
            "indexing-pilot": { type: "boolean" },
            "indexing-comparison": { type: "string" },
            "expected-configuration-hash": { type: "string" },
            "expected-dependency-hash": { type: "string" },
            "expected-embedding-configuration-hash": { type: "string" },
            "expected-runtime-configuration-hash": { type: "string" },
        },
    });
    if (values.spec) {
        const spec = JSON.parse(await readFile(values.spec, "utf8"));
        validateBenchmarkSpec(spec);
        const outcome = await runWorker(spec);
        process.stdout.write(JSON.stringify({ outcome }) + "\n");
        process.exitCode =
            outcome === "FULL_500_COMPLETED_CONFIGURED_JUDGE_PROTOCOL" ||
            outcome === "DIAGNOSTIC_SELECTION_COMPLETED" ||
            outcome === "PARTIAL_STOP_AFTER_QUESTION" ||
            outcome === "PARTIAL_QUESTION_LIMIT"
                ? 0
                : 1;
        return;
    }
    assert.equal(values["authorized-live-benchmark"], true);
    assert.ok(
        !(values.resume && values["continue-from"]),
        "Choose resume or continue-from, not both",
    );
    const maximumCompletedQuestions = Number(values["max-questions"]);
    assert.ok(
        Number.isSafeInteger(maximumCompletedQuestions) &&
            maximumCompletedQuestions > 0 &&
            maximumCompletedQuestions <= 500,
        "Batch question limit must be between 1 and 500",
    );
    const invocationAllowanceMs = benchmarkInvocationAllowance(
        values["work-minutes"],
    );
    for (const key of ["product", "dataset", "judge-source", "output"])
        assert.ok(values[key] && path.isAbsolute(values[key]));
    const runDirectory = values.resume
        ? await realpath(values.resume)
        : await mkdtemp(
              path.join(await realpath(values.output), "memory-longmemeval-"),
          );
    const receiptId = values.resume
        ? JSON.parse(
              await readFile(path.join(runDirectory, "ownership.json"), "utf8"),
          ).receiptId
        : randomUUID();
    if (!values.resume)
        await writeJson(path.join(runDirectory, "ownership.json"), {
            receiptId,
            runDirectory,
        });
    process.stdout.write(
        JSON.stringify({ kind: "run-directory", runDirectory, receiptId }) +
            "\n",
    );
    const hashes = await benchmarkCheckpoint(values.product);
    const spec = {
        receiptId,
        runDirectory,
        mode: "longmemeval-full500",
        productRoot: values.product,
        datasetPath: values.dataset,
        judgeSourcePath: values["judge-source"],
        expectedCheckpoint: { name: "longmemeval-production-frozen", hashes },
        authorizedLiveBenchmark: true,
        startupAllowanceMs: 120000,
        workAllowanceMs: invocationAllowanceMs,
        totalAllowanceMs: invocationAllowanceMs,
        maximumCompletedQuestions,
        knowledgeTimeoutMs: benchmarkKnowledgeTimeout(
            values["knowledge-minutes"],
        ),
        ...(values["indexing-pilot"]
            ? {
                  indexingPilot: true,
                  indexingComparison: values["indexing-comparison"],
                  expectedConfigurationHash:
                      values["expected-configuration-hash"],
                  expectedDependencyHash: values["expected-dependency-hash"],
                  expectedEmbeddingConfigurationHash:
                      values["expected-embedding-configuration-hash"],
                  expectedRuntimeConfigurationHash:
                      values["expected-runtime-configuration-hash"],
              }
            : {}),
        ...(values["question-ids"] === undefined
            ? {}
            : { questionIds: values["question-ids"].split(",") }),
        resume: !!values.resume,
    };
    if (values["continue-from"])
        spec.continuation = await prepareContinuation(
            values["continue-from"],
            spec,
        );
    const result = await withLiveRunLock(runDirectory, async () => {
        if (spec.resume) {
            const prior = JSON.parse(
                await readFile(
                    path.join(runDirectory, "termination.json"),
                    "utf8",
                ),
            );
            assert.equal(
                alive(prior.watchdogPid),
                false,
                "Previous watchdog is still present",
            );
            assert.equal(prior.receiptId, receiptId);
        }
        return supervise(
            spec,
            path.join(import.meta.dirname, "longmemeval-live.mjs"),
            validateBenchmarkSpec,
        );
    });
    process.stdout.write(JSON.stringify({ runDirectory, ...result }) + "\n");
    process.exitCode = result.exit?.code === 0 ? 0 : 1;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    await main();
