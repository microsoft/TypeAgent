// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { workerArguments } from "./watchdog.mjs";
import {
    analyzeRun,
    analyzeSupervisedRun,
    parseTimingLog,
    profileInvocation,
    summarizeJobs,
    summarizeTimings,
    intervalSummary,
    timingCategory,
    developmentFixtures,
    validateDevelopmentSpec,
    runDevelopmentEntries,
    closeDevelopmentService,
    developmentDiagnosticPolicy,
    developmentDiagnosticPolicyHash,
    configureDevelopmentDiagnostics,
    developmentTimingCapture,
    main,
} from "./ingestion-profile.mjs";
const require = createRequire(
    new URL("../../packages/knowPro/package.json", import.meta.url),
);
const ts = require("typescript");
const source = await readFile(
    new URL("../../packages/knowPro/src/searchTiming.ts", import.meta.url),
    "utf8",
);
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
    },
}).outputText;
const sourceTimingUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const {
    runWithSearchTiming,
    timeSearchStage,
    recordSearchTiming,
    instrumentExtractionModel,
    instrumentEmbeddingModel,
} = await import(sourceTimingUrl);

const date = (ms) => new Date(ms).toISOString();

async function observedSegmentStore(observer) {
    const key = "typeagent-ingestion-profile-segment-reader";
    const wrapper = `
        import * as native from "node:fs/promises";
        export * from "node:fs/promises";
        export async function readFile(...args) {
            const observer = globalThis[Symbol.for(${JSON.stringify(key)})];
            if (!observer || !String(args[0]).includes(".segments")) return native.readFile(...args);
            observer.active++;
            observer.maximum = Math.max(observer.maximum, observer.active);
            observer.calls.set(String(args[0]), (observer.calls.get(String(args[0])) ?? 0) + 1);
            try {
                await new Promise((resolve) => setTimeout(resolve, 2));
                if (String(args[0]) === observer.failPath) throw observer.failure;
                return await native.readFile(...args);
            } finally {
                observer.active--;
            }
        }`;
    const wrapperUrl = `data:text/javascript;base64,${Buffer.from(wrapper).toString("base64")}`;
    const codecSource = await readFile(
        new URL("../../packages/knowPro/src/fuzzyIndex.ts", import.meta.url),
        "utf8",
    );
    const codecAst = ts.createSourceFile(
        "fuzzyIndex.ts",
        codecSource,
        ts.ScriptTarget.Latest,
        true,
    );
    const codecFunctions = codecAst.statements.filter(
        (statement) =>
            ts.isFunctionDeclaration(statement) &&
            ["serializeEmbeddings", "deserializeEmbeddings"].includes(
                statement.name?.text,
            ),
    );
    assert.equal(codecFunctions.length, 2, "Missing production vector codec");
    const codecCode = ts.transpileModule(
        codecFunctions
            .map((statement) => statement.getText(codecAst))
            .join("\n"),
        {
            compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES2022,
            },
        },
    ).outputText;
    const codecUrl = `data:text/javascript;base64,${Buffer.from(codecCode).toString("base64")}`;
    const source = await readFile(
        new URL("../../packages/knowPro/src/segmentedJson.ts", import.meta.url),
        "utf8",
    );
    const code = ts
        .transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES2022,
            },
        })
        .outputText.replace('"node:fs/promises"', JSON.stringify(wrapperUrl))
        .replace('"./searchTiming.js"', JSON.stringify(sourceTimingUrl))
        .replace('"./fuzzyIndex.js"', JSON.stringify(codecUrl));
    globalThis[Symbol.for(key)] = observer;
    return {
        store: await import(
            `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
        ),
        restore: () => delete globalThis[Symbol.for(key)],
    };
}

test("source segment collector bounds validated reads, retains shared roots, drains failures before sweeping and reopens", async () => {
    const root = await mkdtemp(
        path.join(import.meta.dirname, "profile-test-segments-"),
    );
    const observer = { active: 0, maximum: 0, calls: new Map() };
    const { store, restore } = await observedSegmentStore(observer);
    try {
        const initial = {
            records: Array.from({ length: 96 }, (_, ordinal) => ({
                ordinal,
                text: "Synthetic retained segment. ".repeat(30),
            })),
        };
        const next = {
            records: [
                ...initial.records.slice(0, 64),
                { ordinal: 100, text: "New synthetic record" },
            ],
        };
        const oldFile = path.join(root, "old", "corpus_data.json");
        const currentFile = path.join(root, "current", "corpus_data.json");
        const orphanFile = path.join(root, "orphan", "corpus_data.json");
        const writeLegacy = async (file, data) => {
            const blobs = path.join(root, ".segments");
            await mkdir(blobs, { recursive: true });
            const node = async (value) => {
                const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
                const hash = createHash("sha256").update(bytes).digest("hex");
                await writeFile(path.join(blobs, `${hash}.json`), bytes);
                return hash;
            };
            const children = [];
            for (let offset = 0; offset < data.records.length; offset += 16) {
                const records = await Promise.all(
                    data.records
                        .slice(offset, offset + 16)
                        .map((value) => node({ kind: "value", value })),
                );
                children.push(await node({ kind: "items", children: records }));
            }
            const records = await node({ kind: "chunks", children });
            const hash = await node({
                kind: "object",
                entries: [["records", records]],
            });
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(
                file,
                JSON.stringify({
                    segmentedJsonVersion: 1,
                    root: hash,
                    metadata: {},
                }),
            );
        };
        await writeLegacy(oldFile, initial);
        await writeLegacy(currentFile, next);
        await store.collectJsonSegments(root);
        assert.ok(
            observer.maximum > 1,
            "Expected independent reads to overlap",
        );
        assert.ok(
            observer.maximum <= 8,
            "Collection exceeded bounded read concurrency",
        );
        assert.ok(
            [...observer.calls.values()].every((count) => count === 1),
            "Shared nodes should be marked only once",
        );
        const originalFlag = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        const originalWarn = console.warn;
        const originalClock = performance.now;
        const lines = [];
        let clockCalls = 0;
        try {
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
            performance.now = () => {
                clockCalls++;
                return originalClock.call(performance);
            };
            console.warn = (line) => lines.push(line);
            observer.calls.clear();
            await runWithSearchTiming("segments-off", "memory.ingestion", () =>
                store.collectJsonSegments(root),
            );
            const untracedReads = new Map(observer.calls);
            assert.equal(clockCalls, 0);
            assert.equal(lines.length, 0);
            process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
            observer.calls.clear();
            await runWithSearchTiming("segments-on", "memory.ingestion", () =>
                store.collectJsonSegments(root),
            );
            assert.deepEqual(
                observer.calls,
                untracedReads,
                "Tracing must not add segment file reads",
            );
            await runWithSearchTiming(
                "segments-write",
                "memory.ingestion",
                () =>
                    store.writeSegmentedJson(
                        path.join(root, "trace-fixture", "corpus_data.json"),
                        { value: 1 },
                        {},
                    ),
            );
            const events = parseTimingLog(lines.join("\n"));
            assert.equal(
                summarizeTimings(events).filesystemCoverage
                    .segmentBoundariesObserved,
                true,
            );
            assert.equal(
                summarizeTimings(events).filesystemCoverage
                    .allFilesystemCallsCovered,
                false,
            );
            for (const stage of [
                "storage.io.segment.lstat",
                "storage.io.segment.read",
                "storage.io.segment.readdir",
                "storage.io.segment.write",
                "storage.segment.json.parse",
                "storage.segment.json.serialize",
                "storage.segment.hash",
            ])
                assert.ok(
                    events.some((event) => event.stage === stage),
                    `Missing actual segment boundary ${stage}`,
                );
            assert.ok(
                events.every((event) =>
                    ["segments-on", "segments-write"].includes(event.traceId),
                ),
            );
        } finally {
            performance.now = originalClock;
            console.warn = originalWarn;
            if (originalFlag === undefined)
                delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
            else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = originalFlag;
        }
        const descriptor = async (file) =>
            JSON.parse(await readFile(file, "utf8"));
        assert.deepEqual(
            await store.readSegmentedJson(oldFile, await descriptor(oldFile)),
            initial,
        );
        assert.deepEqual(
            await store.readSegmentedJson(
                currentFile,
                await descriptor(currentFile),
            ),
            next,
        );

        await store.writeSegmentedJson(
            orphanFile,
            { text: "Orphan to collect only after successful marking" },
            {},
        );
        const orphan = await descriptor(orphanFile);
        const orphanSegment = path.join(
            root,
            ".segments",
            `${orphan.root}.json`,
        );
        await rm(path.dirname(orphanFile), { recursive: true });
        const current = await descriptor(currentFile);
        const rootNode = JSON.parse(
            await readFile(
                path.join(root, ".segments", `${current.root}.json`),
                "utf8",
            ),
        );
        const recordsHash = rootNode.entries.find(
            ([name]) => name === "records",
        )[1];
        const recordsNode = JSON.parse(
            await readFile(
                path.join(root, ".segments", `${recordsHash}.json`),
                "utf8",
            ),
        );
        const chunkNode = JSON.parse(
            await readFile(
                path.join(root, ".segments", `${recordsNode.children[0]}.json`),
                "utf8",
            ),
        );
        observer.failPath = path.join(
            root,
            ".segments",
            `${chunkNode.children[0]}.json`,
        );
        observer.failure = new Error("controlled segment read failure");
        const failedCollection = store.collectJsonSegments(root);
        const queuedFile = path.join(root, "queued", "corpus_data.json");
        const queuedWrite = store.writeSegmentedJson(
            queuedFile,
            { text: "Publication queued behind failed collection" },
            {},
        );
        await assert.rejects(
            failedCollection,
            (error) => error === observer.failure,
        );
        assert.equal(
            observer.active,
            0,
            "Failed collection released its root lock with outstanding reads",
        );
        assert.ok(
            (await readFile(orphanSegment)).length > 0,
            "Failed mark must not sweep orphans",
        );
        await queuedWrite;
        observer.failPath = undefined;
        await rm(path.dirname(oldFile), { recursive: true });
        await store.collectJsonSegments(root);
        await assert.rejects(readFile(orphanSegment), { code: "ENOENT" });
        assert.deepEqual(
            await store.readSegmentedJson(currentFile, current),
            next,
        );
        assert.deepEqual(
            await store.readSegmentedJson(
                queuedFile,
                await descriptor(queuedFile),
            ),
            { text: "Publication queued behind failed collection" },
        );

        const corruptFile = path.join(
            root,
            ".segments",
            `${chunkNode.children[0]}.json`,
        );
        await writeFile(corruptFile, "{}");
        await assert.rejects(
            store.collectJsonSegments(root),
            /Corrupt JSON segment/,
        );
        assert.equal(observer.active, 0);
    } finally {
        restore();
        await rm(root, { recursive: true, force: true });
    }
});

const job = {
    jobId: "job",
    sourceId: "source",
    revisionId: "revision",
    state: "complete",
    createdAt: date(0),
    updatedAt: date(1000),
    trace: [
        {
            message: "Documents chunked",
            timestamp: date(100),
            operation: "append",
        },
        { message: "Persisting index", timestamp: date(600) },
        { message: "Index persisted", timestamp: date(900) },
    ],
};

test("persisted job boundaries partition wall time without claiming extraction-only time", () => {
    const report = summarizeJobs([job]);
    assert.equal(report.wallTime.totalMs, 1000);
    assert.equal(report.partitions.admissionThroughChunkingMs.totalMs, 100);
    assert.equal(report.partitions.indexPreparationMs.totalMs, 500);
    assert.equal(report.partitions.indexPersistenceMs.totalMs, 300);
    assert.equal(report.partitions.postIndexThroughCompletionMs.totalMs, 100);
    assert.equal(
        Object.values(report.partitions).reduce(
            (sum, value) => sum + value.totalMs,
            0,
        ),
        1000,
    );
    assert.deepEqual(report.operations, { append: 1 });
    assert.match(report.interpretation, /combines extraction, embeddings/);
});

test("absent milestones remain unknown, and invalid timestamp order fails explicitly", () => {
    const report = summarizeJobs([{ ...job, trace: [] }]);
    assert.equal(report.partitionedJobs, 0);
    assert.deepEqual(report.unpartitionedJobIds, ["job"]);
    assert.equal(report.partitions.indexPreparationMs.meanMs, null);
    assert.throws(() => summarizeJobs([{ ...job, updatedAt: date(-1) }]));
    assert.throws(() =>
        summarizeJobs([
            {
                ...job,
                trace: [
                    { ...job.trace[0], timestamp: date(700) },
                    ...job.trace.slice(1),
                ],
            },
        ]),
    );
});

test("real production timing hooks preserve results and errors and emit parseable metadata-only stages", async () => {
    const original = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
    const warn = console.warn;
    const lines = [];
    process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
    console.warn = (value) => lines.push(value);
    const failure = new Error("controlled");
    try {
        const value = await runWithSearchTiming(
            "job",
            "memory.ingestion",
            () => timeSearchStage("ingestion.prepare", async () => 42),
            { sourceId: "source", sourceText: "PRIVATE_SOURCE_SENTINEL" },
        );
        assert.equal(value, 42);
        await assert.rejects(
            runWithSearchTiming("job", "memory.ingestion", () =>
                timeSearchStage("ingestion.commit", async () => {
                    throw failure;
                }),
            ),
            (error) => error === failure,
        );
    } finally {
        console.warn = warn;
        if (original === undefined)
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = original;
    }
    assert.equal(lines.join("\n").includes("PRIVATE_SOURCE_SENTINEL"), false);
    const events = parseTimingLog("unrelated stderr\n" + lines.join("\n"));
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => event.traceId === "job"));
    assert.equal(
        summarizeTimings(events).byStage["ingestion.commit"].errors,
        1,
    );
    assert.throws(() => parseTimingLog("[memory-search-timing] invalid-json"));
    assert.throws(() =>
        parseTimingLog(
            '[memory-search-timing] {"traceId":"job","stage":"x","elapsedMs":-1,"status":"success"}',
        ),
    );
    assert.match(summarizeTimings(events).interpretation, /overlap or nest/);
});

test("profile invocation enables the inherited production flag without changing runner arguments or endpoints", () => {
    const args = [
        "--authorized-live-benchmark",
        "--resume",
        path.resolve("owned"),
        "--max-questions",
        "1",
    ];
    const env = { PRESERVED_ENDPOINT_SENTINEL: "unchanged" };
    const invocation = profileInvocation(args, env);
    assert.deepEqual(invocation.args.slice(1), args);
    assert.equal(invocation.env.TYPEAGENT_MEMORY_SEARCH_TRACE, "1");
    assert.equal(invocation.env.PRESERVED_ENDPOINT_SENTINEL, "unchanged");
    assert.deepEqual(env, { PRESERVED_ENDPOINT_SENTINEL: "unchanged" });
    assert.throws(() => profileInvocation([]), /authorization/);
    assert.throws(
        () =>
            profileInvocation([
                "--authorized-live-benchmark",
                "--spec=worker.json",
            ]),
        /supervised CLI/,
    );
});

test("source model hooks preserve values, receiver, batching, failures, disabled promise identity and job correlation", async () => {
    const original = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
    const warn = console.warn;
    const lines = [];
    console.warn = (line) => lines.push(line);
    const failed = { success: false, message: "PRIVATE_PROVIDER_RESPONSE" };
    const value = { success: true, data: [1, 2] };
    const pending = Promise.resolve(value);
    const error = new Error("PRIVATE_THROWN_ERROR");
    const chat = {
        marker: 42,
        complete(input) {
            assert.equal(this.marker, 42);
            assert.equal(input, "PRIVATE_PROMPT");
            return Promise.resolve(failed);
        },
    };
    const embedding = {
        maxBatchSize: 5,
        embeddingIdentity: { dimensions: 2 },
        generateEmbedding() {
            assert.equal(this.maxBatchSize, 5);
            return pending;
        },
        generateEmbeddingBatch(inputs) {
            assert.equal(inputs.length, 2);
            return Promise.reject(error);
        },
    };
    try {
        delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        const model = instrumentEmbeddingModel(embedding);
        assert.equal(model.generateEmbedding("PRIVATE_TEXT"), pending);
        assert.equal(model.embeddingIdentity, embedding.embeddingIdentity);
        assert.equal(model.maxBatchSize, 5);
        assert.equal(lines.length, 0);
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        await Promise.all(
            ["job-a", "job-b"].map((jobId) =>
                runWithSearchTiming(jobId, "memory.ingestion", async () => {
                    assert.equal(
                        await instrumentExtractionModel(chat).complete(
                            "PRIVATE_PROMPT",
                        ),
                        failed,
                    );
                    assert.equal(
                        await model.generateEmbedding("PRIVATE_TEXT"),
                        value,
                    );
                    await assert.rejects(
                        model.generateEmbeddingBatch([
                            "PRIVATE_A",
                            "PRIVATE_B",
                        ]),
                        (caught) => caught === error,
                    );
                    recordSearchTiming("ingestion.extraction.output", 0, {
                        entities: 2,
                        topics: 3,
                        actions: 1,
                        secret: "PRIVATE_ATTRIBUTE",
                    });
                }),
            ),
        );
        const events = parseTimingLog(lines.join("\n"));
        const report = summarizeTimings(events);
        for (const jobId of ["job-a", "job-b"]) {
            assert.equal(
                report.byJob[jobId].byCategory.extraction.modelAttempts,
                1,
            );
            assert.equal(report.byJob[jobId].byCategory.extraction.errors, 1);
            assert.equal(report.byJob[jobId].byCategory.extraction.entities, 2);
            assert.equal(
                report.byJob[jobId].byCategory.embedding.modelAttempts,
                2,
            );
            assert.equal(
                report.byJob[jobId].byCategory.embedding.attemptedItems,
                3,
            );
            assert.equal(report.byJob[jobId].byCategory.embedding.errors, 1);
        }
        assert.equal(lines.join("\n").includes("PRIVATE_"), false);
        assert.ok(events.every((event) => Number.isFinite(event.endEpochMs)));
    } finally {
        console.warn = warn;
        if (original === undefined)
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = original;
    }
});

test("reports preserve repeated calls and failures, count items by layer and distinguish overlap from nonoverlap", () => {
    const events = [
        {
            traceId: "job",
            stage: "ingestion.embedding.call",
            elapsedMs: 100,
            endEpochMs: 200,
            status: "success",
            metadata: { calls: 1, items: 4 },
        },
        {
            traceId: "job",
            stage: "ingestion.embedding.attempt",
            elapsedMs: 40,
            endEpochMs: 150,
            status: "error",
            metadata: { attempts: 1, items: 4 },
        },
        {
            traceId: "job",
            stage: "ingestion.embedding.attempt",
            elapsedMs: 40,
            endEpochMs: 195,
            status: "success",
            metadata: { attempts: 1, items: 4 },
        },
    ];
    const report = summarizeTimings(events, { slowStageMs: 50 });
    assert.equal(report.byCategory.embedding.logicalCalls, 1);
    assert.equal(report.byCategory.embedding.modelAttempts, 2);
    assert.equal(report.byCategory.embedding.requestedItems, 4);
    assert.equal(report.byCategory.embedding.attemptedItems, 8);
    assert.equal(report.byCategory.embedding.unionMs, 100);
    assert.equal(report.byCategory.embedding.overlapOrNestingMs, 80);
    assert.equal(report.slowEvents.length, 1);
    assert.equal(report.observations.length, 3);
    assert.equal(report.byStage["ingestion.embedding.attempt"].p50Ms, 40);
    assert.equal(
        intervalSummary([{ ...events[0], endEpochMs: undefined }]).unionMs,
        null,
    );
    assert.equal(
        intervalSummary([
            { ...events[0], elapsedMs: 10, endEpochMs: 10 },
            { ...events[0], elapsedMs: 10, endEpochMs: 30 },
        ]).overlapOrNestingMs,
        0,
    );
    assert.throws(
        () => summarizeTimings(events, { slowStageMs: NaN }),
        /threshold/,
    );
    assert.equal(timingCategory("storage.io.copy"), "filesystemApiWall");
    assert.equal(timingCategory("queue.wait"), "serializedQueueWait");
    assert.equal(
        timingCategory("ingestion.document.chunk"),
        "parsingChunkingWall",
    );
    const parsed = parseTimingLog(
        "[memory-search-timing] " +
            JSON.stringify({
                ...events[0],
                metadata: {
                    items: 4,
                    sourceText: "PRIVATE_SOURCE",
                    endpoint: "https://private.invalid",
                },
            }),
    );
    assert.deepEqual(parsed[0].metadata, { items: 4 });
    assert.equal(JSON.stringify(parsed).includes("private"), false);
});

test("actual source embedding logical hook counts retries and marks validation failures without changing Result semantics", async () => {
    const loadSourceModule = async (relativePath) => {
        const url = new URL(relativePath, import.meta.url);
        const source = await readFile(url, "utf8");
        const code = ts.transpileModule(source, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.CommonJS,
            },
        }).outputText;
        const exports = {};
        new Function("require", "exports", code)(createRequire(url), exports);
        return exports;
    };
    const {
        embeddingInputLimitError,
        countEmbeddingTokens,
        maxEmbeddingInputTokens,
    } = await loadSourceModule("../../packages/aiclient/src/embeddingInput.ts");
    const { validateEmbeddingVector } = await loadSourceModule(
        "../../packages/aiclient/src/embeddingIdentity.ts",
    );
    const fuzzy = await readFile(
        new URL("../../packages/knowPro/src/fuzzyIndex.ts", import.meta.url),
        "utf8",
    );
    const ast = ts.createSourceFile(
        "fuzzyIndex.ts",
        fuzzy,
        ts.ScriptTarget.Latest,
        true,
    );
    const functions = ast.statements.filter(
        (statement) =>
            ts.isFunctionDeclaration(statement) &&
            [
                "generateTextEmbeddingsForIndex",
                "getEmbeddingBatches",
                "getIndexingBatches",
            ].includes(statement.name?.text),
    );
    assert.equal(functions.length, 3, "Missing production embedding helper");
    const definition = functions
        .map((statement) => statement.getText(ast))
        .join("\n");
    const code = ts
        .transpileModule(definition, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
            },
        })
        .outputText.replace(/^export /gm, "");
    let expectedBatchSize = 2;
    const run = new Function(
        "instrumentEmbeddingModel",
        "timeSearchStage",
        "embeddingModelForRole",
        "generateTextEmbeddingsWithRetry",
        "validateEmbeddingVector",
        "embeddingInputLimitError",
        "countEmbeddingTokens",
        "maxEmbeddingInputTokens",
        "success",
        "error",
        code + "\nreturn generateTextEmbeddingsForIndex;",
    )(
        instrumentEmbeddingModel,
        timeSearchStage,
        (model, role) => {
            assert.equal(role, "document");
            return model;
        },
        async (model, inputs) => {
            assert.equal(inputs.length, expectedBatchSize);
            const first = await model.generateEmbeddingBatch(inputs);
            assert.equal(first.success, false);
            const second = await model.generateEmbeddingBatch(inputs);
            return second.data;
        },
        validateEmbeddingVector,
        embeddingInputLimitError,
        countEmbeddingTokens,
        maxEmbeddingInputTokens,
        (data) => ({ success: true, data }),
        (message) => ({ success: false, message }),
    );
    const embeddings = [
        [1, 0],
        [0, 1],
    ];
    const warn = console.warn;
    const original = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
    const lines = [];
    try {
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        console.warn = (line) => lines.push(line);
        for (const validationFailure of [false, true]) {
            let attempt = 0;
            const result = await runWithSearchTiming(
                String(validationFailure),
                "memory.ingestion",
                () =>
                    run(
                        {
                            maxBatchSize: 2,
                            generateEmbeddingBatch: async () =>
                                ++attempt === 1
                                    ? {
                                          success: false,
                                          message: "PRIVATE_RETRY",
                                      }
                                    : {
                                          success: true,
                                          data: validationFailure
                                              ? [
                                                    [2, 0],
                                                    [0, 1],
                                                ]
                                              : embeddings,
                                      },
                        },
                        ["PRIVATE_ONE", "PRIVATE_TWO"],
                    ),
            );
            assert.equal(result.success, !validationFailure);
            if (result.success) assert.deepEqual(result.data, embeddings);
            else assert.match(result.message, /normalized 2-dimensional/);
            const trace = summarizeTimings(parseTimingLog(lines.join("\n")))
                .byJob[String(validationFailure)].byCategory.embedding;
            assert.equal(trace.logicalCalls, 1);
            assert.equal(trace.modelAttempts, 2);
            assert.equal(trace.requestedItems, 2);
            assert.equal(trace.attemptedItems, 4);
            assert.equal(trace.errors, validationFailure ? 2 : 1);
        }
        const linesBeforePreflight = lines.length;
        const oversized = " token".repeat(maxEmbeddingInputTokens + 1);
        assert.ok(countEmbeddingTokens(oversized) > maxEmbeddingInputTokens);
        const rejected = await run(
            {
                generateEmbeddingBatch: async () => {
                    assert.fail("Oversized input must fail before inference");
                },
            },
            [oversized],
        );
        assert.deepEqual(rejected, {
            success: false,
            message: embeddingInputLimitError([oversized]),
        });
        assert.equal(lines.length, linesBeforePreflight);
        expectedBatchSize = 1;
        const inputs = [" token".repeat(5000), " another".repeat(5000)];
        assert.equal(embeddingInputLimitError(inputs), undefined);
        assert.ok(
            inputs.reduce((sum, text) => sum + countEmbeddingTokens(text), 0) >
                maxEmbeddingInputTokens,
        );
        let attempts = 0;
        const batched = await runWithSearchTiming(
            "aggregate-token-limit",
            "memory.ingestion",
            () =>
                run(
                    {
                        embeddingIdentity: {
                            provider: "azure",
                            dimensions: 2,
                        },
                        generateEmbeddingBatch: async () =>
                            ++attempts % 2
                                ? { success: false, message: "PRIVATE_RETRY" }
                                : { success: true, data: [[1, 0]] },
                    },
                    inputs,
                ),
        );
        assert.deepEqual(batched, {
            success: true,
            data: [
                [1, 0],
                [1, 0],
            ],
        });
        const batchTrace = summarizeTimings(parseTimingLog(lines.join("\n")))
            .byJob["aggregate-token-limit"].byCategory.embedding;
        assert.equal(batchTrace.logicalCalls, 1);
        assert.equal(batchTrace.modelAttempts, 4);
        assert.equal(batchTrace.requestedItems, 2);
        assert.equal(batchTrace.attemptedItems, 4);
        assert.equal(batchTrace.errors, 2);
        assert.equal(lines.join("\n").includes("PRIVATE_"), false);
    } finally {
        console.warn = warn;
        if (original === undefined)
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = original;
    }
});

test("noncomplete jobs remain explicit instead of being dropped or described as complete", () => {
    const report = summarizeJobs([
        { ...job, state: "failed", warnings: ["PRIVATE_ERROR"] },
        { ...job, jobId: "cancelled", state: "cancelled" },
    ]);
    assert.deepEqual(report.states, { failed: 1, cancelled: 1 });
    assert.equal(report.jobs[0].warningCount, 1);
    assert.equal(JSON.stringify(report).includes("PRIVATE_"), false);
});

test("source extraction hook keeps failed Results and exceptions, and only counts successful structured outputs", async () => {
    const knowledge = await readFile(
        new URL("../../packages/knowPro/src/knowledge.ts", import.meta.url),
        "utf8",
    );
    const definition = knowledge.slice(
        knowledge.indexOf("export function extractKnowledgeFromText("),
        knowledge.indexOf("export function extractKnowledgeFromTextBatch("),
    );
    const code = ts
        .transpileModule(definition, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
            },
        })
        .outputText.replace(/^export /gm, "");
    const extract = new Function(
        "async",
        "timeSearchStage",
        "recordSearchTiming",
        code + "\nreturn extractKnowledgeFromText;",
    )(
        { callWithRetry: (operation) => operation() },
        timeSearchStage,
        recordSearchTiming,
    );
    const failed = { success: false, message: "PRIVATE_EXTRACTION_FAILURE" };
    const success = {
        success: true,
        data: {
            entities: [{ name: "PRIVATE_ENTITY" }],
            topics: ["PRIVATE_TOPIC"],
            actions: [],
            inverseActions: [],
        },
    };
    const thrown = new Error("PRIVATE_EXTRACTION_EXCEPTION");
    const original = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
    const warn = console.warn;
    const lines = [];
    try {
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        console.warn = (line) => lines.push(line);
        await runWithSearchTiming(
            "extraction-job",
            "memory.ingestion",
            async () => {
                for (const result of [failed, success])
                    assert.equal(
                        await extract(
                            {
                                extractWithRetry: async (_text, retries) => {
                                    assert.equal(retries, 3);
                                    return result;
                                },
                            },
                            "PRIVATE_SOURCE",
                            3,
                        ),
                        result,
                    );
                await assert.rejects(
                    extract(
                        {
                            extractWithRetry: async () => {
                                throw thrown;
                            },
                        },
                        "PRIVATE_SOURCE",
                        3,
                    ),
                    (error) => error === thrown,
                );
            },
        );
        const report = summarizeTimings(parseTimingLog(lines.join("\n")));
        assert.equal(report.byCategory.extraction.logicalCalls, 3);
        assert.equal(report.byCategory.extraction.errors, 2);
        assert.equal(report.byCategory.extraction.entities, 1);
        assert.equal(report.byCategory.extraction.topics, 1);
        assert.equal(lines.join("\n").includes("PRIVATE_"), false);
    } finally {
        console.warn = warn;
        if (original === undefined)
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = original;
    }
});

test("development entries satisfy actual source admission, including HTML and retained replacement", async () => {
    const source = await readFile(
        new URL(
            "../../packages/memory/service/src/fileMemoryService.ts",
            import.meta.url,
        ),
        "utf8",
    );
    const definition = source.slice(
        source.indexOf("function contentFor("),
        source.indexOf("function hashContent("),
    );
    const code = ts.transpileModule(definition, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const contentFor = new Function(code + "\nreturn contentFor;")();
    const html = developmentFixtures()[1];
    assert.throws(
        () =>
            contentFor({
                source: { ...html, html: undefined, text: html.html },
            }),
        /^Error: HTML sources require html content$/,
    );
    const state = { cases: { development: { operations: [] } } };
    const requests = [];
    await runDevelopmentEntries(
        {
            async ingestDocument(request) {
                assert.ok(contentFor(request).length > 0);
                requests.push(request);
                return {
                    jobId: `job-${requests.length}`,
                    sourceId:
                        request.source.sourceId ?? `source-${requests.length}`,
                    revisionId: `revision-${requests.length}`,
                };
            },
        },
        async () => ({ state: "complete", warnings: [] }),
        "development-corpus",
        new AbortController().signal,
        state,
        async () => {},
    );
    assert.equal(requests.length, 4);
    assert.equal(requests[1].source.html, html.html);
    assert.equal(requests[1].source.text, undefined);
    assert.equal(requests[3].source.sourceId, "source-1");
    assert.equal(requests[3].pipeline.updatePolicy, "retainRevisionHistory");
    assert.equal(state.cases.development.operations.length, 4);
    assert.equal(state.activeEntry, undefined);
});

test("second admission failure is safely persisted with entry identity before close, and close failure cannot erase it", async () => {
    const snapshots = [];
    const state = {
        cases: { development: { operations: [] } },
        outcome: "DEVELOPMENT_RUNNING",
    };
    const persist = async () => snapshots.push(structuredClone(state));
    const admissionError = new Error("HTML sources require html content");
    let admissions = 0;
    const service = {
        async ingestDocument() {
            if (++admissions === 2) throw admissionError;
            return {
                jobId: "first-job",
                sourceId: "first-source",
                revisionId: "first-revision",
            };
        },
        async close() {
            assert.equal(
                snapshots.at(-1).failure.code,
                "HTML_CONTENT_FIELD_REQUIRED",
            );
            assert.equal(snapshots.at(-1).failure.entry.ordinal, 1);
            throw new Error("PRIVATE_CLOSE_SECRET https://private.invalid");
        },
    };
    await assert.rejects(
        runDevelopmentEntries(
            service,
            async () => ({ state: "complete" }),
            "corpus",
            new AbortController().signal,
            state,
            persist,
        ),
        (error) => error === admissionError,
    );
    assert.equal(snapshots.at(-1).outcome, "FAILED_DEVELOPMENT_INGESTION");
    assert.equal(state.failure.phase, "admission");
    assert.equal(state.failure.entry.sourceType, "html");
    assert.equal(state.failure.entry.operation, "ingest");
    assert.match(state.failure.entry.fixtureSha256, /^[a-f0-9]{64}$/);
    assert.equal(state.failure.message, "HTML sources require html content");
    assert.equal(state.cases.development.operations.length, 1);
    await closeDevelopmentService(service, state, persist);
    assert.equal(state.outcome, "FAILED_DEVELOPMENT_INGESTION");
    assert.equal(state.close, "FAILED");
    assert.equal(state.closeFailure.phase, "service-close");
    assert.equal(JSON.stringify(snapshots).includes("PRIVATE_"), false);
    assert.equal(JSON.stringify(snapshots).includes("https://"), false);
    assert.equal(
        JSON.stringify(snapshots).includes(developmentFixtures()[0].text),
        false,
    );
});

test("development mode is fixed synthetic ingestion, independently authorized, bounded and no gold input", () => {
    const fixtures = developmentFixtures();
    assert.deepEqual(
        fixtures.map((fixture) => fixture.sourceType),
        ["markdown", "html", "text"],
    );
    assert.ok(fixtures.every((fixture) => !fixture.canonicalUri));
    const args = workerArguments(
        {
            performance: true,
            nativeProfile: true,
            runDirectory: path.resolve("owned-development"),
        },
        "ingestion-worker.mjs",
        "owned-spec.json",
    );
    assert.ok(args.includes("--cpu-prof"));
    assert.ok(
        args.indexOf("--cpu-prof") < args.indexOf("ingestion-worker.mjs"),
    );
    assert.deepEqual(args.slice(-3), [
        "ingestion-worker.mjs",
        "--spec",
        "owned-spec.json",
    ]);
    assert.throws(
        () =>
            validateDevelopmentSpec({
                mode: "DEVELOPMENT_INGESTION_PROFILE",
                authorizedDevelopmentInference: false,
            }),
        /authorization/,
    );
});

test("development-only diagnostic policy overrides inherited tracing intentionally and is bound to receipt/checkpoint", async () => {
    const policySpec = (enabled, nativeWorkerCpu = false) => {
        const spec = {
            mode: "DEVELOPMENT_INGESTION_PROFILE",
            receiptId: "owned-receipt",
            expectedCheckpoint: {
                name: "frozen",
                hashes: { artifact: "a".repeat(64) },
            },
            nativeProfile: nativeWorkerCpu,
            diagnosticPolicy: developmentDiagnosticPolicy(
                enabled,
                nativeWorkerCpu,
            ),
        };
        spec.diagnosticPolicySha256 = developmentDiagnosticPolicyHash(spec);
        return spec;
    };
    const inherited = {
        TYPEAGENT_MEMORY_SEARCH_TRACE: "1",
        UNCHANGED: "preserved",
    };
    const disabled = policySpec(false, true);
    configureDevelopmentDiagnostics(disabled, inherited);
    assert.deepEqual(inherited, {
        TYPEAGENT_MEMORY_SEARCH_TRACE: "0",
        UNCHANGED: "preserved",
    });
    assert.equal(disabled.diagnosticPolicy.nativeWorkerCpu, true);
    const enabled = policySpec(true);
    configureDevelopmentDiagnostics(enabled, inherited);
    assert.equal(inherited.TYPEAGENT_MEMORY_SEARCH_TRACE, "1");
    assert.equal(developmentDiagnosticPolicy().stageTiming, "detailed");
    assert.notEqual(
        enabled.diagnosticPolicySha256,
        disabled.diagnosticPolicySha256,
    );
    assert.throws(
        () =>
            configureDevelopmentDiagnostics(
                { ...disabled, receiptId: "different-owner" },
                inherited,
            ),
        /fingerprint/,
    );
    assert.throws(
        () =>
            configureDevelopmentDiagnostics(
                { ...disabled, mode: "longmemeval-full500" },
                inherited,
            ),
        /development-only/,
    );
    assert.throws(
        () =>
            configureDevelopmentDiagnostics(
                {
                    ...disabled,
                    diagnosticPolicy: developmentDiagnosticPolicy(true, true),
                },
                inherited,
            ),
        /fingerprint/,
    );
    assert.throws(
        () =>
            profileInvocation([
                "--authorized-live-benchmark",
                "--no-stage-timing",
            ]),
        /development-only/,
    );
    assert.equal(
        profileInvocation(["--authorized-live-benchmark"], {
            TYPEAGENT_MEMORY_SEARCH_TRACE: "0",
        }).env.TYPEAGENT_MEMORY_SEARCH_TRACE,
        "1",
    );
    await assert.rejects(
        main([
            "analyze",
            "--no-stage-timing",
            "--output",
            path.resolve("unused-diagnostic-policy-output"),
        ]),
        /development-only/,
    );
    assert.equal(
        developmentTimingCapture(disabled.diagnosticPolicy, false),
        "INTENTIONALLY_DISABLED",
    );
    assert.equal(
        developmentTimingCapture(disabled.diagnosticPolicy, true),
        "UNEXPECTED_EVENTS_WHILE_DISABLED",
    );
    assert.equal(
        developmentTimingCapture(enabled.diagnosticPolicy, false),
        "MISSING",
    );
    assert.equal(
        developmentTimingCapture(enabled.diagnosticPolicy, true),
        "CAPTURED",
    );
});

test("source timing boundaries wrap asynchronous I/O and preserve reader context in both synthesized outcomes", async () => {
    const service = await readFile(
        new URL(
            "../../packages/memory/service/src/fileMemoryService.ts",
            import.meta.url,
        ),
        "utf8",
    );
    const ioSource = service.slice(
        service.indexOf(
            "const { access, cp, mkdir, readFile, readdir, rename, rm, writeFile }",
        ),
        service.indexOf("function writeRunbookJson("),
    );
    const ioCode = ts.transpileModule(ioSource, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const value = Buffer.from("synthetic");
    const failure = new Error("PRIVATE_IO_ERROR");
    const io = new Function(
        "filesystem",
        "timeSearchStage",
        ioCode + "\nreturn { readFile, cp };",
    )(
        {
            readFile: () => Promise.resolve(value),
            cp: () => Promise.reject(failure),
        },
        timeSearchStage,
    );
    const original = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
    const warn = console.warn;
    const lines = [];
    try {
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        console.warn = (line) => lines.push(line);
        await runWithSearchTiming("io-job", "memory.ingestion", async () => {
            assert.equal(await io.readFile("PRIVATE_PATH"), value);
            await assert.rejects(
                io.cp("PRIVATE_FROM", "PRIVATE_TO"),
                (error) => error === failure,
            );
        });
        assert.deepEqual(
            parseTimingLog(lines.join("\n")).map((event) => [
                event.stage,
                event.status,
            ]),
            [
                ["storage.io.read", "success"],
                ["storage.io.copy", "error"],
            ],
        );
        assert.equal(lines.join("\n").includes("PRIVATE_"), false);
    } finally {
        console.warn = warn;
        if (original === undefined)
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = original;
    }
    for (const stage of [
        "storage.io.read",
        "storage.io.write",
        "storage.io.copy",
        "storage.segments.collect",
        "ingestion.commit.queue",
        "ingestion.postIndex.purgeText",
        "ingestion.admissionThroughCompletion",
    ])
        assert.ok(service.includes(`"${stage}"`), `Missing ${stage}`);
    assert.equal(
        (service.match(/readerContext: result\.readerContext/g) ?? []).length,
        2,
    );
    const knowledge = await readFile(
        new URL("../../packages/knowPro/src/knowledge.ts", import.meta.url),
        "utf8",
    );
    assert.match(knowledge, /instrumentExtractionModel\(chatModel\)/);
    assert.match(knowledge, /ingestion\.extraction\.call/);
    const fuzzy = await readFile(
        new URL("../../packages/knowPro/src/fuzzyIndex.ts", import.meta.url),
        "utf8",
    );
    assert.match(
        fuzzy,
        /instrumentEmbeddingModel\(\s*embeddingModelForRole\(embeddingModel, "document"\)/,
    );
});
test("analysis reads completed job identities, reports recovered missing IDs and never copies source bodies", async () => {
    const root = await mkdtemp(path.join(import.meta.dirname, "profile-test-"));
    try {
        await mkdir(path.join(root, "isolated-store", "jobs"), {
            recursive: true,
        });
        const state = {
            compiledDigest: "compiled",
            engineHash: "engine",
            cases: {
                case: {
                    operations: [
                        {
                            jobId: "job",
                            sourceId: "source",
                            revisionId: "revision",
                        },
                        { sourceKey: "recovered-ready" },
                    ],
                    hypothesis: "PRIVATE_ANSWER_SENTINEL",
                },
            },
            providerRequests: [
                {
                    role: "ingestion:case",
                    model: "model",
                    status: 200,
                    durationMs: 500,
                    body: "PRIVATE_BODY_SENTINEL",
                },
            ],
        };
        await writeFile(
            path.join(root, "benchmark-state.json"),
            JSON.stringify(state),
        );
        await writeFile(
            path.join(root, "isolated-store", "jobs", "job.json"),
            JSON.stringify(job),
        );
        const before = await readFile(
            path.join(root, "benchmark-state.json"),
            "utf8",
        );
        const report = await analyzeRun(root);
        assert.equal(report.jobs.wallTime.count, 1);
        assert.equal(report.missingJobIds.length, 1);
        assert.equal(report.productionTiming.available, false);
        assert.equal(report.productionTiming.logSupplied, false);
        assert.equal(JSON.stringify(report).includes("PRIVATE_"), false);
        const timingLog = path.join(root, "stderr-1234.log");
        await writeFile(timingLog, "ordinary worker stderr\n");
        const empty = await analyzeRun(root, timingLog);
        assert.equal(empty.productionTiming.logSupplied, true);
        assert.equal(empty.productionTiming.available, false);
        await writeFile(
            timingLog,
            '[memory-search-timing] {"traceId":"job","scope":"memory.ingestion","stage":"ingestion.prepare","elapsedMs":500,"status":"success"}\n',
        );
        await writeFile(
            path.join(root, "stderr.log"),
            "supervisor has no stage events\n",
        );
        const exited = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
        await once(exited, "close");
        const termination = {
            startedEpochMs: 1234,
            workerExited: true,
            workerPid: exited.pid,
            watchdogPid: exited.pid,
        };
        await writeFile(
            path.join(root, "termination.json"),
            JSON.stringify(termination),
        );
        const supervised = await analyzeSupervisedRun(root);
        assert.equal(supervised.workerTimingLog, timingLog);
        assert.equal(supervised.profile.productionTiming.available, true);
        assert.equal(
            supervised.profile.productionTiming.byStage["ingestion.prepare"]
                .totalMs,
            500,
        );
        assert.deepEqual(
            supervised.profile.productionTiming.byStage["ingestion.prepare"]
                .traceIds,
            ["job"],
        );
        await writeFile(
            path.join(root, "termination.json"),
            JSON.stringify({ ...termination, workerPid: process.pid }),
        );
        await assert.rejects(analyzeSupervisedRun(root), /Expected values/);
        assert.equal(
            await readFile(path.join(root, "benchmark-state.json"), "utf8"),
            before,
        );
        await writeFile(
            path.join(root, "isolated-store", "jobs", "job.json"),
            JSON.stringify({ ...job, sourceId: "wrong" }),
        );
        await assert.rejects(analyzeRun(root), /Expected values/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
