// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, readdir, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
    snapshotCompiledCheckpoint,
    checkpointExpectationHash,
    writeJson,
} from "./harness.mjs";
import {
    loadPrepared,
    benchmarkProviderConfiguration,
    benchmarkConfiguration,
} from "./longmemeval-live.mjs";
import {
    digest,
    officialJudgeTemplates,
    judgePrompt,
    executeMemoryCase,
    prepareKnowledge,
} from "./longmemeval-runner.mjs";
import { liveDependencyCheckpoint, observeProvider } from "./live-stages.mjs";
import { supervise } from "./watchdog.mjs";
import {
    freezeWikiSeeds,
    cloneWikiSeed,
    wikiAdmissionCases,
} from "./wiki-admission-seeds.mjs";
import {
    wikiTrialSchedule,
    wikiPageInventory,
    pairedWikiResults,
    decisionAgreement,
    pairedAssessmentLatency,
} from "./wiki-admission-evaluation.mjs";
import {
    runWikiJudges,
    assertIndependentWikiJudge,
} from "./wiki-admission-judge.mjs";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const productRoot = path.resolve(import.meta.dirname, "..", "..");
const factoryPath = path.join(
    "packages",
    "agentServer",
    "server",
    "dist",
    "durableMemoryService.js",
);
const writeTape = (file, value) =>
    appendFileSync(file, `${JSON.stringify(value)}\n`, {
        encoding: "utf8",
        flag: "a",
    });

export async function experimentCheckpoint(root) {
    const hashes = {
        ...(await snapshotCompiledCheckpoint(root)),
        ...(await liveDependencyCheckpoint(root)),
        [factoryPath]: digest(await readFile(path.join(root, factoryPath))),
    };
    for (const entry of await readdir(import.meta.dirname))
        if (entry.endsWith(".mjs") && !entry.endsWith(".test.mjs"))
            hashes[
                path.join("tools", "memory-maintenance-qualification", entry)
            ] = digest(await readFile(path.join(import.meta.dirname, entry)));
    return hashes;
}

export async function loadWikiRuntime(spec) {
    const load = (relative) =>
        import(pathToFileURL(path.join(spec.productRoot, relative)).href);
    const config = await load(
        path.join("packages", "config", "dist", "index.js"),
    );
    const client = await load(
        path.join("packages", "aiclient", "dist", "index.js"),
    );
    config.loadConfigSync();
    client.initRuntimeConfigFromProcessEnv();
    const { createDurableMemoryService } = await load(factoryPath);
    const memory = await load(
        path.join("packages", "memory", "service", "dist", "index.js"),
    );
    const configuration = benchmarkProviderConfiguration(client);
    const effective = client.getRuntimeConfig();
    const poolConfiguration = (endpoint) =>
        client.openai
            .getChatModelPool(endpoint)
            .members.map(({ settings }) => benchmarkConfiguration(settings));
    configuration.writer = poolConfiguration(
        process.env.TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT?.trim() || undefined,
    );
    configuration.extractor = poolConfiguration(client.openai.GPT_6_LUNA);
    configuration.ambiguityResolver = client.openai.hasChatModelEndpoint(
        "GPT_6_1_SOL",
    )
        ? poolConfiguration("GPT_6_1_SOL")
        : [];
    const decision = client.createDecisionModel({ provider: "azure" });
    assert.ok(
        decision.success,
        "Azure native decision model is not configured",
    );
    configuration.decision = {
        provider: decision.data.provider,
        model: decision.data.model,
        members: client
            .discoverEndpointPoolFromConfig(
                effective,
                "azure",
                client.openai.ModelType.Decision,
                effective.decision?.azure?.deploymentKey ?? "decision_1",
            )
            .members.map(({ settings }) => benchmarkConfiguration(settings)),
    };
    let role = "startup";
    return {
        client,
        memory,
        configuration: JSON.parse(JSON.stringify(configuration)),
        checkpoint: await experimentCheckpoint(spec.productRoot),
        role: (next) => {
            role = next;
        },
        currentRole: () => role,
        open: (root, options) =>
            createDurableMemoryService(root, undefined, options),
    };
}

function assertRuntime(runtime, expected) {
    assert.deepEqual(
        Object.fromEntries(
            Object.entries(runtime.checkpoint).filter(
                ([file]) =>
                    !file.startsWith(
                        path.join("tools", "memory-maintenance-qualification") +
                            path.sep,
                    ),
            ),
        ),
        Object.fromEntries(
            Object.entries(expected.checkpoint).filter(
                ([file]) =>
                    !file.startsWith(
                        path.join("tools", "memory-maintenance-qualification") +
                            path.sep,
                    ),
            ),
        ),
        "Compiled implementation changed",
    );
    assert.deepEqual(
        runtime.configuration,
        expected.configuration,
        "Effective provider configuration changed",
    );
}

export async function prepareWikiExperiment(spec, runtime, signal) {
    const prepared = await loadPrepared({ datasetPath: spec.dataset });
    const templates = officialJudgeTemplates(
        await readFile(spec.judgeSource, "utf8"),
    );
    const selection = await readJson(spec.selectionManifest);
    const ids = new Set(wikiAdmissionCases.map(({ id }) => id));
    const manifest = await freezeWikiSeeds(
        spec.runDirectory,
        prepared,
        selection,
        runtime,
        signal,
        spec.reusePreparation
            ? {
                  directory: spec.reusePreparation,
                  manifest: await readJson(
                      path.join(spec.reusePreparation, "seeds.json"),
                  ),
              }
            : undefined,
        spec.caseIds,
    );
    await writeJson(path.join(spec.runDirectory, "evaluation.json"), {
        templates,
        questions: prepared.readerOnly.questions.filter((row) =>
            ids.has(row.question_id),
        ),
        references: prepared.evaluatorOnly.references.filter((row) =>
            ids.has(row.question_id),
        ),
    });
    return { outcome: manifest.status, histories: manifest.cases.length };
}

function configuredJudge(runtime, endpoint) {
    assert.ok(
        Array.isArray(runtime.configuration.writer) &&
            runtime.configuration.writer.length &&
            Array.isArray(runtime.configuration.ambiguityResolver),
        "Runtime writer and ambiguity resolver identities are required for independent judging",
    );
    assertIndependentWikiJudge(
        runtime.client,
        endpoint,
        [
            ...runtime.configuration.writer,
            ...runtime.configuration.ambiguityResolver,
        ].map((member) => member.endpointHash),
    );
    return runtime.client.openai.createChatModel(endpoint);
}

export async function runWikiTrial(
    spec,
    runtime,
    seed,
    trial,
    evaluation,
    signal,
    persist,
) {
    const model = configuredJudge(runtime, spec.judgeEndpoint);
    const directory = path.join(
        spec.runDirectory,
        `${trial.id}-${trial.arm}-${trial.repetition}`,
    );
    await mkdir(directory);
    trial.directory = path.basename(directory);
    trial.status = "preparing-clone";
    trial.startedEpochMs = Date.now();
    runtime.role(`trial:${trial.id}:${trial.arm}:r${trial.repetition}:clone`);
    const cloneStarted = performance.now();
    await persist();
    const opened = await cloneWikiSeed(
        spec.seeds,
        seed,
        path.join(directory, "store"),
        runtime,
        {
            wikiAdmissionExperiment: {
                arm: trial.arm,
                writerContract: spec.writerContract,
                ...(trial.arm === "D1"
                    ? {
                          treatmentRevision:
                              spec.d1Revision ?? "utility-gate-v1",
                      }
                    : {}),
                onDecision: (receipt) =>
                    writeTape(
                        path.join(directory, "decision-calls.jsonl"),
                        receipt,
                    ),
                onModelCall: (receipt) =>
                    writeTape(
                        path.join(directory, "model-calls.jsonl"),
                        receipt,
                    ),
                onAssessment: (receipt) =>
                    writeTape(
                        path.join(directory, "assessments.jsonl"),
                        receipt,
                    ),
            },
        },
    );
    const { service, release } = opened;
    trial.cloneMs = performance.now() - cloneStarted;
    const record = structuredClone(seed.record);
    delete record.knowledgeCheckpoint;
    delete record.knowledgeWait;
    const recordFile = path.join(directory, "benchmark.json");
    const controls = {
        signal,
        role: (stage) =>
            runtime.role(
                `trial:${trial.id}:${trial.arm}:r${trial.repetition}:${stage}`,
            ),
        persist: () => writeJson(recordFile, record),
        knowledgeTimeoutMs: spec.readinessMs,
        judge: async (reference, hypothesis, abortSignal) => {
            const result = await model.complete(
                judgePrompt(evaluation.templates, reference, hypothesis),
                undefined,
                undefined,
                undefined,
                abortSignal,
            );
            assert.ok(result.success, result.message);
            assert.match(result.data.trim(), /^(yes|no)[.!]?$/i);
            return {
                model: spec.judgeEndpoint,
                label: /^yes/i.test(result.data.trim()),
            };
        },
    };
    let failure;
    try {
        signal.throwIfAborted();
        trial.status = "running";
        await persist();
        const started = performance.now();
        release();
        if (spec.scope === "wiki") {
            record.knowledgeCheckpoint =
                await service.createKnowledgeCheckpoint({
                    corpusId: record.corpusId,
                    sourceIds: seed.inventory.map((source) => source.sourceId),
                    producerComplete: true,
                    families: ["wiki"],
                    timeoutMs: spec.readinessMs,
                });
            await prepareKnowledge(
                service,
                seed.construction,
                record,
                controls,
            );
            trial.readinessMs = performance.now() - started;
        } else {
            await executeMemoryCase(
                service,
                seed.construction,
                evaluation.questions.find(
                    (row) => row.question_id === trial.id,
                ),
                evaluation.references.find(
                    (row) => row.question_id === trial.id,
                ),
                record,
                controls,
            );
            trial.readinessMs = record.knowledgeReadinessMilliseconds;
        }
        trial.status = "complete";
    } catch (error) {
        failure = error;
        trial.operationFailure = { name: error.name, message: error.message };
        throw error;
    } finally {
        const cleanupErrors = [];
        try {
            await controls.persist();
            const snapshot = await service.listViews(record.corpusId);
            await writeJson(path.join(directory, "snapshot.json"), snapshot);
            await writeJson(
                path.join(directory, "builds.json"),
                await service.listViewBuilds(record.corpusId),
            );
            trial.pages = wikiPageInventory(snapshot).map((page) => ({
                viewId: page.viewId,
                revisionId: page.revisionId,
                state: page.state,
            }));
        } catch (error) {
            cleanupErrors.push(error);
        }
        try {
            await service.close();
        } catch (error) {
            cleanupErrors.push(error);
        }
        trial.finishedEpochMs = Date.now();
        trial.readinessOutcome = record.knowledgeWait?.outcome;
        if (cleanupErrors.length) {
            trial.cleanupFailures = cleanupErrors.map((error) => ({
                name: error.name,
                message: error.message,
            }));
            throw new AggregateError(
                failure ? [failure, ...cleanupErrors] : cleanupErrors,
                "Wiki trial export or close failed; original operation and cleanup errors retained",
            );
        }
    }
}

export async function runWikiExperiment(
    spec,
    runtime,
    signal,
    runTrial = runWikiTrial,
) {
    const seeds = await readJson(path.join(spec.seeds, "seeds.json"));
    assert.equal(
        seeds.status,
        "frozen",
        "All selected seeds must finish preparation before experiments",
    );
    assertRuntime(runtime, seeds);
    const evaluation = await readJson(path.join(spec.seeds, "evaluation.json"));
    const ids = spec.caseIds ?? [
        "4f54b7c9",
        ...seeds.questionIds.filter((id) => id !== "4f54b7c9"),
    ];
    if (spec.caseIds)
        assert.ok(
            ids.every((id) => seeds.questionIds.includes(id)),
            "Unknown selected case",
        );
    const state = {
        schemaVersion: 1,
        d1Revision: spec.d1Revision ?? "utility-gate-v1",
        writerContract: spec.writerContract,
        scope: spec.scope,
        execution: "live",
        status: "running",
        seedsHash: digest(JSON.stringify(seeds)),
        configuration: runtime.configuration,
        checkpoint: runtime.checkpoint,
        seedCheckpoint: seeds.checkpoint,
        repetitions: spec.repetitions,
        counterbalanceCases: spec.counterbalanceCases ?? false,
        readinessLimitMs: spec.readinessMs,
        qualification:
            "Unqualified until independent adjudication and live quality gates pass",
        trials: wikiTrialSchedule(
            ids,
            spec.repetitions,
            spec.counterbalanceCases ?? false,
        )
            .filter((row) => !spec.arms || spec.arms.includes(row.arm))
            .map((row) => ({
                ...row,
                treatmentRevision:
                    row.arm === "D1"
                        ? (spec.d1Revision ?? "utility-gate-v1")
                        : "utility-gate-v1",
                writerContract: spec.writerContract,
                status: "not-attempted",
            })),
    };
    const persist = () =>
        writeJson(path.join(spec.runDirectory, "campaign.json"), state);
    await persist();
    for (const trial of state.trials) {
        if (signal.aborted) break;
        const seed = seeds.cases.find((entry) => entry.id === trial.id);
        try {
            await runTrial(
                spec,
                runtime,
                seed,
                trial,
                evaluation,
                signal,
                persist,
            );
        } catch (error) {
            trial.status =
                signal.aborted ||
                ["timed-out", "interrupted"].includes(trial.readinessOutcome)
                    ? "censored"
                    : "failed";
            trial.finishedEpochMs ??= Date.now();
            trial.error = { name: error.name, message: error.message };
        }
        await persist();
        if (trial.cleanupFailures?.length)
            throw new Error(
                "Cannot continue after trial export or close failed",
            );
        assert.deepEqual(
            await experimentCheckpoint(spec.productRoot),
            runtime.checkpoint,
            "Implementation changed during live experiment",
        );
    }
    state.status = state.trials.every((trial) => trial.status === "complete")
        ? "completed"
        : "completed-with-failures-or-unattempted";
    state.paired = pairedWikiResults(state.trials);
    await persist();
    return state;
}

export async function replayWikiAssessments(spec, runtime, signal) {
    const tape = (await readFile(spec.tape, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    const inputs = new Map(tape.map((row) => [row.requestHash, row]));
    const receipts = [];
    const failures = [];
    const annotations = spec.annotations
        ? await readJson(spec.annotations)
        : undefined;
    const report = {
        execution: "live-common-input-diagnostics",
        qualityQualified: false,
        configuration: runtime.configuration,
        checkpoint: runtime.checkpoint,
        status: "running",
        failures,
        uniqueInputs: inputs.size,
    };
    const persist = async () => {
        const attemptedAnnotations = annotations && {
            ...annotations,
            items: annotations.items.filter((item) =>
                receipts.some((row) => row.requestHash === item.requestHash),
            ),
        };
        report.agreement = decisionAgreement(receipts, attemptedAnnotations);
        report.pairedLatency = pairedAssessmentLatency(receipts);
        await writeJson(path.join(spec.runDirectory, "agreement.json"), report);
    };
    // Validate annotations against all captured inputs, including inputs not yet replayed.
    if (annotations) decisionAgreement([...inputs.values()], annotations);
    await writeJson(path.join(spec.runDirectory, "agreement.json"), report);
    for (const row of inputs.values()) {
        if (signal.aborted) break;
        for (const arm of spec.arms ?? ["G0", "G1", "D1"]) {
            if (signal.aborted) break;
            const adapter = runtime.memory.createConfiguredViewSynthesisAdapter(
                process.env.TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT?.trim() ||
                    undefined,
                4000,
                undefined,
                undefined,
                {
                    arm,
                    writerContract: spec.writerContract,
                    ...(arm === "D1"
                        ? {
                              treatmentRevision:
                                  spec.d1Revision ?? "utility-gate-v1",
                          }
                        : {}),
                    onDecision: (receipt) =>
                        writeTape(
                            path.join(
                                spec.runDirectory,
                                "decision-calls.jsonl",
                            ),
                            receipt,
                        ),
                    onModelCall: (receipt) =>
                        writeTape(
                            path.join(spec.runDirectory, "model-calls.jsonl"),
                            receipt,
                        ),
                    onAssessment: (receipt) => {
                        receipts.push(receipt);
                        writeTape(
                            path.join(spec.runDirectory, "assessments.jsonl"),
                            receipt,
                        );
                    },
                },
            );
            try {
                await adapter.assessWikiSubject(row.input, row.pages, signal);
            } catch (error) {
                failures.push({
                    requestHash: row.requestHash,
                    arm,
                    onModelCall: (receipt) =>
                        writeTape(
                            path.join(
                                spec.runDirectory,
                                "warmup-model-calls.jsonl",
                            ),
                            receipt,
                        ),
                    name: error.name,
                    message: error.message,
                });
            }
            await persist();
        }
    }
    report.status = signal.aborted
        ? "censored"
        : failures.length
          ? "completed-with-failures"
          : "completed";
    report.unattempted =
        inputs.size * (spec.arms?.length ?? 3) - receipts.length;
    await persist();
    return report;
}

export async function warmWikiModels(spec, runtime, signal) {
    const text =
        "Synthetic warm-up example: copper and tin form bronze. This is an explanatory example, not a recorded experiment.";
    const input = {
        corpusId: "warmup",
        actor: "qualification",
        expectedVersion: 0,
        bounds: {},
        pipeline: "informational-wiki-v1",
        model: "warmup",
        fingerprint: "warmup",
        definition: {
            viewId: "warmup",
            kind: "wiki",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "synthetic", revisionId: "r1" }],
            },
            wiki: {
                construction: "informational-wiki-v1",
                query: "bronze alloys",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        inputs: [
            {
                sourceId: "synthetic",
                revisionId: "r1",
                title: "Synthetic warm-up",
                content: text,
                contentHash: digest(text),
                passages: [
                    {
                        sourceId: "synthetic",
                        revisionId: "r1",
                        locator: "indexed:0",
                        excerpt: text,
                    },
                ],
            },
        ],
    };
    for (const arm of spec.arms ?? ["G0", "G1", "D1"]) {
        signal.throwIfAborted();
        runtime.role(`excluded-warmup:${arm}`);
        const adapter = runtime.memory.createConfiguredViewSynthesisAdapter(
            process.env.TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT?.trim() ||
                undefined,
            4000,
            undefined,
            undefined,
            {
                arm,
                writerContract: spec.writerContract,
                ...(arm === "D1"
                    ? {
                          treatmentRevision:
                              spec.d1Revision ?? "utility-gate-v1",
                      }
                    : {}),
                onDecision: (receipt) =>
                    writeTape(
                        path.join(
                            spec.runDirectory,
                            "warmup-decision-calls.jsonl",
                        ),
                        receipt,
                    ),
                onAssessment: (receipt) =>
                    writeTape(
                        path.join(spec.runDirectory, "warmups.jsonl"),
                        receipt,
                    ),
            },
        );
        await adapter.assessWikiSubject(input, [], signal);
    }
}

async function worker(spec) {
    validateWikiExperimentSpec(spec);
    await assertPrivateArtifactDirectory(spec.runDirectory);
    const runtime = await loadWikiRuntime(spec);
    assert.deepEqual(runtime.checkpoint, spec.expectedCheckpoint.hashes);
    const admittedEpochMs = Date.now();
    await writeJson(path.join(spec.runDirectory, "admitted.json"), {
        receiptId: spec.receiptId,
        workerPid: process.pid,
        admittedEpochMs,
        workDeadlineEpochMs: admittedEpochMs + spec.workAllowanceMs,
        checkpointExpectationHash: checkpointExpectationHash(
            spec.expectedCheckpoint,
        ),
        compiledHashesHash: digest(JSON.stringify(runtime.checkpoint)),
    });
    const signal = AbortSignal.timeout(
        Math.max(
            1,
            Math.min(
                admittedEpochMs + spec.workAllowanceMs,
                spec.spawnedEpochMs + spec.totalAllowanceMs,
            ) -
                Date.now() -
                120000,
        ),
    );
    const events = [];
    const restore = observeProvider(events, runtime.currentRole);
    try {
        if (spec.command === "run")
            assertRuntime(
                runtime,
                await readJson(path.join(spec.seeds, "seeds.json")),
            );
        if (["run", "replay"].includes(spec.command))
            await warmWikiModels(spec, runtime, signal);
        const actions = {
            prepare: prepareWikiExperiment,
            run: runWikiExperiment,
            replay: replayWikiAssessments,
            judge: runWikiJudges,
        };
        const result = await actions[spec.command](spec, runtime, signal);
        await writeJson(path.join(spec.runDirectory, "result.json"), result);
        if (
            result.status &&
            !["completed", "completed-pending-human-adjudication"].includes(
                result.status,
            )
        )
            process.exitCode = 1;
    } catch (error) {
        await writeJson(path.join(spec.runDirectory, "result.json"), {
            outcome: "failed",
            component: "wiki-admission-experiment",
            stage: runtime.currentRole(),
            name: error.name,
            message: error.message,
        });
        throw error;
    } finally {
        restore();
        await writeJson(
            path.join(spec.runDirectory, "provider-attempts.json"),
            events,
        );
    }
}

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            spec: { type: "string" },
            dataset: { type: "string" },
            "judge-source": { type: "string" },
            "selection-manifest": { type: "string" },
            "reuse-preparation": { type: "string" },
            "judge-endpoint": { type: "string" },
            "d1-revision": { type: "string", default: "utility-gate-v1" },
            "writer-contract": { type: "string" },
            "quality-mode": { type: "string" },
            "ledger-source": { type: "string" },
            "ledger-source-hash": { type: "string" },
            "include-censored-snapshots": { type: "boolean", default: false },
            output: { type: "string" },
            seeds: { type: "string" },
            tape: { type: "string" },
            annotations: { type: "string" },
            campaign: { type: "string" },
            scope: { type: "string", default: "full" },
            repetitions: { type: "string", default: "3" },
            "counterbalance-cases": { type: "boolean", default: false },
            arms: { type: "string", default: "G0,G1,D1" },
            cases: { type: "string" },
            "include-failed-candidates": { type: "boolean", default: false },
            "include-failed-baselines": { type: "boolean", default: false },
            "readiness-minutes": { type: "string", default: "60" },
            minutes: { type: "string", default: "360" },
            "authorized-live-benchmark": { type: "boolean", default: false },
        },
    });
    if (values.spec) return worker(await readJson(values.spec));
    const command = positionals[0];
    assert.ok(
        ["prepare", "run", "replay", "judge"].includes(command),
        "Use prepare, run, replay or judge; see the experiment README",
    );
    assert.equal(
        values["authorized-live-benchmark"],
        true,
        "Explicit live inference authorization required",
    );
    assert.ok(
        values.output,
        "--output must name a new private artifact directory",
    );
    const runDirectory = path.resolve(values.output);
    await assertPrivateArtifactDirectory(runDirectory);
    await mkdir(runDirectory);
    const receiptId = randomUUID();
    await writeJson(path.join(runDirectory, "ownership.json"), {
        receiptId,
        runDirectory,
    });
    const spec = {
        command,
        productRoot,
        runDirectory,
        receiptId,
        authorizedLiveBenchmark: true,
        resume: false,
        dataset: values.dataset && path.resolve(values.dataset),
        judgeSource:
            values["judge-source"] && path.resolve(values["judge-source"]),
        selectionManifest:
            values["selection-manifest"] &&
            path.resolve(values["selection-manifest"]),
        reusePreparation:
            values["reuse-preparation"] &&
            path.resolve(values["reuse-preparation"]),
        seeds: values.seeds && path.resolve(values.seeds),
        campaign: values.campaign && path.resolve(values.campaign),
        tape: values.tape && path.resolve(values.tape),
        annotations: values.annotations && path.resolve(values.annotations),
        judgeEndpoint: values["judge-endpoint"],
        d1Revision: values["d1-revision"],
        writerContract: values["writer-contract"],
        qualityMode: values["quality-mode"],
        ledgerSource:
            values["ledger-source"] && path.resolve(values["ledger-source"]),
        ledgerSourceHash: values["ledger-source-hash"],
        includeCensoredSnapshots: values["include-censored-snapshots"],
        scope: values.scope,
        repetitions: Number(values.repetitions),
        counterbalanceCases: values["counterbalance-cases"],
        arms: values.arms.split(","),
        caseIds: values.cases?.split(","),
        includeFailedCandidates: values["include-failed-candidates"],
        includeFailedBaselines: values["include-failed-baselines"],
        readinessMs: Number(values["readiness-minutes"]) * 60000,
        workAllowanceMs: Number(values.minutes) * 60000,
        totalAllowanceMs: Number(values.minutes) * 60000,
        startupAllowanceMs: 120000,
        expectedCheckpoint: {
            name: "wiki-admission-frozen",
            hashes: await experimentCheckpoint(productRoot),
        },
    };
    const result = await supervise(
        spec,
        path.resolve(process.argv[1]),
        validateWikiExperimentSpec,
    );
    process.stdout.write(`${JSON.stringify({ runDirectory, ...result })}\n`);
    process.exitCode = result.exit?.code === 0 ? 0 : 1;
}

function validateQualitySpec(spec) {
    if (spec.qualityMode !== undefined)
        assert.ok(
            [
                "generative-v1",
                "decision-first-v2",
                "generative-staged-v2",
            ].includes(spec.qualityMode),
            "Unsupported quality evaluator",
        );
    if (spec.ledgerSource || spec.ledgerSourceHash) {
        assert.equal(spec.command, "judge");
        assert.equal(spec.qualityMode, "generative-staged-v2");
        assert.ok(
            spec.ledgerSource && /^[a-f0-9]{64}$/.test(spec.ledgerSourceHash),
            "Ledger reuse requires a file and its exact canonical JSON SHA-256",
        );
    }
}

export function validateWikiExperimentSpec(spec) {
    assert.equal(spec.authorizedLiveBenchmark, true);
    assert.ok(["prepare", "run", "replay", "judge"].includes(spec.command));
    assert.ok(["full", "wiki"].includes(spec.scope));
    if (spec.writerContract !== undefined)
        assert.ok(
            spec.writerContract === "shared-prose-v1" &&
                (!(spec.arms ?? ["G0", "G1", "D1"]).includes("D1") ||
                    spec.d1Revision === "decision-first-v2"),
            "Shared prose requires the versioned contract and native D1-v2 completeness",
        );
    assert.ok(
        ["utility-gate-v1", "decision-first-v2"].includes(
            spec.d1Revision ?? "utility-gate-v1",
        ),
        "Unsupported D1 revision",
    );
    validateQualitySpec(spec);
    if (spec.arms)
        assert.ok(
            Array.isArray(spec.arms) &&
                spec.arms.length &&
                spec.arms.every((arm) => ["G0", "G1", "D1"].includes(arm)) &&
                new Set(spec.arms).size === spec.arms.length,
            "Arms must be a nonempty distinct subset of G0,G1,D1",
        );
    if (spec.caseIds)
        assert.ok(
            Array.isArray(spec.caseIds) &&
                spec.caseIds.length &&
                spec.caseIds.every((id) =>
                    wikiAdmissionCases.some((entry) => entry.id === id),
                ) &&
                new Set(spec.caseIds).size === spec.caseIds.length,
            "Cases must be a nonempty distinct subset of the five pinned IDs",
        );
    if (spec.counterbalanceCases !== undefined)
        assert.equal(typeof spec.counterbalanceCases, "boolean");
    for (const field of ["repetitions", "readinessMs", "workAllowanceMs"])
        assert.ok(
            Number.isSafeInteger(spec[field]) && spec[field] > 0,
            `Invalid ${field}`,
        );
    assert.ok(spec.workAllowanceMs > 120000, "Reserve two minutes for cleanup");
    assert.ok(
        spec.workAllowanceMs <= 6 * 3600000 &&
            (spec.totalAllowanceMs ?? spec.workAllowanceMs) <= 6 * 3600000,
        "Experiment stage cannot exceed six hours",
    );
    assert.ok(
        spec.readinessMs <= 3600000,
        "Knowledge readiness timeout cannot exceed 60 minutes",
    );
    if (spec.command === "prepare")
        assert.ok(spec.dataset && spec.judgeSource && spec.selectionManifest);
    if (spec.command === "run") assert.ok(spec.seeds && spec.judgeEndpoint);
    if (spec.command === "replay") assert.ok(spec.tape);
    if (spec.command === "judge")
        assert.ok(spec.seeds && spec.campaign && spec.judgeEndpoint);
}

export async function assertPrivateArtifactDirectory(directory) {
    let cursor = path.resolve(directory);
    while (true) {
        try {
            cursor = await realpath(cursor);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        let gitEntry;
        try {
            gitEntry = await lstat(path.join(cursor, ".git"));
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        assert.ok(
            !gitEntry,
            "Raw experiment artifacts must be outside every Git checkout",
        );
        const parent = path.dirname(cursor);
        if (parent === cursor) return;
        cursor = parent;
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    await main();
