// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
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
const productFactory =
    "packages\\agentServer\\server\\dist\\durableMemoryService.js";

export async function createBenchmarkMemoryService(load, rootDirectory) {
    const { createDurableMemoryService } = await load(productFactory);
    return createDurableMemoryService(rootDirectory);
}

export function recordBenchmarkArm(state, capabilities, resume) {
    const arm = {
        name: "TypeAgent production document-backed conversation memory",
        productFactory,
        viewModelEndpointHash: digest(
            process.env.TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT?.trim() ?? "",
        ),
        ingestion:
            "One Markdown source per original session position; dates, roles and turn text preserved",
        answerMode: "default",
        readerProvenance:
            "Opt-in public diagnostics identify actual indexed reader fragments and selection; citations identify supplied evidence, not independent entailment.",
        answerLimit: "product-default",
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
    assert.equal(typeof spec.resume, "boolean");
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

function completedOutcome(constructionCases, state, selection) {
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
    const hashes = await benchmarkCheckpoint(spec.productRoot);
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
    assert.equal(
        state.engineHash,
        engineHash,
        "Benchmark implementation changed",
    );
    const persist = () => writeJson(statePath, state);
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
    const settings = client.openai.getChatModelSettings();
    const configuration = benchmarkConfiguration(settings);
    if (spec.resume)
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
    const restoreObserver = observeProvider(state.providerRequests, () => role);
    const service = await createBenchmarkMemoryService(
        load,
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
        recordBenchmarkArm(state, await service.getCapabilities(), spec.resume);
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
        let completedThisBatch = 0;
        for (const construction of constructionCases) {
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
            assert.notEqual(
                state.cases[id]?.status,
                "failed",
                "A real benchmark failure requires review before retry",
            );
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
            await executeMemoryCase(
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
            if (++completedThisBatch >= spec.maximumCompletedQuestions) break;
        }
        state.outcome = completedOutcome(constructionCases, state, selection);
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
            outcome === "PARTIAL_QUESTION_LIMIT"
                ? 0
                : 1;
        return;
    }
    assert.equal(values["authorized-live-benchmark"], true);
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
        ...(values["question-ids"] === undefined
            ? {}
            : { questionIds: values["question-ids"].split(",") }),
        resume: !!values.resume,
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
