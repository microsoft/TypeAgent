// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadConfigSync } from "../../packages/config/dist/index.js";
import {
    getEmbeddingSize,
    initRuntimeConfigFromProcessEnv,
} from "../../packages/aiclient/dist/index.js";
import {
    configureDurableMemoryExtractionWindow,
    createDurableMemoryIndexSettings,
} from "../../packages/agentServer/server/dist/durableMemoryService.js";
import {
    createKnowProCorpusIndex,
    toDocParts,
} from "../../packages/memory/service/dist/knowProCorpusIndex.js";
import { readConversationDataFromFile } from "../../packages/knowPro/dist/index.js";
import { instrumentSettings } from "./longmemeval-indexing-storage.mjs";
import { decode, digest, encode } from "./longmemeval-indexing-contract.mjs";
import { simulateExtraction } from "./extraction-scheduling.mjs";
import { hashBytes, hashWorkingTreePatch } from "./replay-artifacts.mjs";

const product = fileURLToPath(new URL("../../", import.meta.url));

function responseTape(entries) {
    const records = new Map(),
        occurrences = new Map();
    for (const entry of entries) {
        const key = `${entry.key}:${entry.occurrence ?? 0}`;
        assert.ok(!records.has(key), "Duplicate captured request occurrence");
        records.set(key, entry.value);
    }
    return {
        async invoke(method, identity, args) {
            const key = digest(encode({ method, identity, args }));
            const occurrence = (occurrences.get(key) ?? 0) + 1;
            occurrences.set(key, occurrence);
            const request = records.has(`${key}:0`)
                ? `${key}:0`
                : `${key}:${occurrence}`;
            assert.ok(
                records.has(request),
                "Uncaptured native request occurrence",
            );
            return { value: decode(encode(records.get(request))), occurrence };
        },
    };
}

export async function replayNativeExtraction(documents, captured, directory) {
    assert.ok(documents.length >= 1);
    const durations = new Map(captured.durations);
    const parts = documents.flatMap(toDocParts);
    const arms = [];
    for (const batchSize of [8, 16]) {
        const output = path.join(directory, `batch-${batchSize}`);
        await mkdir(output);
        const calls = [];
        let active = 0,
            peak = 0;
        const responses = responseTape(captured.entries);
        const factory = () => {
            const settings = createDurableMemoryIndexSettings(64, 64);
            const cs = settings.conversationSettings;
            instrumentSettings(
                cs,
                {
                    async invoke(method, identity, args) {
                        const work = async () => {
                            const key = digest(
                                encode({ method, identity, args }),
                            );
                            if (method.startsWith("knowledge.")) {
                                active++;
                                peak = Math.max(peak, active);
                            }
                            try {
                                const { value, occurrence } =
                                    await responses.invoke(
                                        method,
                                        identity,
                                        args,
                                    );
                                if (method.startsWith("knowledge.")) {
                                    const durationMs =
                                        durations.get(`${key}:${occurrence}`) ??
                                        durations.get(key);
                                    assert.ok(
                                        Number.isFinite(durationMs) &&
                                            durationMs > 0,
                                        "Missing observed extraction duration",
                                    );
                                    calls.push({
                                        key,
                                        occurrence,
                                        method,
                                        args,
                                        durationMs,
                                    });
                                }
                                return value;
                            } finally {
                                if (method.startsWith("knowledge.")) active--;
                            }
                        };
                        return work();
                    },
                },
                { commit: false },
            );
            configureDurableMemoryExtractionWindow(
                cs.semanticRefIndexSettings,
                batchSize,
            );
            return settings;
        };
        const index = createKnowProCorpusIndex("probe", output, factory);
        const started = performance.now();
        for (let offset = 0; offset < documents.length; offset += 2)
            await index.append(
                documents.slice(offset, offset + 2),
                AbortSignal.timeout(120_000),
                async () => {},
            );
        const embeddingSize = getEmbeddingSize();
        assert.ok(Number.isSafeInteger(embeddingSize) && embeddingSize > 0);
        const data = await readConversationDataFromFile(
            output,
            "corpus",
            embeddingSize,
        );
        assert.ok(data, "Native persisted data missing");
        assert.ok(Number.isFinite(Date.parse(data.indexingState.lastIndexed)));
        const { lastIndexed: _lastIndexed, ...indexingState } =
            data.indexingState;
        data.indexingState = indexingState;
        const graph = await index.getKnowledgeGraph();
        const reopened = createKnowProCorpusIndex("probe", output, factory);
        await reopened.initialize();
        assert.equal(
            digest(encode(await reopened.getKnowledgeGraph())),
            digest(encode(graph)),
        );
        assert.equal(active, 0);
        assert.ok(peak <= 8);
        arms.push({
            batchSize,
            peak,
            replayWallMs: performance.now() - started,
            graphHash: digest(encode(graph)),
            persistedHash: digest(encode(data)),
            calls,
        });
    }
    const [baseline, candidate] = arms;
    const requests = (arm) => arm.calls.map(({ key }) => key).sort();
    assert.deepEqual(
        requests(candidate),
        requests(baseline),
        "Temporal extraction request bindings changed",
    );
    assert.equal(
        candidate.graphHash,
        baseline.graphHash,
        "Native graph parity failed",
    );
    assert.equal(
        candidate.persistedHash,
        baseline.persistedHash,
        "Native index/vector parity failed",
    );
    const unused = [...baseline.calls];
    const shape = parts.map((part, ordinal) => {
        const temporal = part.metadata?.temporalContext;
        const position = unused.findIndex(({ args }) => {
            if (args[0] !== part.textChunks[0]) return false;
            const wire = args[2]?.[0]?.content;
            if (!wire) return !temporal;
            const context = JSON.parse(
                wire.slice(wire.indexOf("\n") + 1),
            ).temporalContext;
            return (
                context.sourceRevisionId === temporal?.sourceRevisionId &&
                context.ownerId === temporal?.ownerId &&
                context.partOrdinal === temporal?.partOrdinal
            );
        });
        assert.ok(
            position >= 0,
            "Real extraction call cannot be bound to a source part",
        );
        const [call] = unused.splice(position, 1);
        const source = documents.findIndex(
            (document) =>
                document.revision.revisionId === temporal?.sourceRevisionId,
        );
        assert.ok(source >= 0, "Part lost its source revision");
        return {
            id: `part-${ordinal}`,
            group: `real-group-${Math.floor(source / 2)}`,
            revision: temporal?.sourceRevisionId ?? `unscoped-${ordinal}`,
            owner: temporal?.ownerId ?? `unscoped-${ordinal}`,
            durationMs: call.durationMs,
            requestKey: call.key,
        };
    });
    assert.equal(unused.length, 0, "Unbound extraction responses");
    return {
        scope: "Real frozen ingestion group and recorded provider outputs. Exact native request, graph, index/vector and cold-reopen parity. Virtual-clock timings use observed durations, not new provider latency.",
        sourceCount: documents.length,
        parts: shape,
        parity: {
            temporalRequests: true,
            graph: true,
            persistedIndexesAndVectors: true,
            coldReopen: true,
        },
        excludedHostMetadata: ["indexingState.lastIndexed"],
        baseline: simulateExtraction(shape, false),
        candidate: simulateExtraction(shape, true, 8, "fixed"),
        nativeCandidate:
            "Fixed 16-location windows, at most eight active extraction calls; not a sliding-window scheduler",
        nativeArms: arms.map(({ calls, ...arm }) => ({
            ...arm,
            extractionCalls: calls.length,
        })),
        productionSchedulerChanged: false,
        schedulerImplementation:
            "Actual durable-memory host configuration applied around the recorded provider boundary; default remains eight.",
    };
}

async function main() {
    const { values } = parseArgs({
        options: {
            documents: { type: "string" },
            tape: { type: "string" },
            output: { type: "string" },
        },
    });
    assert.ok(values.documents && values.tape && values.output);
    const documentBytes = await readFile(values.documents);
    const tapeBytes = await readFile(values.tape);
    loadConfigSync();
    initRuntimeConfigFromProcessEnv();
    await mkdir(values.output);
    const patch = await hashWorkingTreePatch(product);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("Offline replay attempted network access");
    };
    try {
        const result = await replayNativeExtraction(
            JSON.parse(documentBytes),
            decode(tapeBytes.toString("utf8")),
            values.output,
        );
        assert.equal(
            await hashWorkingTreePatch(product),
            patch,
            "Source changed during replay",
        );
        await writeFile(
            path.join(values.output, "results.json"),
            encode({
                ...result,
                provenance: {
                    patch,
                    documents: hashBytes(documentBytes),
                    tape: hashBytes(tapeBytes),
                },
            }),
            { flag: "wx" },
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
}

if (
    process.argv[1] &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
    await main();
