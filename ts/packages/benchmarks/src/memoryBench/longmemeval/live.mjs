// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { writeJson } from "../shared/checkpoint.mjs";
import { alive, supervise } from "../shared/supervisor.mjs";
import { withLiveRunLock } from "../shared/resume.mjs";
import {
    benchmarkInvocationAllowance,
    benchmarkStartupAllowance,
    benchmarkCheckpoint,
    validateBenchmarkSpec,
    engineIdentity,
} from "./spec.mjs";
import { archiveBenchmarkArtifacts, assertPackageState } from "./state.mjs";
import { runWorker } from "./worker.mjs";
export * from "./state.mjs";
export {
    benchmarkInvocationAllowance,
    benchmarkStartupAllowance,
    createBenchmarkMemoryService,
    recordBenchmarkArm,
} from "./spec.mjs";

export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            product: { type: "string" },
            dataset: { type: "string" },
            variant: { type: "string", default: "s-cleaned" },
            "judge-source": { type: "string" },
            output: { type: "string" },
            resume: { type: "string" },
            spec: { type: "string" },
            "authorized-live-benchmark": { type: "boolean" },
            "max-questions": { type: "string", default: "500" },
            "work-minutes": { type: "string", default: "30" },
            "startup-minutes": { type: "string", default: "2" },
            "question-ids": { type: "string" },
            "continue-after-import-failure": { type: "boolean" },
            "previous-engine-hash": { type: "string" },
            progress: { type: "string" },
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
    const startupAllowanceMs = benchmarkStartupAllowance(
        values["startup-minutes"],
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
        variant: values.variant,
        judgeSourcePath: values["judge-source"],
        expectedCheckpoint: { name: "longmemeval-production-frozen", hashes },
        authorizedLiveBenchmark: true,
        startupAllowanceMs,
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
        ...(values.progress
            ? { progressPath: path.resolve(values.progress) }
            : {}),
    };
    const result = await withLiveRunLock(runDirectory, async () => {
        if (spec.resume) {
            const saved = JSON.parse(
                await readFile(
                    path.join(runDirectory, "benchmark-state.json"),
                    "utf8",
                ),
            );
            assertPackageState(saved);
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
                const missingArtifacts = await archiveBenchmarkArtifacts(
                    runDirectory,
                    archive,
                    prior,
                );
                await writeJson(path.join(archive, "authorization.json"), {
                    previousEngineHash: spec.previousEngineHash,
                    engineHash: await engineIdentity(),
                    policy: "continue-after-import-failure",
                    maximumCompletedQuestions,
                    missingArtifacts,
                    authorizedEpochMs: Date.now(),
                });
            }
        }
        return supervise(
            spec,
            path.join(import.meta.dirname, "live.mjs"),
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
