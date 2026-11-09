// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
    closeSync,
    createReadStream,
    openSync,
    writeFileSync,
    writeSync,
} from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { liveDependencyCheckpoint } from "./live-stages.mjs";
import { writeJson } from "./harness.mjs";
import {
    benchmarkProviderConfiguration,
    benchmarkFailure,
    loadPrepared,
} from "./longmemeval-live.mjs";
import {
    digest,
    embeddingConfigurationHash,
    encode,
    freezePilot,
    openPilot,
    readJson,
    replayTape,
    runtimeConfigurationHash,
    validateApproval,
    writeNew,
    indexingTreatments,
    parallelTreatmentNames,
    productionSchedule,
} from "./longmemeval-indexing-contract.mjs";
import {
    productModules,
    verifyReplay,
} from "./longmemeval-indexing-storage.mjs";
import {
    frameEdges,
    frameInventory,
    frameSnapshot,
    normalizationEdges,
} from "./longmemeval-indexing-frames.mjs";
import {
    preparationFaults,
    recoveryMatrix,
    restoreFaults,
} from "./longmemeval-indexing-recovery.mjs";
import {
    admitCompanion,
    companionSettings,
    recordCompanionWork,
    superviseCompanion,
} from "./longmemeval-indexing-execution.mjs";
import { createTraceSummary } from "./longmemeval-indexing-traces.mjs";

const toolRoot = fileURLToPath(new URL(".", import.meta.url));
const defaultProduct = fileURLToPath(new URL("../../", import.meta.url));
const compiledRoots = [
    "knowPro",
    "memory/storage",
    "memory/conversation",
    "memory/service",
    "agentServer/server",
    "aiclient",
    "config",
];

export async function checkpoint(product) {
    const root = await realProduct(product);
    const hashes = {};
    async function visit(relative) {
        for (const entry of await readdir(path.join(root, relative), {
            withFileTypes: true,
        })) {
            const next = path.join(relative, entry.name);
            if (entry.isDirectory()) await visit(next);
            else if (entry.name.endsWith(".js"))
                hashes[next] = digest(await readFile(path.join(root, next)));
        }
    }
    for (const location of compiledRoots)
        await visit(path.join("packages", ...location.split("/"), "dist"));
    const engine = {};
    for (const name of (await readdir(toolRoot))
        .filter((name) => name.endsWith(".mjs"))
        .sort())
        engine[name] = digest(await readFile(path.join(toolRoot, name)));
    return {
        revision: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
        }).trim(),
        platform: process.platform,
        node: process.version,
        hashes,
        engine,
    };
}
async function realProduct(product) {
    const { realpath } = await import("node:fs/promises");
    const root = await realpath(product);
    const dirty = execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
    });
    assert.equal(
        dirty.trim(),
        "",
        "Freeze only a clean committed product checkout",
    );
    return root;
}

async function approved(pilot, product, approvalFile) {
    assert.ok(approvalFile, "Live execution requires a separate approval JSON");
    const actual = await checkpoint(product);
    assert.deepEqual(
        actual,
        pilot.manifest.checkpoint,
        "Frozen product checkpoint changed",
    );
    const approval = await readJson(approvalFile);
    validateApproval(approval, digest(encode(pilot.manifest)), actual);
    const modules = await productModules(product);
    modules.config.loadConfigSync();
    modules.client.initRuntimeConfigFromProcessEnv();
    const configured = benchmarkProviderConfiguration(modules.client);
    assert.equal(
        digest(encode(configured)),
        approval.chatConfigurationHash,
        "Approved chat configuration changed",
    );
    assert.equal(
        digest(encode(await liveDependencyCheckpoint(product))),
        approval.dependencyHash,
        "Approved dependencies changed",
    );
    assert.equal(
        embeddingConfigurationHash(modules.client, modules.config),
        approval.embeddingConfigurationHash,
        "Approved embedding configuration changed",
    );
    assert.equal(
        runtimeConfigurationHash(modules.client, modules.config),
        approval.runtimeConfigurationHash,
        "Approved runtime configuration changed",
    );
    return { approval, modules };
}

export async function preflight(pilot, product) {
    assert.deepEqual(await checkpoint(product), pilot.manifest.checkpoint);
    const modules = await productModules(product);
    modules.config.loadConfigSync();
    modules.client.initRuntimeConfigFromProcessEnv();
    return {
        schemaVersion: 1,
        manifestHash: digest(encode(pilot.manifest)),
        checkpointHash: digest(encode(pilot.manifest.checkpoint)),
        chatConfigurationHash: digest(
            encode(benchmarkProviderConfiguration(modules.client)),
        ),
        dependencyHash: digest(encode(await liveDependencyCheckpoint(product))),
        embeddingConfigurationHash: embeddingConfigurationHash(
            modules.client,
            modules.config,
        ),
        runtimeConfigurationHash: runtimeConfigurationHash(
            modules.client,
            modules.config,
        ),
        publicDatasetApproved: false,
        configuredProvidersApproved: false,
        acceptNoMonetaryCap: false,
        workMinutes: 15,
        unlimitedWorkApproved: false,
        knowledgeMinutes: 10,
        companionPreparationApproved: false,
        liveCancellationApproved: false,
        sourceInventory: pilot.manifest.inventory,
        note: "Approval template only. No inference performed; false fields require explicit operator approval.",
    };
}

export function productionPlan(pilot) {
    const comparison = pilot.inputs?.comparison ?? "prepared-indexing";
    const schedule = productionSchedule(comparison);
    if (pilot.manifest.schedule)
        assert.deepEqual(
            pilot.manifest.schedule,
            schedule,
            "Frozen arm schedule changed",
        );
    assert.ok(
        pilot.inputs?.firstCaseOnly === undefined ||
            typeof pilot.inputs.firstCaseOnly === "boolean",
        "Invalid frozen first-case selection",
    );
    return {
        comparison,
        schedule,
        questionIds: pilot.inputs?.firstCaseOnly
            ? pilot.manifest.questionIds.slice(0, 1)
            : pilot.manifest.questionIds,
    };
}

export function productionArmEnvironment(
    pilot,
    arm,
    environment = process.env,
) {
    const { comparison, schedule } = productionPlan(pilot);
    assert.ok(schedule.includes(arm), "Choose a frozen production arm");
    const env = { ...environment, TYPEAGENT_MEMORY_SEARCH_TRACE: "1" };
    if (comparison !== "prepared-indexing") {
        assert.equal(
            env.TYPEAGENT_MEMORY_TOPIC_CONCURRENCY,
            undefined,
            "Parallel indexing comparison requires default topic concurrency",
        );
        env.TYPEAGENT_MEMORY_PREPARED_INDEXING = "1";
        const experiments = (env.TYPEAGENT_MEMORY_PERF_EXPERIMENTS ?? "")
            .split(",")
            .map((name) => name.trim())
            .filter(
                (name) =>
                    name &&
                    name !== "indexing-parallel" &&
                    !parallelTreatmentNames.includes(name),
            );
        const treatment = {
            A1: "indexing-parallel",
            T1: "topic-parallel",
            S1: "synopsis-parallel",
            E1: "embedding-parallel",
        }[arm];
        if (treatment) experiments.push(treatment);
        env.TYPEAGENT_MEMORY_PERF_EXPERIMENTS = experiments.join(",");
    } else if (arm === "A1") env.TYPEAGENT_MEMORY_PREPARED_INDEXING = "1";
    else delete env.TYPEAGENT_MEMORY_PREPARED_INDEXING;
    return env;
}

async function childAttempt(product, pilot, approval, arm) {
    const plan = productionPlan(pilot);
    const ordinal = plan.schedule.indexOf(arm);
    assert.ok(ordinal >= 0, "Choose a frozen production arm");
    for (const key of ["datasetPath", "judgePath"]) {
        assert.equal(
            typeof pilot.inputs[key],
            "string",
            `Missing frozen input: ${key}`,
        );
        assert.ok(
            path.isAbsolute(pilot.inputs[key]),
            `Frozen input must be absolute: ${key}`,
        );
    }
    if (ordinal > 0)
        assert.ok(
            ["completed", "failed"].includes(
                (
                    await readJson(
                        path.join(
                            pilot.root,
                            plan.schedule[ordinal - 1],
                            "attempt.json",
                        ),
                    )
                ).status,
            ),
            "Run the preceding frozen arm first",
        );
    const directory = path.join(pilot.root, arm);
    await mkdir(directory);
    const env = productionArmEnvironment(pilot, arm);
    const args = [
        path.join(toolRoot, "longmemeval-live.mjs"),
        "--product",
        product,
        "--dataset",
        pilot.inputs.datasetPath,
        "--judge-source",
        pilot.inputs.judgePath,
        "--output",
        directory,
        "--question-ids",
        plan.questionIds.join(","),
        "--max-questions",
        String(plan.questionIds.length),
        "--work-minutes",
        approval.workMinutes === null
            ? "unlimited"
            : String(approval.workMinutes),
        "--knowledge-minutes",
        String(approval.knowledgeMinutes ?? 10),
        "--authorized-live-benchmark",
        "--indexing-pilot",
        "--indexing-comparison",
        plan.comparison,
        "--expected-configuration-hash",
        approval.chatConfigurationHash,
        "--expected-dependency-hash",
        approval.dependencyHash,
        "--expected-embedding-configuration-hash",
        approval.embeddingConfigurationHash,
        "--expected-runtime-configuration-hash",
        approval.runtimeConfigurationHash,
    ];
    const started = Date.now();
    const attemptFile = path.join(directory, "attempt.json");
    const attempt = {
        arm,
        started,
        status: "running",
        outcome: "not-observed",
    };
    await writeNew(attemptFile, attempt);
    const fd = openSync(path.join(directory, "private-output.log"), "wx");
    let announced;
    let buffer = "";
    let outputError;
    const child = spawn(process.execPath, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
    });
    const record = (chunk) => {
        try {
            writeSync(fd, chunk);
        } catch (error) {
            outputError = error;
            child.kill("SIGTERM");
        }
    };
    child.stderr.on("data", record);
    child.stdout.on("data", (chunk) => {
        record(chunk);
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines)
            if (line.startsWith('{"kind":"run-directory",')) {
                try {
                    announced = JSON.parse(line).runDirectory;
                } catch (error) {
                    outputError = error;
                    child.kill("SIGTERM");
                }
            }
    });
    let termination;
    try {
        termination = await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code, signal) => resolve({ code, signal }));
        });
        if (outputError) throw outputError;
        assert.ok(
            announced,
            "Live runner did not announce its owned directory",
        );
        const relative = path.relative(directory, announced);
        assert.ok(
            relative &&
                !relative.startsWith("..") &&
                !path.isAbsolute(relative),
            "Unowned live run directory",
        );
        const state = await readJson(
            path.join(announced, "benchmark-state.json"),
        );
        assert.equal(
            state.arm.preparedIndexing,
            env.TYPEAGENT_MEMORY_PREPARED_INDEXING === "1",
        );
        if (plan.comparison === "indexing-parallel")
            assert.equal(state.arm.indexingParallel, arm === "A1");
        assert.deepEqual(state.arm.indexingTreatments, indexingTreatments(env));
        assert.equal(state.arm.searchTrace, true);
        assert.equal(state.arm.indexingLifecycle, true);
        assert.equal(state.arm.caseStoreIsolation, "fresh-store-per-case");
        Object.assign(attempt, {
            termination,
            outcome: state.outcome,
            stateDirectory: relative,
        });
        const traceSummaries = await readTraceSummaries(announced);
        const prepared = traceSummaries.some(
            (span) => span.stage === "ingestion.unit.prepare",
        );
        if (state.outcome === "DIAGNOSTIC_SELECTION_COMPLETED")
            assert.equal(
                prepared,
                env.TYPEAGENT_MEMORY_PREPARED_INDEXING === "1",
                "Ingestion traces did not confirm the requested preparation arm",
            );
        await writeNew(
            path.join(directory, "indexing-traces.json"),
            traceSummaries,
        );
        attempt.preparedTraceObserved = prepared;
        assert.equal(
            termination.code,
            0,
            "Live benchmark failed; inspect private attempt artifacts",
        );
        assert.deepEqual(
            await checkpoint(product),
            pilot.manifest.checkpoint,
            "Checkpoint changed during live work",
        );
        attempt.status = "completed";
    } catch (error) {
        attempt.status = "failed";
        attempt.failure = benchmarkFailure(error);
        throw error;
    } finally {
        closeSync(fd);
        attempt.elapsedMs = Date.now() - started;
        await writeJson(attemptFile, attempt);
    }
}

export async function traceRun(kp, work, traceFile) {
    const trace = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
    const warn = console.warn;
    const collector = createTraceSummary();
    const fd = traceFile === undefined ? undefined : openSync(traceFile, "wx");
    const chunks = [];
    let buffered = 0;
    const flush = () => {
        if (fd !== undefined && chunks.length) {
            writeFileSync(fd, chunks.join(""));
            chunks.length = 0;
            buffered = 0;
        }
    };
    console.warn = (...args) => {
        const line = String(args[0]);
        if (line.startsWith("[memory-search-timing] ")) {
            const json = line.slice("[memory-search-timing] ".length);
            collector.add(JSON.parse(json));
            if (fd !== undefined) {
                chunks.push(json + "\n");
                buffered += json.length + 1;
                if (buffered >= 65536) flush();
            }
        } else Reflect.apply(warn, console, args);
    };
    process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
    try {
        return {
            result: await kp.runWithSearchTiming(
                undefined,
                "indexing-companion",
                work,
            ),
            traceSummaries: collector.summaries(),
            rawTraceFile:
                traceFile === undefined ? null : path.basename(traceFile),
        };
    } finally {
        console.warn = warn;
        if (trace === undefined)
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = trace;
        if (fd !== undefined) {
            try {
                flush();
            } finally {
                closeSync(fd);
            }
        }
    }
}

export async function readTraceSummaries(directory) {
    const collector = createTraceSummary();
    const marker = "[memory-search-timing] ";
    const files = (await readdir(directory))
        .filter((name) => /^(stderr|stdout)-.*\.log$/.test(name))
        .sort();
    for (const file of files) {
        const stream = createReadStream(path.join(directory, file), {
            encoding: "utf8",
        });
        try {
            for await (const line of createInterface({
                input: stream,
                crlfDelay: Infinity,
            }))
                if (line.startsWith(marker))
                    collector.add(JSON.parse(line.slice(marker.length)));
        } finally {
            stream.destroy();
        }
    }
    return collector.summaries();
}

export async function qualifyCompanion(
    modules,
    product,
    directory,
    construction,
    prepared,
) {
    assert.equal(
        prepared.sourceHash,
        digest(encode(construction)),
        "Captured preparation belongs to another history",
    );
    const traced = await traceRun(
        modules.kp,
        async () => ({
            frameInventory: frameInventory(modules, construction),
            frameEdges: frameEdges(modules),
            frameSnapshot: frameSnapshot(
                modules,
                path.join(directory, "frame-snapshot.db"),
            ),
            normalization: normalizationEdges(modules),
            replay: await verifyReplay(
                modules,
                directory,
                prepared,
                replayTape,
            ),
            crashes: await recoveryMatrix(
                modules,
                product,
                directory,
                prepared,
            ),
            preparation: await preparationFaults(modules, directory, prepared),
            restore: await restoreFaults(modules, directory, prepared),
        }),
        path.join(directory, "qualification-traces.jsonl"),
    );
    return {
        schemaVersion: 2,
        providerMode: "provider-replay",
        ...traced,
        liveCancellation: "not-run-requires-separate-approval",
        baselineComparison: "not-run",
    };
}

async function runCompanion(pilot, product, approvalFile) {
    const { approval } = await approved(pilot, product, approvalFile);
    assert.equal(
        approval.companionPreparationApproved,
        true,
        "Companion live work requires its own allowance",
    );
    await superviseCompanion(
        pilot,
        product,
        approvalFile,
        approval,
        fileURLToPath(import.meta.url),
    );
}

async function companionWorker(spec) {
    const pilot = await openPilot(spec.pilotDirectory);
    const { approval, modules } = await approved(
        pilot,
        spec.productRoot,
        spec.approvalFile,
    );
    assert.equal(approval.companionPreparationApproved, true);
    const signal = await admitCompanion(spec, approval);
    const directory = path.join(pilot.root, "companion");
    const construction = pilot.construction.find(
        (row) => row.id === pilot.manifest.companionId,
    );
    const tape = replayTape([], true);
    await recordCompanionWork(
        modules,
        directory,
        construction,
        () => companionSettings(modules, signal),
        tape,
        (prepared) =>
            qualifyCompanion(
                modules,
                spec.productRoot,
                directory,
                construction,
                prepared,
            ),
        approval.liveCancellationApproved
            ? () => companionSettings(modules, signal)
            : undefined,
        async () =>
            assert.deepEqual(
                await checkpoint(spec.productRoot),
                pilot.manifest.checkpoint,
                "Checkpoint changed during companion work",
            ),
    );
}

export async function reportPilot(pilot) {
    const arms = [];
    for (const arm of pilot.manifest.schedule) {
        arms.push(await armReport(pilot, arm));
    }
    const companion = await optionalJson(
        path.join(pilot.root, "companion", "qualification.json"),
    );
    const frames = await optionalJson(
        path.join(pilot.root, "frame-comparison", "frames.json"),
    );
    const human = await optionalJson(path.join(pilot.root, "review.json"));
    const complete = arms.every(
        (arm) =>
            arm.status === "completed" &&
            arm.outcome === "DIAGNOSTIC_SELECTION_COMPLETED" &&
            arm.cases?.every((row) => row.status === "complete"),
    );
    if (human) validateReview(pilot, arms, human);
    return {
        schemaVersion: 1,
        productionPlan: productionPlan(pilot),
        manifestHash: digest(encode(pilot.manifest)),
        arms,
        companion,
        frames,
        correctness:
            complete && human
                ? "live-cases-independently-reviewed; inspect-per-case-outcomes"
                : complete
                  ? "requires-independent-evidence-review"
                  : "incomplete",
        recovery: companion
            ? { replay: "passed", liveCancellation: companion.liveCancellation }
            : "incomplete",
        performance: "descriptive-only; no-speedup-or-tail-latency-claim",
        pairedPerformance:
            productionPlan(pilot).comparison === "indexing-ablation"
                ? Object.fromEntries(
                      pilot.manifest.schedule
                          .slice(1)
                          .map((arm) => [
                              arm,
                              treatmentPerformance(
                                  arms,
                                  productionPlan(pilot).questionIds,
                                  arm,
                              ),
                          ]),
                  )
                : pairedPerformance(arms, productionPlan(pilot).questionIds),
        humanReview: human ?? "not-recorded",
        actualArmOrder: arms
            .filter((arm) => arm.started)
            .sort((a, b) => a.started - b.started)
            .map((arm) => arm.arm),
        companionAttempt: await optionalJson(
            path.join(pilot.root, "companion-attempt", "work.json"),
        ),
        companionTermination: await optionalJson(
            path.join(pilot.root, "companion-attempt", "termination.json"),
        ),
        limitations: [
            `${productionPlan(pilot).questionIds.length} complete selected histories scheduled for production`,
            "no official 500-question score",
            "no enforced monetary cap",
            "platform-specific until separately executed",
            `Frozen arm order ${pilot.manifest.schedule.join(" then ")}, not case-interleaved`,
            "Raw answer latencies only; no pilot p95",
            "Provider transport failures may have unobserved cost",
        ],
    };
}

export function pairedPerformance(arms, ids) {
    const selectors = {
        ingestionMs: (row) => row?.ingestionMilliseconds,
        knowledgeReadinessMs: (row) => row?.knowledgeReadinessMilliseconds,
        answerMs: (row) => row?.answerMilliseconds,
        reloadAndQueryMs: (row) => row?.indexingLifecycle?.reloadAndQueryMs,
        executionMs: (row) => row?.indexingMetrics?.elapsedMs,
    };
    const pairs = ids.map((id) => {
        const [a0, a1] = ["A0", "A1"].map((arm) =>
            arms.find((entry) => entry.arm === arm),
        );
        const [before, after] = [a0, a1].map((arm) =>
            arm?.cases?.find((row) => row.id === id),
        );
        const comparable =
            [a0, a1].every((arm) => arm?.status === "completed") &&
            [before, after].every((row) => row?.status === "complete");
        const measurements = Object.fromEntries(
            Object.entries(selectors).map(([name, select]) => {
                const [A0, A1] = [before, after].map((row) =>
                    observedDuration(select(row)),
                );
                return [
                    name,
                    {
                        A0,
                        A1,
                        ratioA0overA1:
                            comparable && A0 !== null && A1 > 0
                                ? A0 / A1
                                : null,
                    },
                ];
            }),
        );
        return { id, comparable, measurements };
    });
    const medians = Object.fromEntries(
        Object.keys(selectors).map((metric) => {
            const ratios = pairs
                .map((pair) => pair.measurements[metric].ratioA0overA1)
                .filter((value) => value !== null)
                .sort((a, b) => a - b);
            const middle = Math.floor(ratios.length / 2);
            const value = ratios.length
                ? (ratios[Math.floor((ratios.length - 1) / 2)] +
                      ratios[middle]) /
                  2
                : null;
            return [
                metric,
                { comparedPairs: ratios.length, medianRatioA0overA1: value },
            ];
        }),
    );
    return {
        scheduledCasePairs: ids.length,
        pairs,
        medians,
        interpretation:
            "Descriptive paired ratios only; null for missing/incomplete or zero denominator. No significance or population-speedup claim.",
        cache: "Fresh store per case; processes shared within each arm and provider/model/OS caches uncontrolled.",
    };
}
export function treatmentPerformance(arms, ids, treatment) {
    assert.ok(
        ["T1", "S1", "E1"].includes(treatment),
        "Unknown singleton treatment",
    );
    const paired = pairedPerformance(
        arms
            .filter((arm) => ["A0", treatment].includes(arm.arm))
            .map((arm) => ({
                ...arm,
                arm: arm.arm === treatment ? "A1" : "A0",
            })),
        ids,
    );
    return {
        controlArm: "A0",
        treatmentArm: treatment,
        scheduledCasePairs: paired.scheduledCasePairs,
        pairs: paired.pairs.map((pair) => ({
            ...pair,
            measurements: Object.fromEntries(
                Object.entries(pair.measurements).map(([name, value]) => [
                    name,
                    {
                        control: value.A0,
                        treatment: value.A1,
                        ratioControlOverTreatment: value.ratioA0overA1,
                    },
                ]),
            ),
        })),
        medians: Object.fromEntries(
            Object.entries(paired.medians).map(([name, value]) => [
                name,
                {
                    comparedPairs: value.comparedPairs,
                    medianRatioControlOverTreatment: value.medianRatioA0overA1,
                },
            ]),
        ),
        interpretation: paired.interpretation,
        cache: paired.cache,
    };
}
function observedDuration(value) {
    if (value === undefined || value === null) return null;
    assert.ok(
        typeof value === "number" && Number.isFinite(value) && value >= 0,
        "Invalid measured duration",
    );
    return value;
}

async function optionalJson(file) {
    try {
        return await readJson(file);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return null;
    }
}

async function armReport(pilot, arm) {
    const unobserved = productionPlan(pilot).questionIds.map((id) => ({
        id,
        status: "unobserved",
        caseHash: null,
    }));
    const attempt = await optionalJson(
        path.join(pilot.root, arm, "attempt.json"),
    );
    if (!attempt?.stateDirectory)
        return {
            arm,
            ...attempt,
            outcome: attempt?.outcome ?? "missing-or-incomplete-artifacts",
            cases: unobserved,
        };
    const relative = attempt.stateDirectory;
    assert.ok(
        !path.isAbsolute(relative) && !relative.startsWith(".."),
        "Unowned attempt state path",
    );
    const state = await optionalJson(
        path.join(pilot.root, arm, relative, "benchmark-state.json"),
    );
    if (!state)
        return { arm, ...attempt, outcome: "missing-state", cases: unobserved };
    return {
        arm,
        ...attempt,
        configuration: state.arm,
        configurationCheckpoint: state.configuration,
        actualCaseOrder: Object.keys(state.cases),
        cases: productionPlan(pilot).questionIds.map((id) => {
            const record = state.cases[id];
            return {
                ...record,
                id,
                caseHash: record ? digest(encode(record)) : null,
                status: record?.status ?? "missing",
            };
        }),
        providerRequests: state.providerRequests,
        traceSummaries: await optionalJson(
            path.join(pilot.root, arm, "indexing-traces.json"),
        ),
        artifacts: relative,
    };
}

export function reviewTemplate(pilot, arms) {
    assert.ok(
        arms.every((arm) =>
            arm.cases?.every((row) => row.status === "complete"),
        ),
        "Review requires all scheduled live cases to be complete",
    );
    return {
        manifestHash: digest(encode(pilot.manifest)),
        independentReviewDeclared: false,
        cases: arms.flatMap((arm) =>
            arm.cases.map((row) => ({
                arm: arm.arm,
                id: row.id,
                caseHash: row.caseHash,
                citationSupported: null,
                referenceConsistent: null,
                judgeAgreement: null,
                notes: "",
            })),
        ),
    };
}

export function validateReview(pilot, arms, review) {
    assert.equal(review.manifestHash, digest(encode(pilot.manifest)));
    assert.equal(
        review.independentReviewDeclared,
        true,
        "Independent human review not declared",
    );
    const expected = reviewTemplate(pilot, arms).cases;
    assert.equal(review.cases.length, expected.length);
    const seen = new Set();
    for (const row of review.cases) {
        const key = `${row.arm}:${row.id}`;
        assert.ok(!seen.has(key), "Duplicate reviewed case");
        seen.add(key);
        const original = expected.find(
            (entry) => entry.arm === row.arm && entry.id === row.id,
        );
        assert.ok(original, "Unknown reviewed case");
        assert.equal(
            row.caseHash,
            original.caseHash,
            "Review belongs to different case evidence",
        );
        for (const check of pilot.manifest.requiredHumanChecks)
            assert.equal(
                typeof row[check],
                "boolean",
                `Human check missing: ${check}`,
            );
        assert.equal(typeof row.notes, "string");
        if (!row.judgeAgreement)
            assert.ok(row.notes.trim(), "Explain judge disagreements");
    }
}

async function compareFrames(pilot, product, baseline) {
    assert.ok(
        baseline,
        "Provide the separately built pre-extension --baseline TypeAgent ts root",
    );
    assert.deepEqual(await checkpoint(product), pilot.manifest.checkpoint);
    const baselineCheckpoint = await checkpoint(path.resolve(baseline));
    const expected = execFileSync("git", ["rev-parse", "de15fe7a8"], {
        cwd: product,
        encoding: "utf8",
    }).trim();
    assert.equal(
        baselineCheckpoint.revision,
        expected,
        "Use the pre-extension merge, not another source revision",
    );
    const directory = path.join(pilot.root, "frame-comparison");
    await mkdir(directory);
    const before = frameEdges(await productModules(baseline));
    const after = frameEdges(await productModules(product));
    assert.deepEqual(before.expectedIds, after.expectedIds);
    assert.ok(
        after.eligibility[1].parsedRows < before.eligibility[1].parsedRows,
        "No measured hydration reduction",
    );
    await writeNew(path.join(directory, "frames.json"), {
        baselineCheckpoint,
        candidateCheckpoint: pilot.manifest.checkpoint,
        before,
        after,
        boundary:
            "Fresh in-memory stores; 4096 synthetic rows, 32 eligible. Setup excluded; correctness assertions included. Not ingestion throughput.",
    });
}

async function preparePilot(values, product) {
    const prepared = await loadPrepared({
        datasetPath: path.resolve(values.dataset),
    });
    const judge = path.resolve(values["judge-source"]);
    const judgeSource = await readFile(judge, "utf8");
    const { officialJudgeTemplates } = await import("./longmemeval-runner.mjs");
    officialJudgeTemplates(judgeSource);
    await freezePilot(
        path.resolve(values.directory),
        prepared,
        values.seed,
        await checkpoint(product),
        {
            datasetPath: path.resolve(values.dataset),
            judgePath: judge,
            judgeSha256: digest(judgeSource),
            comparison: values.comparison,
            firstCaseOnly: values["first-case-only"],
        },
    );
}

export async function main(args = process.argv.slice(2)) {
    const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
            product: { type: "string", default: defaultProduct },
            directory: { type: "string" },
            dataset: { type: "string" },
            "judge-source": { type: "string" },
            approval: { type: "string" },
            seed: { type: "string", default: "indexing-pilot-2026-11-03" },
            comparison: { type: "string", default: "prepared-indexing" },
            "first-case-only": { type: "boolean", default: false },
            arm: { type: "string" },
            spec: { type: "string" },
            baseline: { type: "string" },
            "review-file": { type: "string" },
            output: { type: "string" },
        },
    });
    if (values.spec) return companionWorker(await readJson(values.spec));
    const [command] = positionals;
    assert.ok(
        values.directory,
        "Provide a new private --directory for prepare, or its owned directory thereafter",
    );
    const product = path.resolve(values.product);
    if (command === "prepare") return preparePilot(values, product);
    const pilot = await openPilot(values.directory);
    const commands = {
        preflight: async () =>
            console.log(encode(await preflight(pilot, product))),
        live: async () => {
            const { approval } = await approved(
                pilot,
                product,
                values.approval,
            );
            await childAttempt(product, pilot, approval, values.arm);
        },
        companion: () => runCompanion(pilot, product, values.approval),
        frames: () => compareFrames(pilot, product, values.baseline),
        "collect-traces": async () => {
            const arms = values.arm ? [values.arm] : pilot.manifest.schedule;
            for (const arm of arms) {
                assert.ok(
                    pilot.manifest.schedule.includes(arm),
                    "Unknown frozen arm",
                );
                const recorded = await armReport(pilot, arm);
                assert.ok(
                    recorded.artifacts,
                    "Arm has no owned state directory",
                );
                assert.ok(
                    ["completed", "failed"].includes(recorded.status),
                    "Collect traces only after arm termination",
                );
                await writeNew(
                    path.join(pilot.root, arm, "indexing-traces.json"),
                    await readTraceSummaries(
                        path.join(pilot.root, arm, recorded.artifacts),
                    ),
                );
            }
        },
        "review-template": async () =>
            writeNew(
                path.join(pilot.root, "review-template.json"),
                reviewTemplate(pilot, (await reportPilot(pilot)).arms),
            ),
        review: async () => {
            const review = await readJson(values["review-file"]);
            validateReview(pilot, (await reportPilot(pilot)).arms, review);
            await writeNew(path.join(pilot.root, "review.json"), review);
        },
        report: async () => {
            const report = await reportPilot(pilot);
            await writeNew(
                values.output
                    ? path.resolve(values.output)
                    : path.join(pilot.root, "report.json"),
                report,
            );
            console.log(
                encode({
                    correctness: report.correctness,
                    recovery: report.recovery,
                    performance: report.performance,
                }),
            );
        },
    };
    assert.ok(
        commands[command],
        `Commands: ${Object.keys(commands).join(", ")}`,
    );
    await commands[command]();
}
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    await main();
