// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
    replayDerivativeIndex,
    replayWikiAssessment,
} from "../../packages/memory/service/dist/latencyQualificationFixture.js";
import {
    simulateExtraction,
    syntheticExtractionParts,
} from "./extraction-scheduling.mjs";
import { runContinuousTopicReplay } from "./topic-work-benchmark.mjs";
import {
    compiledFileHashes,
    hashValue,
    hashWorkingTreePatch,
    positiveInteger,
} from "./replay-artifacts.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

async function identity() {
    const files = [
        "tools/memory-maintenance-qualification/consolidated-latency-benchmark.mjs",
        "tools/memory-maintenance-qualification/extraction-scheduling.mjs",
        "tools/memory-maintenance-qualification/topic-work-benchmark.mjs",
        "tools/memory-maintenance-qualification/replay-artifacts.mjs",
    ];
    for (const directory of [
        "memory/service",
        "memory/conversation",
        "knowPro",
        "knowledgeProcessor",
    ]) {
        const base = path.join("packages", directory, "dist");
        for (const file of await readdir(path.join(root, base), {
            recursive: true,
        }))
            if (file.endsWith(".js")) files.push(path.join(base, file));
    }
    return {
        commit: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
        }).trim(),
        dirtyPatchHash: await hashWorkingTreePatch(root),
        files: await compiledFileHashes(root, files.sort()),
        node: process.version,
    };
}

export async function runConsolidatedLatencyBenchmark(samples = 10) {
    assert.ok(
        Number.isSafeInteger(samples) && samples >= 10 && samples <= 100,
        "Samples must be 10-100",
    );
    const pinned = await identity();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("Offline qualification attempted network access");
    };
    const startedAt = new Date().toISOString();
    try {
        const extraction = [];
        for (const count of [24, 536]) {
            const pairs = [];
            for (let sample = 0; sample < samples; sample++) {
                const parts = syntheticExtractionParts(count).map(
                    (part, ordinal) => ({
                        ...part,
                        durationMs:
                            part.durationMs +
                            ((sample * 17 + ordinal * 13) % 7),
                    }),
                );
                const order = sample % 2 ? [true, false] : [false, true];
                const arms = new Map(
                    order.map((lookahead) => [
                        lookahead,
                        simulateExtraction(parts, lookahead),
                    ]),
                );
                const baseline = arms.get(false),
                    candidate = arms.get(true);
                assert.equal(candidate.outputDigest, baseline.outputDigest);
                assert.equal(candidate.attempts, baseline.attempts);
                assert.ok(candidate.peak <= 8);
                pairs.push({
                    sample,
                    order,
                    fixtureHash: hashValue(parts),
                    baseline,
                    candidate,
                });
            }
            extraction.push({ count, pairs });
        }
        const wiki = [];
        for (const churn of [false, true]) {
            const pairs = [];
            for (let sample = 0; sample < samples; sample++) {
                const order = sample % 2 ? [2, 1] : [1, 2];
                const arms = new Map();
                for (const concurrency of order)
                    arms.set(
                        concurrency,
                        await replayWikiAssessment(concurrency, churn),
                    );
                const baseline = arms.get(1),
                    candidate = arms.get(2);
                assert.deepEqual(candidate.receipts, baseline.receipts);
                assert.deepEqual(candidate.states, baseline.states);
                assert.equal(candidate.publication, false);
                pairs.push({ sample, order, baseline, candidate });
            }
            wiki.push({ churn, pairs });
        }
        const derivative = [];
        for (let sample = 0; sample < samples; sample++) {
            const order = sample % 2 ? [true, false] : [false, true];
            const arms = new Map();
            for (const structural of order)
                arms.set(structural, await replayDerivativeIndex(structural));
            const baseline = arms.get(false),
                candidate = arms.get(true);
            derivative.push({
                sample,
                order,
                baseline,
                candidate,
                parity: {
                    lexical: candidate.lexicalDigest === baseline.lexicalDigest,
                    alias: candidate.aliasDigest === baseline.aliasDigest,
                    semantic:
                        candidate.semanticDigest === baseline.semanticDigest,
                    coldReopen: candidate.reopenExact && baseline.reopenExact,
                },
            });
        }
        const topics = await runContinuousTopicReplay(samples);
        assert.deepEqual(
            await identity(),
            pinned,
            "Implementation changed during measurement",
        );
        return {
            schemaVersion: 1,
            startedAt,
            finishedAt: new Date().toISOString(),
            samples,
            scope: "Offline authored fixtures only. Extraction is a virtual-clock model, not production scheduling. Wiki uses the real runner with 4 ms authored assessments. Derivative uses native indexes with frozen authored extraction and embeddings disabled. Topic replay uses production capture/curation with authored deferred decisions. No live quality, throughput, ready-publication or end-to-end latency claim.",
            identity: pinned,
            extraction,
            wiki,
            derivative,
            topics,
            decisions: {
                extraction: "MECHANISM_ONLY_NOT_PROMOTED",
                wiki: "CONDITIONAL_ON_STABLE_WITNESSES",
                derivative: derivative.every(({ parity }) =>
                    Object.values(parity).every(Boolean),
                )
                    ? "FIXTURE_PARITY_ONLY"
                    : "REJECTED_PARITY",
                live: "NOT_RUN_NEW_AUTHORIZATION_REQUIRED",
            },
        };
    } finally {
        globalThis.fetch = originalFetch;
    }
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    const { values } = parseArgs({
        options: {
            samples: { type: "string", default: "10" },
            output: { type: "string" },
        },
    });
    assert.ok(values.output, "--output must name a new private JSON file");
    const result = await runConsolidatedLatencyBenchmark(
        positiveInteger(values.samples, 10, "samples"),
    );
    await writeFile(
        path.resolve(values.output),
        JSON.stringify(result, null, 2) + "\n",
        { flag: "wx" },
    );
}
