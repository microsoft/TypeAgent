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
import { liveDependencyCheckpoint, observeProvider } from "./live-stages.mjs";
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

function validateBenchmarkSpec(spec) {
    assert.equal(
        spec.authorizedLiveBenchmark,
        true,
        "Explicit benchmark inference authorization is required",
    );
    assert.equal(spec.mode, "longmemeval-full500");
    assert.equal(spec.startupAllowanceMs, 120000);
    assert.equal(spec.workAllowanceMs, workAllowanceMs);
    assert.equal(spec.totalAllowanceMs, workAllowanceMs);
    assert.equal(typeof spec.resume, "boolean");
    for (const key of [
        "productRoot",
        "datasetPath",
        "judgeSourcePath",
        "runDirectory",
    ])
        assert.ok(path.isAbsolute(spec[key]));
    assertCheckpoint(spec.expectedCheckpoint.hashes, spec.expectedCheckpoint);
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

async function runWorker(spec) {
    const prepared = await loadPrepared(spec);
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
              cases: {},
              providerRequests: [],
              attempts: [],
          };
    assert.equal(state.runId, spec.receiptId);
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
            spec.spawnedEpochMs + workAllowanceMs - cleanupReserveMs,
        totalDeadlineEpochMs: spec.spawnedEpochMs + workAllowanceMs,
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
    const configuration = {
        provider: settings.provider,
        modelName: settings.modelName,
        endpointHash: digest(settings.endpoint),
        requestConstraints: settings.requestConstraints,
    };
    if (spec.resume)
        assert.deepEqual(
            state.configuration,
            configuration,
            "Configured model changed",
        );
    state.configuration = configuration;
    state.arm = {
        name: "TypeAgent production document-backed conversation memory",
        ingestion:
            "One Markdown source per original session position; dates, roles and turn text preserved",
        sourceSynopses: false,
        informationalViews: false,
        viewDrafts: false,
        answerMode: "synthesized",
        answerLimit: 12,
        searchLimit: 20,
        readerDate: "Original question date supplied to reader only",
        judge: "Pinned official prompts; normal configured model and default generation settings, not official GPT-4o evaluator",
        humanGold:
            "Official LongMemEval references; no assertion of independent review of local artifact gold",
    };
    const { FileMemoryService } = await load(
        "packages\\memory\\service\\dist\\fileMemoryService.js",
    );
    const { createKnowProCorpusIndex } = await load(
        "packages\\memory\\service\\dist\\knowProCorpusIndex.js",
    );
    const { waitForMemoryJob } = await load(
        "packages\\memory\\service\\dist\\rpcFacade.js",
    );
    const model = client.openai.createChatModel();
    const signal = AbortSignal.timeout(
        Math.max(1, attempt.workDeadlineEpochMs - Date.now()),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) =>
        originalFetch(input, {
            ...init,
            signal: AbortSignal.any([
                signal,
                ...(init?.signal ? [init.signal] : []),
                ...(input instanceof Request ? [input.signal] : []),
            ]),
        });
    let role = "benchmark-startup";
    const restoreObserver = observeProvider(state.providerRequests, () => role);
    const service = new FileMemoryService(
        path.join(spec.runDirectory, "isolated-store"),
        {
            indexFactory: createKnowProCorpusIndex,
            sourceSynopses: false,
            informationalViews: false,
            viewDrafts: false,
        },
    );
    const judge = async (reference, hypothesis, abortSignal) => {
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
        const actual = state.providerRequests.at(-1)?.model;
        assert.ok(actual, "Judge provider response omitted model identity");
        return { model: actual, label: /^yes/i.test(result.data.trim()) };
    };
    try {
        await service.initialize();
        const admittedEpochMs = Date.now();
        await writeJson(path.join(spec.runDirectory, "admitted.json"), {
            receiptId: spec.receiptId,
            workerPid: process.pid,
            admittedEpochMs,
            workDeadlineEpochMs: admittedEpochMs + spec.workAllowanceMs,
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
        for (const construction of prepared.construction) {
            signal.throwIfAborted();
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
        }
        state.outcome = "FULL_500_COMPLETED_CONFIGURED_JUDGE_PROTOCOL";
    } catch (error) {
        const bounded = signal.aborted || error.name === "TimeoutError";
        state.outcome = bounded
            ? "PARTIAL_BOUNDED_WORK"
            : "FAILED_REAL_BENCHMARK";
        attempt.error = safeFailure(error);
        const record = state.cases[state.currentQuestionId];
        if (record && record.status !== "complete") {
            record.status = bounded ? "interrupted" : "failed";
            record.error = safeFailure(error);
        }
    } finally {
        try {
            await service.close();
            attempt.supportedClose = "COMPLETE";
        } catch (error) {
            attempt.supportedClose = safeFailure(error);
            state.outcome = "FAILED_SUPPORTED_CLOSE";
        }
        restoreObserver();
        globalThis.fetch = originalFetch;
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
        },
    });
    if (values.spec) {
        const spec = JSON.parse(await readFile(values.spec, "utf8"));
        validateBenchmarkSpec(spec);
        const outcome = await runWorker(spec);
        process.stdout.write(JSON.stringify({ outcome }) + "\n");
        process.exitCode = outcome.startsWith("FULL_500_") ? 0 : 1;
        return;
    }
    assert.equal(values["authorized-live-benchmark"], true);
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
        workAllowanceMs,
        totalAllowanceMs: workAllowanceMs,
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
