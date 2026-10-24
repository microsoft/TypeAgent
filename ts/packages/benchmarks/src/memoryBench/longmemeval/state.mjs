// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "../shared/checkpoint.mjs";
import { safeFailure } from "../shared/failure.mjs";
import {
    digest,
    executeMemoryCase,
    BenchmarkImportFailure,
} from "./runner.mjs";
import { updateProgress } from "../storage.js";

export function assertPackageState(state) {
    assert.equal(
        state.schemaVersion,
        "typeagent-memory-longmemeval-v1",
        "Historical LongMemEval stores cannot resume under the package engine; use a fresh arm",
    );
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

export async function archiveBenchmarkArtifacts(runDirectory, archive, prior) {
    const missingArtifacts = [];
    for (const name of [
        "benchmark-state.json",
        "progress.json",
        "scorecard.json",
        "hypotheses.json",
        "termination.json",
        "admitted.json",
        "admission-verified.json",
    ]) {
        try {
            await copyFile(
                path.join(runDirectory, name),
                path.join(archive, name),
            );
        } catch (error) {
            if (
                error.code !== "ENOENT" ||
                !["admitted.json", "admission-verified.json"].includes(name) ||
                prior.phase !== "startup"
            )
                throw error;
            missingArtifacts.push(name);
        }
    }
    return missingArtifacts;
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
    if (state.progressPath) {
        const progress = benchmarkProgress(constructionCases, state, attempt);
        await updateProgress(state.progressPath, {
            dataset: "longmemeval",
            activeRun: `longmemeval:${state.runId}`,
            ...progress,
            accuracy:
                progress.passPercentage === null
                    ? null
                    : progress.passPercentage / 100,
            accuracyDenominator: "gradedQuestions",
            coverage: progress.targetQuestions
                ? progress.gradedQuestions / progress.targetQuestions
                : null,
        });
    }
}
