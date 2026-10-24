// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
    assertCheckpoint,
    checkpointExpectationHash,
    writeJson,
} from "../shared/checkpoint.mjs";
import {
    liveDependencyCheckpoint,
    observedRoles,
    observeProvider,
} from "../shared/observer.mjs";
import { safeFailure } from "../shared/failure.mjs";
import {
    benchmarkScorecard,
    digest,
    judgePrompt,
    officialJudgeTemplates,
} from "./runner.mjs";
import {
    loadPrepared,
    benchmarkCheckpoint,
    engineIdentity,
    cleanupReserveMs,
    createBenchmarkMemoryService,
    recordBenchmarkArm,
} from "./spec.mjs";
import {
    selectConstructionCases,
    acceptBenchmarkEngine,
    benchmarkQuestionIds,
    persistBenchmarkProgress,
    benchmarkConfiguration,
    observedJudgeModel,
    acknowledgeStopAfterQuestion,
    runBenchmarkQuestion,
    completedOutcome,
    benchmarkFailure,
    closeBenchmarkService,
} from "./state.mjs";
import { assertPackageState } from "./state.mjs";

export async function runWorker(spec) {
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
              schemaVersion: "typeagent-memory-longmemeval-v1",
              datasetVariant: spec.variant,
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
    assertPackageState(state);
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
    if (spec.progressPath) state.progressPath = spec.progressPath;
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
    const { waitForMemoryJob } = await load(
        "packages\\memory\\service\\dist\\rpcFacade.js",
    );
    const { runWithSearchTiming, timeSearchStage } = await load(
        "packages\\knowPro\\dist\\index.js",
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
        await runWithSearchTiming(state.runId, "benchmark.initialize", () =>
            timeSearchStage("service.initialize", () => service.initialize()),
        );
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
