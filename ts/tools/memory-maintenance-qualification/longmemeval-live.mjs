// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
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
    BenchmarkImportFailure,
    digest,
    executeMemoryCase,
    judgePrompt,
    officialJudgeTemplates,
} from "./longmemeval-runner.mjs";

const datasetSha256 =
    "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442";
const datasetRevision = "98d7416c24c778c2fee6e6f3006e7a073259d48f";
const workAllowanceMs = 35 * 60 * 1000;
const cleanupReserveMs = 5 * 60 * 1000;
const seed = "typeagent-longmemeval-full-2026-10-20";

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
    assert.equal(typeof spec.resume, "boolean");
    assert.ok(
        spec.continueAfterImportFailure === undefined ||
            typeof spec.continueAfterImportFailure === "boolean",
    );
    if (spec.previousEngineHash !== undefined)
        assert.ok(
            spec.resume &&
                spec.continueAfterImportFailure &&
                /^[a-f0-9]{64}$/.test(spec.previousEngineHash),
        );
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
        Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 30,
        "Invocation work minutes must be an integer from 1 to 30, or unlimited",
    );
    return minutes * 60000 + cleanupReserveMs;
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

async function engineIdentity() {
    const files = [
        "longmemeval-live.mjs",
        "longmemeval-runner.mjs",
        "quality-adapters.mjs",
        "live-resume.mjs",
        "live-stages.mjs",
    ];
    return digest(
        JSON.stringify(
            await Promise.all(
                files.map(async (file) => [
                    file,
                    digest(await readFile(new URL(file, import.meta.url))),
                ]),
            ),
        ),
    );
}

async function loadPrepared(spec) {
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
) {
    attempt.outcome = state.outcome;
    attempt.closeStartedEpochMs = Date.now();
    await persist();
    try {
        await service.close();
        attempt.supportedClose = "COMPLETE";
    } catch (error) {
        attempt.supportedClose = failure(error);
        state.outcome = "FAILED_SUPPORTED_CLOSE";
    }
    await persist();
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

export function completedOutcome(constructionCases, state, selection, attempt) {
    if (
        attempt?.continueAfterImportFailure &&
        attempt.questionIds.every(
            (id) =>
                state.cases[id]?.status === "complete" ||
                state.cases[id]?.failurePhase === "import",
        ) &&
        attempt.questionIds.some(
            (id) => state.cases[id]?.failurePhase === "import",
        )
    )
        return "QUESTION_TARGET_COMPLETED_WITH_IMPORT_FAILURES";
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

export function benchmarkProgress(constructionCases, state, attempt) {
    const questionIds = attempt.questionIds;
    const records = questionIds.map((id) => state.cases[id]);
    const graded = records.filter((record) => record?.status === "complete");
    for (const record of graded)
        assert.equal(
            typeof record.autoeval_label?.label,
            "boolean",
            "Completed progress record lacks a grade",
        );
    const passed = graded.filter(
        (record) => record.autoeval_label.label,
    ).length;
    const index = questionIds.indexOf(state.currentQuestionId);
    const construction = constructionCases.find(
        (entry) => entry.id === state.currentQuestionId,
    );
    const current = state.cases[state.currentQuestionId];
    const skippedImports = records.filter(
        (record) =>
            record?.status === "failed" && record.failurePhase === "import",
    ).length;
    return {
        schemaVersion: 1,
        runId: state.runId,
        updatedAt: new Date().toISOString(),
        updatePolicy: "Durable state transitions, not a periodic heartbeat",
        outcome: state.outcome,
        scheduledQuestions: constructionCases.length,
        targetQuestions: questionIds.length,
        targetQuestionIds: questionIds,
        currentQuestion:
            index < 0
                ? null
                : {
                      id: state.currentQuestionId,
                      number: index + 1,
                      total: questionIds.length,
                      status: current?.status ?? "not-started",
                      historiesCompleted: current?.operations?.length ?? 0,
                      historiesTotal: construction.sessions.length,
                      sourceKey: current?.inFlight?.sourceKey ?? null,
                  },
        gradedQuestions: graded.length,
        passedQuestions: passed,
        failedQuestions: graded.length - passed,
        passPercentage: graded.length ? (100 * passed) / graded.length : null,
        completionPercentage: questionIds.length
            ? (100 * graded.length) / questionIds.length
            : null,
        executionFailures: records.filter(
            (record) => record?.status === "failed",
        ).length,
        skippedImportQuestions: skippedImports,
        processedQuestions: graded.length + skippedImports,
        processedPercentage: questionIds.length
            ? (100 * (graded.length + skippedImports)) / questionIds.length
            : null,
        targetProcessed: graded.length + skippedImports === questionIds.length,
        targetGraded: graded.length === questionIds.length,
        supportedClose: attempt.supportedClose ?? null,
    };
}

export function benchmarkQuestionIds(
    constructionCases,
    state,
    maximum,
    continuing,
) {
    if (!continuing)
        return constructionCases
            .filter((entry) => state.cases[entry.id]?.status !== "complete")
            .slice(0, maximum)
            .map((entry) => entry.id);
    const expected = constructionCases
        .slice(0, maximum)
        .map((entry) => entry.id);
    const target =
        state.iterationQuestionIds ??
        state.attempts[0]?.questionIds ??
        expected;
    assert.deepEqual(target, expected, "Frozen question target changed");
    state.iterationQuestionIds = [...target];
    return target;
}

export function acceptBenchmarkEngine(state, engineHash, spec) {
    if (state.engineHash === engineHash) return;
    assert.ok(
        spec.resume &&
            spec.continueAfterImportFailure &&
            spec.previousEngineHash === state.engineHash,
        "Benchmark implementation changed; explicit prior-engine authorization required",
    );
    (state.harnessTransitions ??= []).push({
        previousEngineHash: state.engineHash,
        engineHash,
        authorizedEpochMs: Date.now(),
        policy: "continue-after-import-failure",
        compiledDigest: state.compiledDigest,
    });
    state.engineHash = engineHash;
}

export async function runBenchmarkQuestion(
    service,
    construction,
    reader,
    reference,
    record,
    controls,
) {
    try {
        if (record.status === "failed") {
            assert.ok(
                controls.continueAfterImportFailure &&
                    record.inFlight?.jobId &&
                    !record.hypothesis,
                "A real benchmark failure requires review before retry",
            );
            const job = await service.getJob(record.inFlight.jobId);
            throw new BenchmarkImportFailure(job);
        }
        await executeMemoryCase(
            service,
            construction,
            reader,
            reference,
            record,
            controls,
        );
        return;
    } catch (error) {
        if (
            !controls.continueAfterImportFailure ||
            controls.signal.aborted ||
            !(error instanceof BenchmarkImportFailure)
        )
            throw error;
        record.status = "failed";
        record.failurePhase = "import";
        record.importFailure = error.job;
        record.error ??= benchmarkFailure(error);
        await controls.persist();
    }
}

export async function persistBenchmarkProgress(
    runDirectory,
    constructionCases,
    state,
    attempt,
) {
    await writeJson(path.join(runDirectory, "benchmark-state.json"), state);
    await writeJson(
        path.join(runDirectory, "progress.json"),
        benchmarkProgress(constructionCases, state, attempt),
    );
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
    const hashes = await snapshotCompiledCheckpoint(spec.productRoot);
    assertCheckpoint(hashes, spec.expectedCheckpoint);
    const compiledDigest = digest(JSON.stringify(hashes));
    const dependencies = await liveDependencyCheckpoint(spec.productRoot);
    const engineHash = await engineIdentity();
    const statePath = path.join(spec.runDirectory, "benchmark-state.json");
    const state = spec.resume
        ? JSON.parse(await readFile(statePath, "utf8"))
        : {
              runId: spec.receiptId,
              manifestHash: prepared.manifest.sha256,
              compiledDigest,
              dependencies,
              engineHash,
              questionIds: selection ?? null,
              cases: {},
              providerRequests: [],
              roleCalls: [],
              attempts: [],
          };
    assert.equal(state.runId, spec.receiptId);
    assert.deepEqual(
        state.questionIds ?? null,
        selection ?? null,
        "Diagnostic selection changed",
    );
    assert.equal(
        state.manifestHash,
        prepared.manifest.sha256,
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
    acceptBenchmarkEngine(state, engineHash, spec);
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
        continueAfterImportFailure: spec.continueAfterImportFailure === true,
        questionIds: benchmarkQuestionIds(
            constructionCases,
            state,
            spec.maximumCompletedQuestions,
            spec.continueAfterImportFailure,
        ),
    };
    const persist = () =>
        persistBenchmarkProgress(
            spec.runDirectory,
            constructionCases,
            state,
            attempt,
        );
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
    const settings = client.openai.getChatModelSettings();
    const configuration = benchmarkConfiguration(settings);
    if (spec.resume)
        assert.deepEqual(
            state.configuration,
            configuration,
            "Configured model changed",
        );
    state.configuration = configuration;
    state.arm = {
        name: "TypeAgent FileMemoryService product defaults",
        serviceConfiguration: "constructor-defaults",
        ingestion:
            "One Markdown source per original session position; typed session/turn temporal ownership, raw dates, roles and turn text preserved",
        answerMode: "default",
        readerProvenance:
            "Opt-in public diagnostics identify the actual indexed fragments supplied to the product reader; citations identify supplied evidence, not independent entailment.",
        answerLimit: "product-default",
        preliminarySearch: false,
        readerDate:
            "Typed original question reference date supplied to querying and reading, never historical construction; official supplied-history eligibility",
        temporalContractVersion: 1,
        judge: "Pinned official prompts; normal configured model and default generation settings, not official GPT-4o evaluator",
        humanGold:
            "Official LongMemEval references; no assertion of independent review of local artifact gold",
    };
    const { FileMemoryService } = await load(
        "packages\\memory\\service\\dist\\fileMemoryService.js",
    );
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
    const restoreObserver = observeProvider(state.providerRequests, () => role);
    const service = new FileMemoryService(
        path.join(spec.runDirectory, "isolated-store"),
    );
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
    try {
        await service.initialize();
        state.arm.serviceCapabilities = await service.getCapabilities();
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
        for (const construction of constructionCases.filter((entry) =>
            attempt.questionIds.includes(entry.id),
        )) {
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
            if (state.cases[id]?.status === "complete") continue;
            state.currentQuestionId = id;
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
            });
            await persist();
            await runBenchmarkQuestion(
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
                    continueAfterImportFailure: spec.continueAfterImportFailure,
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
        }
        state.outcome = completedOutcome(
            constructionCases,
            state,
            selection,
            attempt,
        );
    } catch (error) {
        const bounded = signal.aborted || error.name === "TimeoutError";
        state.outcome = bounded
            ? "PARTIAL_BOUNDED_WORK"
            : "FAILED_REAL_BENCHMARK";
        attempt.error = benchmarkFailure(error);
        const record = state.cases[state.currentQuestionId];
        if (record && record.status !== "complete") {
            record.status = bounded ? "interrupted" : "failed";
            record.error = benchmarkFailure(error);
        }
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
        );
        restoreObserver();
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
            spec: { type: "string" },
            "authorized-live-benchmark": { type: "boolean" },
            "max-questions": { type: "string", default: "500" },
            "work-minutes": { type: "string", default: "30" },
            "question-ids": { type: "string" },
            "continue-after-import-failure": { type: "boolean" },
            "previous-engine-hash": { type: "string" },
        },
    });
    if (values.spec) {
        const spec = JSON.parse(await readFile(values.spec, "utf8"));
        validateBenchmarkSpec(spec);
        const outcome = await runWorker(spec);
        process.stdout.write(JSON.stringify({ outcome }) + "\n");
        process.exitCode =
            outcome.startsWith("FULL_500_") ||
            outcome === "DIAGNOSTIC_SELECTION_COMPLETED" ||
            outcome === "PARTIAL_STOP_AFTER_QUESTION" ||
            outcome === "PARTIAL_QUESTION_LIMIT" ||
            outcome === "QUESTION_TARGET_COMPLETED_WITH_IMPORT_FAILURES"
                ? 0
                : 1;
        return;
    }
    assert.equal(values["authorized-live-benchmark"], true);
    if (values["previous-engine-hash"] !== undefined)
        assert.ok(
            values.resume &&
                values["continue-after-import-failure"] &&
                /^[a-f0-9]{64}$/.test(values["previous-engine-hash"]),
            "Prior engine authorization requires an explicit import-failure continuation",
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
    const hashes = await snapshotCompiledCheckpoint(values.product);
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
        ...(values["question-ids"] === undefined
            ? {}
            : { questionIds: values["question-ids"].split(",") }),
        resume: !!values.resume,
        continueAfterImportFailure:
            values["continue-after-import-failure"] === true,
        previousEngineHash: values["previous-engine-hash"],
    };
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
            assert.equal(prior.workerExited, true);
            assert.equal(
                alive(prior.workerPid),
                false,
                "Previous worker is still present",
            );
            if (spec.previousEngineHash) {
                const priorState = JSON.parse(
                    await readFile(
                        path.join(runDirectory, "benchmark-state.json"),
                        "utf8",
                    ),
                );
                assert.equal(priorState.engineHash, spec.previousEngineHash);
                const archive = await mkdtemp(
                    path.join(runDirectory, "before-harness-continuation-"),
                );
                for (const name of [
                    "benchmark-state.json",
                    "progress.json",
                    "scorecard.json",
                    "hypotheses.json",
                    "termination.json",
                    "admitted.json",
                    "admission-verified.json",
                ])
                    await copyFile(
                        path.join(runDirectory, name),
                        path.join(archive, name),
                    );
                await writeJson(path.join(archive, "authorization.json"), {
                    previousEngineHash: spec.previousEngineHash,
                    engineHash: await engineIdentity(),
                    policy: "continue-after-import-failure",
                    maximumCompletedQuestions,
                    authorizedEpochMs: Date.now(),
                });
            }
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
