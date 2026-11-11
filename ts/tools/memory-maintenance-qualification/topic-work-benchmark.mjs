// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { captureTopicBuild } from "../../packages/memory/service/dist/topicCapture.js";
import { createConfiguredTopicGenerator } from "../../packages/memory/service/dist/topicGeneration.js";
import { indexedTopicOccurrence } from "../../packages/memory/service/dist/topicIncidence.js";
import { validateTopicSnapshot } from "../../packages/memory/service/dist/topicSnapshot.js";
import { FakeSemanticCorpusIndex } from "../../packages/memory/service/dist/test/fakeSemanticCorpusIndex.js";
import {
    compiledFileHashes,
    curationAccounting,
    hashValue,
    hashWorkingTreePatch,
    positiveInteger,
} from "./replay-artifacts.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const incidence = Array.from({ length: 55 }, (_, ordinal) =>
    indexedTopicOccurrence(
        {
            sourceId: "seed",
            revisionId: "r1",
            blockOrdinal: ordinal,
            text: `Topic ${ordinal}: the pilot remains blocked; no general approval.`,
            score: 1,
        },
        `Topic ${ordinal}`,
        0,
    ),
);

class TopicIndex extends FakeSemanticCorpusIndex {
    constructor(directory, appended = false) {
        super(directory);
        this.appended = appended;
    }
    async getTopicOccurrences() {
        return structuredClone([
            ...incidence,
            ...(this.appended
                ? [
                      indexedTopicOccurrence(
                          {
                              sourceId: "zz-added",
                              revisionId: "r1",
                              blockOrdinal: 0,
                              text: "Additional evidence: the pilot remains blocked.",
                              score: 1,
                          },
                          "Additional topic",
                          0,
                      ),
                  ]
                : []),
        ]);
    }
}

class ContinuousTopicIndex extends TopicIndex {
    constructor(count) {
        super("unused");
        this.count = count;
    }
    async getTopicOccurrences() {
        return [
            ...(await super.getTopicOccurrences()),
            ...Array.from({ length: this.count }, (_, ordinal) =>
                indexedTopicOccurrence(
                    {
                        sourceId: `zz-added-${String(ordinal).padStart(3, "0")}`,
                        revisionId: "r1",
                        blockOrdinal: 0,
                        text: `Evidence ${ordinal}: the review remains open.`,
                        score: 1,
                    },
                    `Additional topic ${ordinal}`,
                    0,
                ),
            ),
        ];
    }
}

async function continuousArm(reuse) {
    let attempts = 0,
        processedNodes = 0;
    const visited = new Set();
    const generate = createConfiguredTopicGenerator({
        model: {
            completionSettings: {},
            complete: async (messages) => {
                assert.ok(Array.isArray(messages));
                const payload = JSON.parse(String(messages[1].content));
                attempts++;
                processedNodes += payload.nodes.length;
                for (const { id } of payload.nodes) visited.add(id);
                return {
                    success: true,
                    data: JSON.stringify({
                        concepts: [],
                        deferred: payload.nodes.map(({ id }) => ({
                            nodeId: id,
                            reason: "Incidental mention",
                        })),
                    }),
                };
            },
        },
        mode: { kind: "generative" },
    });
    let current;
    const waves = [];
    for (let wave = 0; wave <= 8; wave++) {
        if (wave === 1) {
            attempts = processedNodes = 0;
            visited.clear();
        }
        const start = performance.now();
        const input = await captureTopicBuild({
            corpusId: "offline",
            actor: "offline",
            model: "offline",
            index: new ContinuousTopicIndex(wave),
            indexGeneration: `wave-${wave}`,
            sources: [
                { sourceId: "seed", revisionId: "r1" },
                ...Array.from({ length: wave }, (_, ordinal) => ({
                    sourceId: `zz-added-${String(ordinal).padStart(3, "0")}`,
                    revisionId: "r1",
                })),
            ],
            suppressions: [],
            current,
            topicCurationReuse: reuse,
            topicWatermark: reuse,
        });
        current = await generate(input, new AbortController().signal);
        validateTopicSnapshot(current);
        const accounting = curationAccounting(
            current.curation,
            current.nodes.map(({ id }) => id),
        );
        assert.equal(accounting.assignmentsResolved, true);
        assert.equal(accounting.deferred, 55 + wave);
        if (wave > 0)
            waves.push({
                wave,
                wallMs: performance.now() - start,
                outputDigest: hashValue({
                    nodes: current.nodes,
                    curation: current.curation,
                }),
                attempts,
                processedNodes,
            });
    }
    return {
        attempts,
        processedNodes,
        uniqueProcessedNodes: visited.size,
        repeatedNodes: processedNodes - visited.size,
        waves,
    };
}

export async function runContinuousTopicReplay(samples = 10) {
    assert.ok(Number.isSafeInteger(samples) && samples >= 1 && samples <= 100);
    const pairs = [];
    for (let sample = 0; sample < samples; sample++) {
        const order = sample % 2 ? [true, false] : [false, true];
        const arms = new Map();
        for (const reuse of order) arms.set(reuse, await continuousArm(reuse));
        const baseline = arms.get(false),
            candidate = arms.get(true);
        assert.deepEqual(
            candidate.waves.map(({ outputDigest }) => outputDigest),
            baseline.waves.map(({ outputDigest }) => outputDigest),
        );
        pairs.push({ sample, order, baseline, candidate });
    }
    return {
        scope: "Eight quiescent append/capture/generation waves using production capture and curation with authored deferred decisions; not simultaneous ingestion/publication or provider quality.",
        fixtureHash: hashValue(incidence),
        pairs,
    };
}

async function identity() {
    const files = [
        "tools/memory-maintenance-qualification/topic-work-benchmark.mjs",
        "tools/memory-maintenance-qualification/replay-artifacts.mjs",
        "packages/memory/service/dist/test/fakeSemanticCorpusIndex.js",
        "packages/memory/service/dist/test/fakeSemanticIndex.js",
    ];
    for (const packageDirectory of ["memory/service", "knowPro"])
        for (const file of await readdir(
            path.join(root, "packages", packageDirectory, "dist"),
        ))
            if (file.endsWith(".js"))
                files.push(`packages/${packageDirectory}/dist/${file}`);
    return {
        commit: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
        }).trim(),
        dirtyPatchHash: await hashWorkingTreePatch(root),
        files: await compiledFileHashes(root, files.sort()),
    };
}

async function arm(change, reuse) {
    let calls = 0,
        completed = 0;
    const generate = createConfiguredTopicGenerator({
        model: {
            completionSettings: {},
            complete: async (messages) => {
                calls++;
                assert.ok(Array.isArray(messages));
                const payload = JSON.parse(String(messages[1].content));
                completed++;
                return {
                    success: true,
                    data: JSON.stringify({
                        concepts: [],
                        deferred: payload.nodes.map(({ id }) => ({
                            nodeId: id,
                            reason: "Incidental mention",
                        })),
                    }),
                };
            },
        },
        mode: { kind: "generative" },
    });
    const options = {
        corpusId: "offline",
        actor: "offline",
        index: new TopicIndex("unused"),
        sources: [{ sourceId: "seed", revisionId: "r1" }],
        suppressions: [],
        model: "offline",
        topicCurationReuse: change === "append" || reuse,
        topicWatermark: change === "append" && reuse,
    };
    const captured = await captureTopicBuild({
        ...options,
        indexGeneration: "generation-1",
    });
    const current = await generate(captured, new AbortController().signal);
    assert.equal(calls, 3);
    calls = completed = 0;
    const start = performance.now();
    const input = await captureTopicBuild({
        ...options,
        indexGeneration: "generation-2",
        current,
        index: new TopicIndex("unused", change === "append"),
        sources:
            change === "unrelated" || change === "append"
                ? [
                      ...options.sources,
                      {
                          sourceId:
                              change === "append" ? "zz-added" : "unrelated",
                          revisionId: "r1",
                      },
                  ]
                : options.sources,
    });
    const captureMs = performance.now() - start;
    const generated = await generate(input, new AbortController().signal);
    const captureAndCurationMs = performance.now() - start;
    validateTopicSnapshot(generated);
    assert.notEqual(input.fingerprint, current.inputFingerprint);
    assert.equal(calls, change === "append" ? (reuse ? 1 : 3) : reuse ? 0 : 3);
    assert.equal(completed, calls);
    if (change !== "append") {
        assert.deepEqual(generated.nodes, current.nodes);
        assert.deepEqual(generated.curation, current.curation);
    }
    const accounting = curationAccounting(
        generated.curation,
        generated.nodes.map(({ id }) => id),
    );
    assert.equal(accounting.assignmentsResolved, true);
    assert.equal(accounting.deferred, change === "append" ? 56 : 55);
    const replayed =
        current.curationPackets?.filter(
            (packet, index) =>
                packet.fingerprint ===
                generated.curationPackets?.[index]?.fingerprint,
        ) ?? [];
    if (change === "append") assert.equal(replayed.length, reuse ? 2 : 0);
    return {
        reuse,
        captureMs,
        captureAndCurationMs,
        providerAttempts: calls,
        providerCompletions: completed,
        reusedDecisions:
            input.topicInput.reusableCuration?.deferred.length ?? 0,
        replayedPackets: replayed.length,
        replayedRawNodes: replayed.reduce(
            (count, packet) => count + packet.end - packet.start,
            0,
        ),
        outputDigest: hashValue({
            nodes: generated.nodes,
            curation: generated.curation,
        }),
        accounting,
    };
}

export async function runTopicWorkBenchmark(samples = 20, watermark = false) {
    assert.ok(
        Number.isSafeInteger(samples) && samples > 0 && samples <= 100,
        "Samples must be 1-100",
    );
    assert.equal(typeof watermark, "boolean", "Watermark must be boolean");
    const before = await identity();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("Offline topic benchmark attempted network access");
    };
    try {
        const workloads = [];
        for (const change of watermark
            ? ["append"]
            : ["generation-only", "unrelated"]) {
            const pairs = [];
            for (let sample = 0; sample < samples; sample++) {
                const order = sample % 2 ? [true, false] : [false, true];
                const observations = [];
                for (const reuse of order)
                    observations.push(await arm(change, reuse));
                const baseline = observations.find((value) => !value.reuse);
                const candidate = observations.find((value) => value.reuse);
                assert.equal(baseline.outputDigest, candidate.outputDigest);
                pairs.push({ sample, order, baseline, candidate });
            }
            workloads.push({ change, pairs });
        }
        assert.deepEqual(
            await identity(),
            before,
            "Implementation changed during measurement",
        );
        return {
            schemaVersion: 1,
            scope: "Offline production capture+generative-curation host work with synthetic deferred decisions. No ingestion, publication, maintenance drain, semantic quality, network/provider latency or foreground qualification.",
            identity: before,
            configuration: {
                samples,
                topicNodes: 55,
                provider: "offline-stub",
                traceEnabled: process.env.TYPEAGENT_MEMORY_SEARCH_TRACE === "1",
                fixtureHash: hashValue(incidence),
                watermark,
            },
            node: process.version,
            machine: {
                platform: process.platform,
                architecture: process.arch,
                cpu: os.cpus()[0]?.model,
            },
            workloads,
        };
    } finally {
        globalThis.fetch = previousFetch;
    }
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    const { values } = parseArgs({
        options: {
            samples: { type: "string", default: "20" },
            output: { type: "string" },
            watermark: { type: "boolean", default: false },
        },
    });
    assert.ok(values.output, "--output must name a new private JSON file");
    const samples = positiveInteger(values.samples, 20, "samples");
    const result = await runTopicWorkBenchmark(samples, values.watermark);
    await writeFile(
        path.resolve(values.output),
        JSON.stringify(result, null, 2) + "\n",
        { flag: "wx" },
    );
}
