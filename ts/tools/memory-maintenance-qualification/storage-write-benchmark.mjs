// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createKnowProCorpusIndex } from "../../packages/memory/service/dist/knowProCorpusIndex.js";
import { createDocMemorySettings } from "../../packages/memory/conversation/dist/docMemory.js";
import {
    writeSegmentedJson,
    readSegmentedJson,
} from "../../packages/knowPro/dist/segmentedJson.js";
import { waitForMemoryJob } from "../../packages/memory/service/dist/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "../../packages/memory/service/dist/test/fakeSemanticCorpusIndex.js";

const copyDirectory = fs.cp;
let onIndexCopy;
// Product timing wrappers capture filesystem methods when the service loads.
fs.cp = async function (...args) {
    const result = await copyDirectory(...args);
    onIndexCopy?.();
    return result;
};
syncBuiltinESMExports();
let FileMemoryService;
try {
    ({ FileMemoryService } = await import(
        "../../packages/memory/service/dist/fileMemoryService.js"
    ));
} finally {
    fs.cp = copyDirectory;
    syncBuiltinESMExports();
}

const productRoot = fileURLToPath(new URL("../../", import.meta.url));

function summary(samples) {
    const ordered = [...samples].sort((a, b) => a - b);
    return {
        samples,
        p50: ordered[Math.ceil(ordered.length * 0.5) - 1],
        p95: ordered[Math.ceil(ordered.length * 0.95) - 1],
    };
}

async function workload(root, count, samples) {
    const counters = {
        manifestWrites: 0,
        manifestBytes: 0,
        textBlobWrites: 0,
        textBlobBytes: 0,
        providerDocuments: 0,
    };
    let measuring = false;
    class CountingIndex extends FakeSemanticCorpusIndex {
        async rebuild(documents) {
            if (measuring) counters.providerDocuments += documents.length;
            await super.rebuild(documents);
        }
    }
    const service = new FileMemoryService(root, {
        viewDrafts: false,
        informationalViews: false,
        sourceSynopses: false,
        indexFactory: (_, directory) => new CountingIndex(directory),
    });
    const writeFile = fs.writeFile;
    fs.writeFile = async function (file, data, ...args) {
        const result = await writeFile.call(this, file, data, ...args);
        if (measuring && typeof file === "string") {
            const bytes =
                typeof data === "string"
                    ? Buffer.byteLength(data)
                    : data.byteLength;
            if (path.basename(file).startsWith("manifest.json.")) {
                counters.manifestWrites++;
                counters.manifestBytes += bytes;
            } else if (file.includes(`${path.sep}revision-text${path.sep}`)) {
                counters.textBlobWrites++;
                counters.textBlobBytes += bytes;
            }
        }
        return result;
    };
    syncBuiltinESMExports();
    try {
        const corpus = await service.createCorpus("Fixed storage workload");
        const corpusId = corpus.corpusId;
        const payload = "offline retained text ".repeat(3200).slice(0, 65536);
        async function ingest(sourceId, suffix) {
            const accepted = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId,
                    sourceType: "text",
                    title: sourceId,
                    text: `${payload}${sourceId}:${suffix}`,
                },
                pipeline: { updatePolicy: "replaceActiveRevision" },
            });
            const job = await waitForMemoryJob(service, accepted.jobId);
            assert.equal(job.state, "complete", job.error);
        }
        for (let i = 0; i < count; i++) await ingest(`source-${i}`, "seed");
        const observations = [];
        for (let i = 0; i < samples; i++) {
            for (const key of Object.keys(counters)) counters[key] = 0;
            measuring = true;
            const start = performance.now();
            await ingest("source-0", `replacement-${i}`);
            const elapsedMs = performance.now() - start;
            measuring = false;
            const retained = await service.getSourceContent({
                corpusId,
                sourceId: `source-${count - 1}`,
                offset: payload.length,
            });
            assert.ok(retained.content.includes(`source-${count - 1}:seed`));
            const manifestBytes = (
                await fs.stat(path.join(root, corpusId, "manifest.json"))
            ).size;
            observations.push({
                elapsedMs,
                ...counters,
                manifestSizeBytes: manifestBytes,
            });
        }
        return {
            sourceCount: count,
            textBytesPerSource: 65536,
            elapsedMs: summary(observations.map((sample) => sample.elapsedMs)),
            observations,
        };
    } finally {
        measuring = false;
        fs.writeFile = writeFile;
        syncBuiltinESMExports();
        await service.close();
    }
}

async function batchWorkload(root, samples) {
    const observations = [];
    for (let sample = 0; sample < samples; sample++) {
        const counters = {
            indexCopies: 0,
            manifestWrites: 0,
            manifestBytes: 0,
            providerBatches: 0,
            providerDocuments: 0,
        };
        let measuring = false;
        class CountingIndex extends FakeSemanticCorpusIndex {
            async append(documents) {
                if (measuring) {
                    counters.providerBatches++;
                    counters.providerDocuments += documents.length;
                }
                await super.append(documents);
            }
        }
        const directory = path.join(root, `batch-${sample}`);
        const service = new FileMemoryService(directory, {
            viewDrafts: false,
            informationalViews: false,
            sourceSynopses: false,
            indexFactory: (_, indexDirectory) =>
                new CountingIndex(indexDirectory),
        });
        const writeFile = fs.writeFile;
        fs.writeFile = async function (file, data, ...args) {
            const result = await writeFile.call(this, file, data, ...args);
            if (
                measuring &&
                typeof file === "string" &&
                path.basename(file).startsWith("manifest.json.")
            ) {
                counters.manifestWrites++;
                counters.manifestBytes += Buffer.byteLength(data);
            }
            return result;
        };
        onIndexCopy = () => {
            if (measuring) counters.indexCopies++;
        };
        syncBuiltinESMExports();
        try {
            const { corpusId } = await service.createCorpus(
                "Batch storage workload",
            );
            const seed = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId: "seed",
                    sourceType: "text",
                    title: "seed",
                    text: "Retained seed content",
                },
            });
            assert.equal(
                (
                    await waitForMemoryJob(service, seed.jobId, {
                        pollIntervalMs: 5,
                    })
                ).state,
                "complete",
            );
            measuring = true;
            const start = performance.now();
            let batch = await service.startBatchImport({
                corpusId,
                idempotencyKey: "fixed-batch",
                documents: Array.from({ length: 8 }, (_, i) => ({
                    source: {
                        sourceId: `member-${i}`,
                        sourceType: "text",
                        title: `member-${i}`,
                        text: `${"offline acquired text ".repeat(500)}unique member ${i}`,
                    },
                })),
            });
            while (batch.state === "running") {
                await new Promise((resolve) => setTimeout(resolve, 5));
                batch = await service.getBatchImport(batch.batchId);
            }
            const elapsedMs = performance.now() - start;
            measuring = false;
            assert.equal(batch.state, "complete", JSON.stringify(batch));
            assert.equal(batch.members.length, 8);
            assert.ok(
                batch.members.every(
                    (member) => member.state === "complete" && member.jobId,
                ),
            );
            assert.equal((await service.listSources(corpusId)).length, 9);
            for (let i = 0; i < 8; i++)
                assert.ok(
                    (
                        await service.getSourceContent({
                            corpusId,
                            sourceId: `member-${i}`,
                            offset: 11000,
                        })
                    ).content.includes(`unique member ${i}`),
                );
            observations.push({ elapsedMs, ...counters });
        } finally {
            measuring = false;
            fs.writeFile = writeFile;
            onIndexCopy = undefined;
            syncBuiltinESMExports();
            await service.close();
        }
    }
    return {
        memberCount: 8,
        retainedSourceCount: 1,
        observations,
        elapsedMs: summary(observations.map((sample) => sample.elapsedMs)),
    };
}

async function deltaWorkload(root, samples, delta) {
    const previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
    let providerDocuments = 0;
    const languageModel = {
        completionSettings: {},
        complete: async () => ({
            success: true,
            data: JSON.stringify({
                searchExpressions: [
                    {
                        rewrittenQuery: "Zephyr",
                        filters: [
                            {
                                entitySearchTerms: [
                                    { name: "Zephyr", isNamePronoun: false },
                                ],
                            },
                        ],
                    },
                ],
            }),
        }),
    };
    const service = new FileMemoryService(root, {
        viewDrafts: false,
        informationalViews: false,
        sourceSynopses: false,
        indexFactory: (corpusId, directory) => {
            const index = createKnowProCorpusIndex(corpusId, directory, () => {
                const settings = createDocMemorySettings(
                    64,
                    undefined,
                    languageModel,
                );
                settings.embeddingSize = 0;
                const knowledge = () => ({
                    entities: [{ name: "Zephyr", type: ["service"] }],
                    actions: [],
                    inverseActions: [],
                    topics: [],
                });
                settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
                    {
                        settings: { maxContextLength: 1000 },
                        extract: async () => knowledge(),
                        extractWithRetry: async () => {
                            providerDocuments++;
                            return { success: true, data: knowledge() };
                        },
                    };
                return settings;
            });
            if (!delta) index.replace = undefined;
            return index;
        },
    });
    try {
        const { corpusId } = await service.createCorpus(
            "Fixed real KnowPro delta workload",
        );
        const ingest = async (sourceId, suffix) => {
            const accepted = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId,
                    sourceType: "text",
                    title: sourceId,
                    text: `Zephyr ${"Retained knowledge. ".repeat(180)}${sourceId}:${suffix}`,
                },
                pipeline: { updatePolicy: "retainRevisionHistory" },
            });
            const job = await waitForMemoryJob(service, accepted.jobId);
            assert.equal(job.state, "complete", job.error);
        };
        for (let i = 0; i < 8; i++) await ingest(`source-${i}`, "seed");
        const observations = [];
        for (let i = 0; i < samples; i++) {
            providerDocuments = 0;
            const started = performance.now();
            await ingest("source-0", `replacement-${i}`);
            const elapsedMs = performance.now() - started;
            assert.equal(providerDocuments, delta ? 1 : 8);
            const hits = await service.search({
                corpusId,
                query: "Zephyr",
                limit: 20,
            });
            assert.deepEqual(
                hits.matches.map((hit) => hit.sourceId).sort(),
                Array.from({ length: 8 }, (_, n) => `source-${n}`),
            );
            assert.equal(
                hits.matches
                    .find((hit) => hit.sourceId === "source-0")
                    ?.snippet.includes(`replacement-${i}`),
                true,
            );
            observations.push({
                elapsedMs,
                providerDocuments,
                groundedSourceMatches: hits.matches.length,
            });
        }
        return {
            sourceCount: 8,
            delta,
            elapsedMs: summary(observations.map((value) => value.elapsedMs)),
            observations,
        };
    } finally {
        await service.close();
        if (previousProvider === undefined)
            delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        else process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
    }
}

async function segmentWorkload(root, samples, recordCount) {
    const data = {
        records: Array.from({ length: recordCount }, (_, ordinal) => ({
            ordinal,
            text: `${"Retained source knowledge. ".repeat(24)}${ordinal}`,
        })),
        vectors: [[0.6, 0.8]],
    };
    const initial = path.join(root, "initial", "corpus_data.json");
    await writeSegmentedJson(initial, data, { messages: recordCount });
    const segments = path.join(root, ".segments");
    const observations = [];
    for (let i = 0; i < samples; i++) {
        const retained = new Map(
            await Promise.all(
                (await fs.readdir(segments)).map(async (name) => [
                    name,
                    await fs.stat(path.join(segments, name)),
                ]),
            ),
        );
        data.records.push({
            ordinal: recordCount + i,
            text: `Changed source ${i}`,
        });
        const file = path.join(root, `generation-${i}`, "corpus_data.json");
        await writeSegmentedJson(file, data, { messages: data.records.length });
        let segmentBytes = 0;
        let segmentWrites = 0;
        for (const name of await fs.readdir(segments)) {
            const info = await fs.stat(path.join(segments, name));
            if (retained.has(name)) {
                assert.equal(info.ino, retained.get(name).ino);
                assert.equal(info.mtimeMs, retained.get(name).mtimeMs);
            } else {
                segmentWrites++;
                segmentBytes += info.size;
            }
        }
        const descriptorBytes = (await fs.stat(file)).size;
        const baseline = JSON.stringify(data);
        await fs.writeFile(
            path.join(root, "reconstructed-monolithic.json"),
            baseline,
        );
        assert.deepEqual(
            await readSegmentedJson(
                file,
                JSON.parse(await fs.readFile(file, "utf8")),
            ),
            data,
        );
        // One partial 64 KiB chunk plus bounded publication/descriptor metadata.
        assert.ok(segmentBytes + descriptorBytes < 80 * 1024);
        assert.ok(
            segmentBytes + descriptorBytes < Buffer.byteLength(baseline) / 4,
        );
        if (recordCount >= 4096)
            assert.ok(
                segmentBytes + descriptorBytes <
                    Buffer.byteLength(baseline) / 20,
            );
        observations.push({
            monolithicJsonBytes: Buffer.byteLength(baseline),
            segmentBytes,
            segmentWrites,
            descriptorBytes,
            retainedSegmentsRewritten: 0,
        });
    }
    return {
        scope: "Identical synthetic JSON values, reconstructed prior whole-JSON serialization versus actual coarse immutable node and descriptor bytes. Append budget includes a partial 64 KiB tail plus publication metadata. Excludes index metadata, GC reads/deletes, fsyncs and device I/O; not a full live index benchmark.",
        recordCount,
        observations,
    };
}

export async function runStorageWriteBenchmark(samples, kind = "replace") {
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "typeagent-storage-write-"),
    );
    const cpu = process.cpuUsage();
    try {
        const workloads = {};
        if (kind === "delta") {
            workloads["replacement-full-rebuild"] = await deltaWorkload(
                path.join(root, "rebuild"),
                samples,
                false,
            );
            workloads["replacement-delta"] = await deltaWorkload(
                path.join(root, "delta"),
                samples,
                true,
            );
            for (const records of [1024, 4096])
                workloads[`segmented-append-${records}`] =
                    await segmentWorkload(
                        path.join(root, `segmented-${records}`),
                        samples,
                        records,
                    );
        } else if (kind === "batch")
            workloads["batch-eight-new-sources"] = await batchWorkload(
                root,
                samples,
            );
        else
            for (const count of [8, 64])
                workloads[`replace-one-of-${count}`] = await workload(
                    path.join(root, `sources-${count}`),
                    count,
                    samples,
                );
        const files = [
            "packages/memory/service/dist/fileMemoryService.js",
            "packages/memory/service/dist/revisionTextStore.js",
            "packages/memory/service/dist/batchImport.js",
            "packages/memory/service/dist/boundedIngestionGroup.js",
            "packages/memory/service/dist/test/fakeSemanticCorpusIndex.js",
            "packages/memory/service/dist/knowProCorpusIndex.js",
            "packages/knowPro/dist/segmentedJson.js",
            "packages/knowPro/dist/search.js",
            "tools/memory-maintenance-qualification/storage-write-benchmark.mjs",
        ];
        const checkpoint = {};
        for (const file of files)
            checkpoint[file] = createHash("sha256")
                .update(await fs.readFile(path.join(productRoot, file)))
                .digest("hex");
        return {
            schemaVersion: 1,
            scope: "Offline storage write amplification. replace/batch use a fake index; delta uses real KnowPro with deterministic extraction and no embeddings, comparing the same candidate with replace capability disabled/enabled. Counts JSON payloads, not physical device I/O. Segment observations reconstruct prior whole-JSON serialization on identical values. No live latency/RSS certification.",
            commit: execFileSync("git", ["rev-parse", "HEAD"], {
                cwd: productRoot,
                encoding: "utf8",
            }).trim(),
            dirty:
                execFileSync("git", ["status", "--porcelain"], {
                    cwd: productRoot,
                    encoding: "utf8",
                }).trim().length > 0,
            checkpoint,
            node: process.version,
            machine: {
                platform: process.platform,
                architecture: process.arch,
                cpu: os.cpus()[0]?.model,
            },
            configuration: {
                samples,
                workload: kind,
                provider: "offline-stubs",
                seed: "fixed",
            },
            cpuMicros: process.cpuUsage(cpu),
            peakRssBytes: process.resourceUsage().maxRSS * 1024,
            workloads,
        };
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    const { values } = parseArgs({
        options: {
            samples: { type: "string", default: "5" },
            workload: { type: "string", default: "replace" },
            output: { type: "string" },
        },
    });
    const samples = Number(values.samples);
    assert.ok(Number.isSafeInteger(samples) && samples > 0 && samples <= 100);
    assert.ok(["replace", "batch", "delta"].includes(values.workload));
    const result =
        JSON.stringify(
            await runStorageWriteBenchmark(samples, values.workload),
            null,
            2,
        ) + "\n";
    if (values.output)
        await fs.writeFile(path.resolve(values.output), result, { flag: "wx" });
    else process.stdout.write(result);
}
