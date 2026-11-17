// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { constants } from "node:buffer";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import {
    mkdir,
    mkdtemp,
    rm,
    readFile,
    readdir,
    symlink,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    categories,
    assertPilotProviderConfiguration,
    digest,
    embeddingConfigurationHash,
    encode,
    freezePilot,
    indexingTreatments,
    openPilot,
    readJson,
    replayTape,
    runtimeConfigurationHash,
    selectPilot,
    validateApproval,
    writeNew,
} from "./longmemeval-indexing-contract.mjs";
import {
    capturePreparation,
    pauseAt,
    productModules,
} from "./longmemeval-indexing-storage.mjs";
import {
    main,
    pairedPerformance,
    qualifyCompanion,
    readTraceSummaries,
    reportPilot,
    reviewTemplate,
    validateReview,
    traceRun,
    productionPlan,
    productionArmEnvironment,
    treatmentPerformance,
} from "./longmemeval-indexing.mjs";
import {
    measureIndexingCase,
    startIndexingCase,
    verifyIndexingLifecycle,
} from "./longmemeval-indexing-lifecycle.mjs";
import {
    admitCompanion,
    liveCancellation,
    recordCompanionWork,
    superviseCompanion,
    validateCompanionSpec,
} from "./longmemeval-indexing-execution.mjs";
import {
    benchmarkFailure,
    benchmarkProviderConfiguration,
    recordBenchmarkArm,
} from "./longmemeval-live.mjs";
import { createTraceSummary } from "./longmemeval-indexing-traces.mjs";

const product = fileURLToPath(new URL("../../", import.meta.url));

test("indexing treatment identity excludes removed topic scheduling", () => {
    assert.deepEqual(
        indexingTreatments({
            TYPEAGENT_MEMORY_PERF_EXPERIMENTS: "indexing-parallel",
        }),
        ["synopsis-parallel", "embedding-parallel"],
    );
    assert.throws(
        () =>
            indexingTreatments({
                TYPEAGENT_MEMORY_PERF_EXPERIMENTS:
                    "indexing-parallel,topic-parallel",
            }),
        /topic-parallel has been removed/,
    );
});

test("pilot approval and worker share a sanitized identity for every pool member", () => {
    const primary = {
        provider: "offline",
        modelName: "primary",
        endpoint: "https://primary.invalid",
        requestConstraints: { outputTokens: 100 },
        apiKey: "not-an-exported-field",
    };
    const fallback = {
        ...primary,
        modelName: "fallback",
        endpoint: "https://fallback.invalid",
    };
    const client = {
        openai: {
            getChatModelSettings: () => primary,
            getChatModelPool: () => ({
                members: [{ settings: primary }, { settings: fallback }],
            }),
        },
        getEmbeddingProvider: () => "offline",
        getEmbeddingSize: () => 2,
        getRuntimeConfig: () => ({}),
    };
    const config = {
        resolveEmbeddingConfig: () => ({}),
        redactTree: (value) => value,
    };
    const approved = benchmarkProviderConfiguration(client);
    const spec = {
        indexingPilot: true,
        expectedConfigurationHash: digest(encode(approved)),
        expectedEmbeddingConfigurationHash: embeddingConfigurationHash(
            client,
            config,
        ),
        expectedRuntimeConfigurationHash: runtimeConfigurationHash(
            client,
            config,
        ),
    };
    assert.equal(approved.poolMembers.length, 2);
    assert.ok(!encode(approved).includes(primary.apiKey));
    assert.ok(!encode(approved).includes(primary.endpoint));
    assert.ok(!encode(approved).includes(fallback.endpoint));
    assertPilotProviderConfiguration(
        spec,
        client,
        config,
        benchmarkProviderConfiguration(client),
    );
    fallback.requestConstraints = { outputTokens: 101 };
    assert.throws(
        () =>
            assertPilotProviderConfiguration(
                spec,
                client,
                config,
                benchmarkProviderConfiguration(client),
            ),
        /Approved provider configuration changed/,
    );
});

test("singleton ablations remove inherited treatments and preserve frozen order", () => {
    const pilot = {
        manifest: {
            questionIds: ["one", "two", "three"],
            schedule: ["A0", "S1", "E1"],
        },
        inputs: { comparison: "indexing-ablation", firstCaseOnly: true },
    };
    assert.deepEqual(productionPlan(pilot).schedule, pilot.manifest.schedule);
    for (const [arm, expected] of [
        ["A0", ""],
        ["S1", "synopsis-parallel"],
        ["E1", "embedding-parallel"],
    ]) {
        const env = productionArmEnvironment(pilot, arm, {
            TYPEAGENT_MEMORY_PERF_EXPERIMENTS:
                "indexing-parallel,synopsis-parallel,embedding-parallel,translation-cache",
        });
        assert.equal(env.TYPEAGENT_MEMORY_PREPARED_INDEXING, "1");
        assert.equal(
            env.TYPEAGENT_MEMORY_PERF_EXPERIMENTS,
            ["translation-cache", expected].filter(Boolean).join(","),
        );
    }
    assert.throws(() => productionArmEnvironment(pilot, "A1", {}), /frozen/);
    assert.throws(
        () =>
            productionPlan({
                ...pilot,
                manifest: {
                    ...pilot.manifest,
                    schedule: ["A0", "T1", "S1", "E1"],
                },
            }),
        /schedule/,
    );
    const arms = ["A0", "S1", "E1"].map((arm) => ({
        arm,
        status: arm === "E1" ? "failed" : "completed",
        cases: [
            {
                id: "one",
                status: arm === "E1" ? "interrupted" : "complete",
                ingestionMilliseconds: arm === "A0" ? 20 : 10,
            },
        ],
    }));
    assert.equal(
        treatmentPerformance(arms, ["one"], "S1").medians.ingestionMs
            .medianRatioControlOverTreatment,
        2,
    );
    assert.equal(
        treatmentPerformance(arms, ["one"], "E1").medians.ingestionMs
            .comparedPairs,
        0,
    );
    assert.equal(
        treatmentPerformance(arms, ["one"], "E1").pairs[0].measurements
            .ingestionMs.ratioControlOverTreatment,
        null,
    );
});

test("parallel comparison freezes one full history and holds preparation constant", () => {
    const pilot = {
        manifest: { questionIds: ["one", "two", "three"] },
        inputs: { comparison: "indexing-parallel", firstCaseOnly: true },
    };
    assert.deepEqual(productionPlan(pilot).questionIds, ["one"]);
    for (const arm of ["A0", "A1"]) {
        const env = productionArmEnvironment(pilot, arm, {
            TYPEAGENT_MEMORY_PERF_EXPERIMENTS:
                "translation-cache,indexing-parallel",
        });
        assert.equal(env.TYPEAGENT_MEMORY_PREPARED_INDEXING, "1");
        assert.equal(env.TYPEAGENT_MEMORY_SEARCH_TRACE, "1");
        assert.equal(
            env.TYPEAGENT_MEMORY_PERF_EXPERIMENTS,
            arm === "A0"
                ? "translation-cache"
                : "translation-cache,indexing-parallel",
        );
    }
    assert.throws(
        () =>
            productionArmEnvironment(pilot, "A1", {
                TYPEAGENT_MEMORY_TOPIC_CONCURRENCY: "1",
            }),
        /TYPEAGENT_MEMORY_TOPIC_CONCURRENCY/,
    );
    assert.throws(
        () =>
            productionArmEnvironment(pilot, "A1", {
                TYPEAGENT_MEMORY_PERF_EXPERIMENTS: "topic-parallel",
            }),
        /topic-parallel has been removed/,
    );
    assert.throws(
        () => productionPlan({ ...pilot, inputs: { comparison: "typo" } }),
        /Unknown/,
    );
    const legacy = { manifest: pilot.manifest, inputs: {} };
    assert.deepEqual(
        productionPlan(legacy).questionIds,
        pilot.manifest.questionIds,
    );
    assert.equal(
        productionArmEnvironment(legacy, "A0", {})
            .TYPEAGENT_MEMORY_PREPARED_INDEXING,
        undefined,
    );
    assert.equal(
        productionArmEnvironment(legacy, "A1", {})
            .TYPEAGENT_MEMORY_PREPARED_INDEXING,
        "1",
    );
});
function fixture() {
    const construction = categories.map((category, i) => ({
        id: `case-${i}`,
        cutoff: "2026/01/03 (Sat) 00:00",
        sessions: [
            {
                id: "repeated-official-id",
                position: 0,
                date: "2026/01/01 (Thu) 12:00",
                turns: [
                    { role: "user", content: "first" },
                    { role: "assistant", content: "second" },
                ],
            },
            {
                id: "repeated-official-id",
                position: 1,
                date: "2026/01/02 (Fri) 12:00",
                turns: [
                    { role: "user", content: "third" },
                    { role: "assistant", content: "" },
                ],
            },
        ],
    }));
    return {
        manifest: {
            originalRowHashes: categories.map((category, i) => ({
                id: `case-${i}`,
                category,
            })),
            provenance: "synthetic-no-quality-claim",
        },
        construction,
        readerOnly: {
            questions: construction.map((row) => ({
                question_id: row.id,
                question: "EVALUATOR_ONLY_QUESTION",
            })),
        },
        evaluatorOnly: {
            references: construction.map((row) => ({
                question_id: row.id,
                answer: "EVALUATOR_ONLY_ANSWER",
            })),
        },
    };
}
async function temporary(work) {
    const root = await mkdtemp(path.join(os.tmpdir(), "indexing-pilot-test-"));
    try {
        return await work(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
function settings(modules) {
    const model = (role = "document") => ({
        maxBatchSize: role === "document" ? 16 : 7,
        embeddingIdentity: {
            schemaVersion: 1,
            provider: "offline-fixture",
            model: "pilot-test",
            revision: "1",
            dimensions: 2,
            task: role,
            prompt: role,
            pooling: "mean",
            normalization: "l2",
            preprocessing: "fixture",
            artifactHash: "a".repeat(64),
        },
        forRole: model,
        generateEmbedding: async () => ({ success: true, data: [1, 0] }),
        generateEmbeddingBatch: async (texts) => ({
            success: true,
            data: texts.map(() => [1, 0]),
        }),
    });
    const value = modules.kp.createConversationSettings(model(), 2);
    value.semanticRefIndexSettings.knowledgeExtractor = {
        settings: { maxContextLength: 4096 },
        extract: async (text) => ({
            entities: [],
            topics: [text],
            actions: [],
            inverseActions: [],
        }),
        extractWithRetry: async (text) => ({
            success: true,
            data: {
                entities: [],
                topics: [text],
                actions: [],
                inverseActions: [],
            },
        }),
    };
    return value;
}

test("selection freezes three categories without using question/reference labels", async () =>
    temporary(async (root) => {
        const prepared = fixture();
        const selected = selectPilot(prepared, "fixed");
        const reordered = structuredClone(prepared);
        reordered.manifest.originalRowHashes.reverse();
        assert.deepEqual(selectPilot(reordered, "fixed").ids, selected.ids);
        assert.ok(!encode(selected.construction).includes("EVALUATOR_ONLY"));
        assert.equal(selected.construction[0].sessions.length, 2);
        const directory = path.join(root, "pilot");
        await freezePilot(directory, prepared, "fixed", {
            revision: "fixture",
        });
        const opened = await openPilot(directory);
        assert.deepEqual(opened.construction, selected.construction);
        await assert.rejects(
            freezePilot(directory, prepared, "fixed", {}),
            /EEXIST/,
        );
        const sourceFile = path.join(directory, "construction.json");
        await writeFile(
            sourceFile,
            (await readFile(sourceFile, "utf8")).replace("first", "tampered"),
        );
        await assert.rejects(openPilot(directory), /Assertion/);
    }));

test("freezing an ablation persists three independent conditions and one complete production history", async () =>
    temporary(async (root) => {
        const inputs = { comparison: "indexing-ablation", firstCaseOnly: true };
        const directory = path.join(root, "ablation");
        await freezePilot(
            directory,
            fixture(),
            "fixed",
            { revision: "fixture" },
            inputs,
        );
        const pilot = await openPilot(directory);
        assert.deepEqual(pilot.manifest.schedule, ["A0", "S1", "E1"]);
        assert.equal(productionPlan(pilot).questionIds.length, 1);
        assert.equal(pilot.construction.length, 3);
        assert.equal(pilot.construction[0].sessions.length, 2);
        assert.deepEqual(pilot.inputs, inputs);
        await assert.rejects(
            freezePilot(
                path.join(root, "invalid"),
                fixture(),
                "fixed",
                {},
                { ...inputs, firstCaseOnly: false },
            ),
            /one complete frozen history/,
        );
    }));

test("approval requires explicit provider/data permission and acceptance of financial-cap limitations", () => {
    const point = { revision: "fixture" };
    const approval = {
        schemaVersion: 1,
        manifestHash: "manifest",
        checkpointHash: digest(encode(point)),
        publicDatasetApproved: true,
        configuredProvidersApproved: true,
        acceptNoMonetaryCap: true,
        chatConfigurationHash: "a".repeat(64),
        dependencyHash: "b".repeat(64),
        workMinutes: 15,
        embeddingConfigurationHash: "c".repeat(64),
        runtimeConfigurationHash: "d".repeat(64),
    };
    validateApproval(approval, "manifest", point);
    for (const field of [
        "publicDatasetApproved",
        "configuredProvidersApproved",
        "acceptNoMonetaryCap",
    ])
        assert.throws(() =>
            validateApproval(
                { ...approval, [field]: false },
                "manifest",
                point,
            ),
        );
    assert.throws(
        () => validateApproval(approval, "another", point),
        /approved manifest/,
    );
    assert.throws(() =>
        validateApproval({ ...approval, workMinutes: 16 }, "manifest", point),
    );
    assert.throws(
        () =>
            validateApproval(
                { ...approval, workMinutes: null },
                "manifest",
                point,
            ),
        /explicit approval/,
    );
    validateApproval(
        { ...approval, workMinutes: null, unlimitedWorkApproved: true },
        "manifest",
        point,
    );
});

test("provider replay has exact input/identity matching and no success-shaped fallback", async () => {
    const tape = replayTape([], true);
    await tape.invoke("embedding", { model: "one" }, ["text"], async () => ({
        success: true,
        data: [1, 0],
    }));
    const replay = replayTape(tape.entries());
    assert.deepEqual(
        await replay.invoke("embedding", { model: "one" }, ["text"]),
        { success: true, data: [1, 0] },
    );
    await assert.rejects(
        replay.invoke("embedding", { model: "two" }, ["text"]),
        /replay miss/,
    );
    await assert.rejects(
        replay.invoke("embedding", { model: "one" }, ["changed"]),
        /replay miss/,
    );
    assert.equal(replay.calls, 0);
});

test("recovery checkpoints are not visible until their JSON is complete", async (t) =>
    temporary(async (root) => {
        const checkpoint = path.join(root, "checkpoint.json");
        t.mock.method(Atomics, "wait", () => "timed-out");
        t.mock.method(fs, "writeFileSync", (file, data, options) => {
            const fd = fs.openSync(file, options.flag);
            try {
                fs.writeSync(fd, data.slice(0, 1));
                assert.equal(
                    fs.existsSync(checkpoint),
                    false,
                    "The supervisor must not see a partially written checkpoint",
                );
                fs.writeSync(fd, data.slice(1));
            } finally {
                fs.closeSync(fd);
            }
        });
        syncBuiltinESMExports();
        try {
            assert.throws(
                () => pauseAt(root, "before"),
                /Recovery supervisor failed to terminate the paused worker/,
            );
            assert.deepEqual(await readJson(checkpoint), {
                point: "before",
                pid: process.pid,
            });
            assert.deepEqual(await readdir(root), ["checkpoint.json"]);
        } finally {
            t.mock.restoreAll();
            syncBuiltinESMExports();
        }
    }));

test("recovery checkpoints cannot replace an existing supervisor checkpoint", async (t) =>
    temporary(async (root) => {
        const checkpoint = path.join(root, "checkpoint.json");
        const existing = { point: "before", pid: 123 };
        await writeNew(checkpoint, existing);
        const wait = t.mock.method(Atomics, "wait", () => "timed-out");
        assert.throws(() => pauseAt(root, "rows"), { code: "EEXIST" });
        assert.equal(wait.mock.callCount(), 0);
        assert.deepEqual(await readJson(checkpoint), existing);
        assert.deepEqual(await readdir(root), ["checkpoint.json"]);
    }));

test(
    "same real SQLite history passes serial/concurrent replay, frames, cancellation, stale input and five hard crashes",
    { timeout: 120000 },
    async () =>
        temporary(async (root) => {
            const fetch = globalThis.fetch;
            globalThis.fetch = () => {
                throw new Error(
                    "Offline benchmark tests must not use a provider",
                );
            };
            try {
                const modules = await productModules(product);
                const construction = fixture().construction[0];
                const directory = path.join(root, "companion");
                const tape = replayTape([], true);
                const prepared = await capturePreparation(
                    modules,
                    directory,
                    construction,
                    settings(modules),
                    tape,
                );
                assert.deepEqual(prepared.artifact.maxBatchSizes.message, {
                    document: 16,
                    query: 7,
                });
                const qualified = await qualifyCompanion(
                    modules,
                    product,
                    directory,
                    construction,
                    prepared,
                );
                assert.equal(qualified.result.crashes.length, 5);
                assert.equal(qualified.result.preparation.length, 3);
                assert.equal(qualified.result.restore.length, 2);
                assert.equal(qualified.result.frameSnapshot.status, "passed");
                assert.deepEqual(
                    qualified.result.replay.map((row) => row.acceptedHash),
                    [prepared.acceptedHash, prepared.acceptedHash],
                );
                assert.equal(
                    qualified.result.frameEdges.eligibility[1].parsedRows,
                    32,
                );
                assert.ok(
                    qualified.traceSummaries.some(
                        (span) => span.stage === "ingestion.sqlite.commit",
                    ),
                );
                assert.ok(
                    !encode(qualified.traceSummaries).includes(
                        "repeated-official-id",
                    ),
                );
                const cancellation = settings(modules);
                cancellation.preparedIndexing = {
                    workers: 3,
                    window: 3,
                    signal: AbortSignal.timeout(60000),
                };
                const ready = Promise.withResolvers();
                const release = Promise.withResolvers();
                const extract =
                    cancellation.semanticRefIndexSettings.knowledgeExtractor
                        .extractWithRetry;
                cancellation.semanticRefIndexSettings.knowledgeExtractor.extractWithRetry =
                    async (...args) => {
                        ready.resolve();
                        await release.promise;
                        return extract(...args);
                    };
                let settled = false;
                const work = liveCancellation(
                    modules,
                    directory,
                    prepared,
                    cancellation,
                ).finally(() => {
                    settled = true;
                });
                try {
                    await ready.promise;
                    assert.equal(
                        settled,
                        false,
                        "In-flight fixture model work was not awaited",
                    );
                } finally {
                    release.resolve();
                }
                assert.equal((await work).outstanding, 0);
            } finally {
                globalThis.fetch = fetch;
            }
        }),
);

test("frozen evaluator and private input paths are integrity checked", async () =>
    temporary(async (root) => {
        for (const file of ["evaluator.json", "inputs.json"]) {
            const directory = path.join(root, file);
            await freezePilot(
                directory,
                fixture(),
                "fixed",
                {},
                { datasetPath: "fixture" },
            );
            await writeFile(path.join(directory, file), "{}");
            await assert.rejects(openPilot(directory), /changed/);
        }
    }));

test("construction rejects question fields before creating an owned pilot", async () =>
    temporary(async (root) => {
        const prepared = fixture();
        prepared.construction[0].sessions[0].turns[0].question =
            "leaked question";
        await assert.rejects(
            freezePilot(path.join(root, "bad"), prepared, "fixed", {}),
        );
        await assert.rejects(
            readFile(path.join(root, "bad", "ownership.json")),
            { code: "ENOENT" },
        );
    }));

test("recording refuses nondeterministic duplicate provider outputs", async () => {
    const tape = replayTape([], true);
    await tape.invoke("model", {}, ["same"], async () => "one");
    assert.equal(
        await tape.invoke("model", {}, ["same"], async () => "one"),
        "one",
    );
    await assert.rejects(
        tape.invoke("model", {}, ["same"], async () => "two"),
        (error) => {
            assert.equal(error.code, "EREPLAYNONDETERMINISTIC");
            assert.equal(
                benchmarkFailure(error).category,
                "REPLAY_CAPTURE_INCONSISTENT_OUTPUT",
            );
            assert.ok(!encode(benchmarkFailure(error)).includes('"two"'));
            return true;
        },
    );
    assert.equal(tape.entries()[0].value, "one");
});

test("overlapping duplicate calls cannot silently replace a recorded provider response", async () => {
    const tape = replayTape([], true);
    const first = Promise.withResolvers();
    const second = Promise.withResolvers();
    const left = tape.invoke("model", {}, ["same"], () => first.promise);
    const right = tape.invoke("model", {}, ["same"], () => second.promise);
    first.resolve("first");
    await left;
    second.resolve("different");
    await assert.rejects(right, { code: "EREPLAYNONDETERMINISTIC" });
    assert.equal(tape.entries()[0].value, "first");
    assert.equal(tape.calls, 2);
    assert.equal(
        benchmarkFailure(new Error("Provider endpoint unavailable")).category,
        "CONFIGURED_ROLE_OR_TRANSPORT_UNAVAILABLE",
    );
    await assert.rejects(
        replayTape([]).invoke("model", {}, ["missing"]),
        (error) => {
            assert.equal(
                benchmarkFailure(error).category,
                "REPLAY_INPUT_NOT_CAPTURED",
            );
            return true;
        },
    );
});

test("embedding configuration hash binds configuration and targets without returning their values", () => {
    const client = {
        getEmbeddingProvider: () => "fixture",
        getEmbeddingSize: () => 2,
        getRuntimeConfig: () => ({ model: "one" }),
    };
    const config = { resolveEmbeddingConfig: (value) => value };
    const original = embeddingConfigurationHash(client, config);
    client.getRuntimeConfig = () => ({ model: "two" });
    assert.notEqual(embeddingConfigurationHash(client, config), original);
    assert.match(original, /^[a-f0-9]{64}$/);
});

test("review records bind all six exact case/evidence hashes and retain disagreements", async () =>
    temporary(async (root) => {
        await freezePilot(path.join(root, "pilot"), fixture(), "fixed", {});
        const pilot = await openPilot(path.join(root, "pilot"));
        const arms = pilot.manifest.schedule.map((arm) => ({
            arm,
            cases: pilot.manifest.questionIds.map((id) => ({
                id,
                status: "complete",
                caseHash: digest(id + arm),
            })),
        }));
        const review = reviewTemplate(pilot, arms);
        assert.throws(
            () => validateReview(pilot, arms, review),
            /not declared/,
        );
        review.independentReviewDeclared = true;
        for (const row of review.cases)
            Object.assign(row, {
                citationSupported: true,
                referenceConsistent: true,
                judgeAgreement: true,
            });
        validateReview(pilot, arms, review);
        const changed = structuredClone(review);
        changed.cases[0].caseHash = "changed";
        assert.throws(
            () => validateReview(pilot, arms, changed),
            /different case/,
        );
        review.cases[0].judgeAgreement = false;
        assert.throws(
            () => validateReview(pilot, arms, review),
            /Explain judge/,
        );
        review.cases[0].notes =
            "Fixture disagreement, not a measured model result";
        validateReview(pilot, arms, review);
    }));

test("malformed traces fail explicitly and timings remain outside source content", async () =>
    temporary(async (root) => {
        await writeFile(
            path.join(root, "stderr-fixture.log"),
            'irrelevant\n[memory-search-timing] {"stage":"ingestion.unit.prepare","elapsedMs":1}\n',
        );
        assert.equal(
            (await readTraceSummaries(root))[0].stage,
            "ingestion.unit.prepare",
        );
        await writeFile(
            path.join(root, "stderr-fixture.log"),
            "[memory-search-timing] invalid\n",
        );
        await assert.rejects(readTraceSummaries(root), SyntaxError);
    }));

test("trace memory and output depend on stage schema, not event count or source content", () => {
    const collector = createTraceSummary();
    const span = {
        stage: "ingestion.unit.prepare",
        elapsedMs: 1,
        status: "ok",
        metadata: { inFlight: 3, source: "x".repeat(4 * 1024 * 1024) },
    };
    const count = 256;
    assert.ok(
        count * JSON.stringify(span).length > constants.MAX_STRING_LENGTH,
    );
    for (let i = 0; i < count; i++) collector.add(span);
    const summary = collector.summaries();
    assert.equal(summary.length, 1);
    assert.equal(summary[0].spanCount, count);
    assert.equal(summary[0].totalElapsedMs, count);
    assert.deepEqual(summary[0].statusCounts, { ok: count });
    assert.equal(summary[0].numericMetadata.inFlight.max, 3);
    assert.ok(JSON.stringify(summary).length < 1024);
});

test("trace summaries preserve failures, extrema, unknowns and snapshot independence", () => {
    const collector = createTraceSummary();
    collector.add({
        stage: "query",
        elapsedMs: 5,
        metadata: { candidates: 2 },
    });
    const first = collector.summaries();
    collector.add({
        stage: "query",
        elapsedMs: 1,
        status: "error",
        metadata: { candidates: 4 },
    });
    const [summary] = collector.summaries();
    assert.equal(summary.spanCount, 2);
    assert.equal(summary.minElapsedMs, 1);
    assert.equal(summary.maxElapsedMs, 5);
    assert.equal(summary.totalElapsedMs, 6);
    assert.deepEqual(summary.statusCounts, { unobserved: 1, error: 1 });
    assert.deepEqual(summary.numericMetadata.candidates, {
        observations: 2,
        min: 2,
        max: 4,
    });
    assert.equal(first[0].numericMetadata.candidates.max, 2);
});

test("malformed numeric timing evidence fails rather than becoming a zero measurement", () => {
    const collector = createTraceSummary();
    assert.throws(() => collector.add({ stage: "query", elapsedMs: -1 }));
    assert.throws(() =>
        collector.add({ stage: "query", elapsedMs: undefined }),
    );
    assert.throws(() => collector.add({ stage: "", elapsedMs: 0 }));
    assert.throws(() =>
        collector.add({
            stage: "query",
            elapsedMs: 1,
            metadata: { highWater: Infinity },
        }),
    );
});

test("companion traces preserve raw records and restore hooks on success and failure", async () =>
    temporary(async (root) => {
        const warn = console.warn;
        const previous = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        const kp = { runWithSearchTiming: async (_id, _scope, work) => work() };
        const emit = () =>
            console.warn(
                '[memory-search-timing] {"stage":"ingestion.unit.prepare","elapsedMs":1,"status":"ok"}',
            );
        const file = path.join(root, "raw.jsonl");
        const result = await traceRun(
            kp,
            () => {
                emit();
                emit();
                return "done";
            },
            file,
        );
        assert.equal(result.result, "done");
        assert.equal(result.traceSummaries[0].spanCount, 2);
        assert.equal(result.rawTraceFile, "raw.jsonl");
        assert.equal(
            (await readFile(file, "utf8")).trim().split("\n").length,
            2,
        );
        const failed = path.join(root, "failed.jsonl");
        await assert.rejects(
            traceRun(
                kp,
                () => {
                    emit();
                    throw new Error("fixture");
                },
                failed,
            ),
            /fixture/,
        );
        assert.equal(
            JSON.parse((await readFile(failed, "utf8")).trim()).stage,
            "ingestion.unit.prepare",
        );
        assert.equal(console.warn, warn);
        assert.equal(process.env.TYPEAGENT_MEMORY_SEARCH_TRACE, previous);
    }));

test("offline trace recovery preserves failed ledgers and rejects active or unknown arms", async () =>
    temporary(async (root) => {
        const directory = path.join(root, "pilot");
        await freezePilot(directory, fixture(), "fixed", {});
        for (const [arm, status] of [
            ["A0", "failed"],
            ["A1", "running"],
        ]) {
            const state = path.join(directory, arm, "run");
            await mkdir(state, { recursive: true });
            await writeFile(
                path.join(directory, arm, "attempt.json"),
                encode({ status, stateDirectory: "run" }),
            );
            await writeFile(
                path.join(state, "benchmark-state.json"),
                encode({ cases: {}, arm: {} }),
            );
            await writeFile(
                path.join(state, "stderr-fixture.log"),
                '[memory-search-timing] {"stage":"ingestion.unit.prepare","elapsedMs":1}\n',
            );
        }
        const ledger = path.join(directory, "A0", "attempt.json");
        const before = await readFile(ledger, "utf8");
        await main(["collect-traces", "--directory", directory, "--arm", "A0"]);
        const collected = JSON.parse(
            await readFile(
                path.join(directory, "A0", "indexing-traces.json"),
                "utf8",
            ),
        );
        assert.equal(collected[0].spanCount, 1);
        assert.equal(await readFile(ledger, "utf8"), before);
        await assert.rejects(
            main(["collect-traces", "--directory", directory, "--arm", "A0"]),
            { code: "EEXIST" },
        );
        await assert.rejects(
            main(["collect-traces", "--directory", directory, "--arm", "A1"]),
            /after arm termination/,
        );
        await assert.rejects(
            main([
                "collect-traces",
                "--directory",
                directory,
                "--arm",
                "unknown",
            ]),
            /Unknown frozen arm/,
        );
    }));

test("case metrics retain failure measurements and do not alter non-pilot behavior", async () => {
    const original = {};
    assert.equal(
        await measureIndexingCase(original, false, async () => 42),
        42,
    );
    assert.deepEqual(original, {});
    const failed = {};
    await assert.rejects(
        measureIndexingCase(failed, true, async () => {
            throw new Error("expected");
        }),
        /expected/,
    );
    assert.ok(failed.indexingMetrics.elapsedMs >= 0);
    assert.equal(failed.indexingMetrics.gcPauseMs, null);
});

test("paired ratios count only complete comparable pairs and never turn missing durations into zero", () => {
    const arms = ["A0", "A1"].map((arm) => ({
        arm,
        status: "completed",
        cases: [
            {
                id: "complete",
                status: "complete",
                answerMilliseconds: arm === "A0" ? 20 : 10,
            },
            {
                id: "partial",
                status: arm === "A0" ? "failed" : "complete",
                answerMilliseconds: 5,
            },
        ],
    }));
    const result = pairedPerformance(arms, ["complete", "partial", "missing"]);
    assert.equal(result.pairs[0].measurements.answerMs.ratioA0overA1, 2);
    assert.equal(result.pairs[1].measurements.answerMs.ratioA0overA1, null);
    assert.equal(result.pairs[2].measurements.answerMs.A0, null);
    assert.deepEqual(result.medians.answerMs, {
        comparedPairs: 1,
        medianRatioA0overA1: 2,
    });
    assert.equal(result.medians.ingestionMs.comparedPairs, 0);
});

test("each pilot case starts a distinct empty store without changing ordinary benchmark stores", async () =>
    temporary(async (root) => {
        let closed = 0;
        const previous = {
            close: async () => {
                closed++;
            },
        };
        const open = async (store) => ({
            store,
            initialize: async () => {},
            close: async () => {
                closed++;
            },
        });
        const context = {
            enabled: false,
            store: root,
            runDirectory: root,
            open,
        };
        assert.deepEqual(await startIndexingCase(previous, context), {
            service: previous,
            store: root,
        });
        assert.equal(closed, 0);
        context.enabled = true;
        const first = await startIndexingCase(previous, context);
        const second = await startIndexingCase(first.service, context);
        assert.notEqual(first.store, second.store);
        assert.equal(closed, 2);
    }));

test("unknown commands fail before attempting provider configuration", async () =>
    temporary(async (root) => {
        const directory = path.join(root, "pilot");
        await freezePilot(directory, fixture(), "fixed", {});
        await assert.rejects(
            main(["unknown", "--directory", directory]),
            /Commands:/,
        );
    }));

test("companion cannot silently resume or exceed the bounded allowance", () => {
    const spec = {
        mode: "indexing-companion",
        authorizedLiveBenchmark: true,
        startupAllowanceMs: 120000,
        workAllowanceMs: 1200000,
        resume: false,
        pilotDirectory: product,
        runDirectory: product,
        approvalHash: "a".repeat(64),
    };
    validateCompanionSpec(spec);
    assert.throws(() =>
        validateCompanionSpec({ ...spec, workAllowanceMs: null }),
    );
    validateCompanionSpec({
        ...spec,
        workAllowanceMs: null,
        unlimitedWorkApproved: true,
    });
    assert.throws(() =>
        validateCompanionSpec({ ...spec, workAllowanceMs: 1200001 }),
    );
    assert.throws(() =>
        validateCompanionSpec({ ...spec, authorizedLiveBenchmark: false }),
    );
    assert.throws(() => validateCompanionSpec({ ...spec, resume: true }));
});

test("companion startup failures retain sanitized accounting and restore the provider observer", async () =>
    temporary(async (root) => {
        await mkdir(path.join(root, "companion-attempt"));
        const fetch = globalThis.fetch;
        await assert.rejects(
            recordCompanionWork(
                {},
                path.join(root, "companion"),
                fixture().construction[0],
                async () => {
                    throw new Error("untrusted-provider-payload");
                },
                replayTape([], true),
                async () => {},
                undefined,
                async () => {},
            ),
            /untrusted-provider-payload/,
        );
        assert.equal(globalThis.fetch, fetch);
        const metrics = JSON.parse(
            await readFile(
                path.join(root, "companion-attempt", "work.json"),
                "utf8",
            ),
        );
        assert.equal(metrics.status, "failed");
        assert.ok(!encode(metrics).includes("untrusted-provider-payload"));
    }));

test("exclusive JSON publication never exposes a partially written admission", async () =>
    temporary(async (root) => {
        const file = path.join(root, "admitted.json");
        const value = {
            receiptId: "owned",
            content: "x".repeat(4 * 1024 * 1024),
        };
        const writing = writeNew(file, value);
        const reading = (async () => {
            for (let attempt = 0; attempt < 1000; attempt++) {
                try {
                    return await readJson(file);
                } catch (error) {
                    if (error.code !== "ENOENT") throw error;
                }
                await new Promise((resolve) => setImmediate(resolve));
            }
            throw new Error("Admission was not published");
        })();
        const [written, observed] = await Promise.allSettled([
            writing,
            reading,
        ]);
        assert.equal(written.status, "fulfilled");
        assert.equal(observed.status, "fulfilled", observed.reason?.message);
        assert.deepEqual(observed.value, value);
        await assert.rejects(writeNew(file, { receiptId: "replacement" }), {
            code: "EEXIST",
        });
        assert.deepEqual(await readJson(file), value);
        assert.deepEqual(await readdir(root), ["admitted.json"]);
    }));

for (const workMinutes of [1, null]) {
    for (const alias of [false, true]) {
        test(`companion supervision verifies ownership with work minutes ${workMinutes} and directory alias ${alias}`, async () =>
            temporary(async (root) => {
                let pilotRoot = root;
                if (alias) {
                    const target = path.join(root, "pilot-target");
                    await mkdir(target);
                    pilotRoot = path.join(root, "pilot-alias");
                    await symlink(
                        target,
                        pilotRoot,
                        process.platform === "win32" ? "junction" : "dir",
                    );
                }
                const approvalFile = path.join(root, "fixture-approval.json");
                const approval = {
                    workMinutes,
                    unlimitedWorkApproved: workMinutes === null,
                };
                await writeFile(approvalFile, encode(approval));
                const worker = path.join(root, "fixture-worker.mjs");
                const executionModule = new URL(
                    "./longmemeval-indexing-execution.mjs",
                    import.meta.url,
                ).href;
                await writeFile(
                    worker,
                    `
import { readFile } from "node:fs/promises";
import { admitCompanion } from ${JSON.stringify(executionModule)};
const spec = JSON.parse(await readFile(process.argv[3], "utf8"));
const approval = JSON.parse(await readFile(spec.approvalFile, "utf8"));
await admitCompanion(spec, approval);
await new Promise(resolve => setTimeout(resolve, 200));
`,
                );
                const pilot = {
                    root: pilotRoot,
                    manifest: { checkpoint: { hashes: {} } },
                };
                const outcome = await superviseCompanion(
                    pilot,
                    product,
                    approvalFile,
                    approval,
                    worker,
                );
                assert.equal(outcome.exit.code, 0);
                assert.equal(outcome.phase, "admitted-work");
                if (workMinutes === null)
                    assert.equal(outcome.workDeadlineEpochMs, null);
                await assert.rejects(
                    superviseCompanion(
                        pilot,
                        product,
                        approvalFile,
                        approval,
                        worker,
                    ),
                    { code: "EEXIST" },
                );
            }));
    }
}

test("companion admission rejects ownership of a different directory", async () =>
    temporary(async (root) => {
        const directory = path.join(root, "companion-attempt");
        await mkdir(directory);
        const approval = { workMinutes: 1 };
        const receiptId = "offline-ownership-fixture";
        await writeFile(
            path.join(directory, "ownership.json"),
            encode({ receiptId, runDirectory: root }),
        );
        await assert.rejects(
            admitCompanion(
                {
                    mode: "indexing-companion",
                    authorizedLiveBenchmark: true,
                    startupAllowanceMs: 120000,
                    workAllowanceMs: 360000,
                    resume: false,
                    pilotDirectory: root,
                    runDirectory: directory,
                    approvalHash: digest(encode(approval)),
                    receiptId,
                },
                approval,
            ),
            { code: "ERR_ASSERTION" },
        );
    }));

test("pilot live commands reject absent authorization before loading provider configuration", async () =>
    temporary(async (root) => {
        const directory = path.join(root, "pilot");
        await freezePilot(directory, fixture(), "fixed", {});
        await assert.rejects(
            main(["live", "--directory", directory, "--arm", "A0"]),
            /separate approval JSON/,
        );
    }));

test("missing live arms are incomplete, not zero-cost or successful quality results", async () =>
    temporary(async (root) => {
        await freezePilot(path.join(root, "pilot"), fixture(), "fixed", {});
        const report = await reportPilot(
            await openPilot(path.join(root, "pilot")),
        );
        assert.equal(report.correctness, "incomplete");
        assert.equal(report.recovery, "incomplete");
        assert.equal(report.arms.length, 2);
        assert.ok(report.arms.every((arm) => !("providerRequests" in arm)));
    }));

test("live arm identity rejects a changed preparation flag on resume", () => {
    const previous = process.env.TYPEAGENT_MEMORY_PREPARED_INDEXING;
    const state = {};
    try {
        delete process.env.TYPEAGENT_MEMORY_PREPARED_INDEXING;
        recordBenchmarkArm(state, { features: {} }, false, {
            indexingPilot: true,
        });
        process.env.TYPEAGENT_MEMORY_PREPARED_INDEXING = "1";
        assert.throws(
            () =>
                recordBenchmarkArm(state, { features: {} }, true, {
                    indexingPilot: true,
                }),
            /configuration changed/,
        );
    } finally {
        if (previous === undefined)
            delete process.env.TYPEAGENT_MEMORY_PREPARED_INDEXING;
        else process.env.TYPEAGENT_MEMORY_PREPARED_INDEXING = previous;
    }
});

test("lifecycle probes use a separate destructive copy and leave the official corpus intact", async () => {
    const source = { activeRevisionId: "revision" };
    const evidence = {
        sourceId: "source",
        revisionId: "revision",
        locator: "turn:0",
    };
    const make = () => {
        let removed = false;
        return {
            search: async () => ({ matches: removed ? [] : [evidence] }),
            close: async () => {},
            initialize: async () => {},
            getSource: async () => (removed ? undefined : source),
            previewForgetSource: async () => ({ confirmationToken: "token" }),
            forgetSource: async () => {
                removed = true;
            },
            clearCorpus: async () => {
                removed = true;
            },
        };
    };
    const original = make();
    const copy = make();
    const result = await verifyIndexingLifecycle(
        original,
        async () => original,
        async () => ({ service: copy, reopen: async () => copy }),
        "corpus",
        "question",
        new AbortController().signal,
    );
    assert.equal(result.result.restart, "passed");
    assert.equal(result.result.forget, "passed");
    assert.equal(result.result.clear, "passed");
    assert.deepEqual((await original.search()).matches, [evidence]);
});

test("lifecycle closes its clone when opening the original fails", async () => {
    let closed = 0;
    await assert.rejects(
        verifyIndexingLifecycle(
            { search: async () => ({ matches: [] }), close: async () => {} },
            async () => {
                throw new Error("reopen failed");
            },
            async () => ({
                service: {
                    close: async () => {
                        closed++;
                    },
                },
            }),
            "corpus",
            "question",
            new AbortController().signal,
        ),
        /reopen failed/,
    );
    assert.equal(closed, 1);
});
