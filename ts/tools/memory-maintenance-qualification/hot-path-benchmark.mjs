// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import { FileMemoryService } from "../../packages/memory/service/dist/fileMemoryService.js";
import { TypedViewStore } from "../../packages/memory/service/dist/viewStore.js";
import { ViewHistory } from "../../packages/memory/service/dist/viewHistory.js";
import { waitForMemoryJob } from "../../packages/memory/service/dist/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "../../packages/memory/service/dist/test/fakeSemanticCorpusIndex.js";
import { compileRecipeProgram } from "../../packages/copilot-macros/dist/recipeCompiler.js";
import { executeRecipeProgram } from "../../packages/copilot-macros/dist/recipeExecutor.js";
import {
    recipeDigest,
    recipeSchemaDigest,
} from "../../packages/copilot-macros/dist/recipeCore.js";
import { recipeArtifact } from "../../packages/copilot-macros/dist/test/recipeCatalogFixtures.js";

const productRoot = fileURLToPath(new URL("../../", import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
    let resolve;
    const promise = new Promise((finish) => {
        resolve = finish;
    });
    return { promise, resolve };
}

function summary(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const percentile = (p) => sorted[Math.ceil(p * sorted.length) - 1];
    return { samples, p50: percentile(0.5), p95: percentile(0.95) };
}

async function topicRead(root, bytes) {
    const state = { views: {}, benchmarkPayload: "x".repeat(bytes) };
    const history = new ViewHistory(path.join(root, "corpus", "views"), () => ({
        views: {},
    }));
    await history.commit(
        null,
        state,
        {},
        "benchmark",
        "Synthetic Topic read workload",
    );
    const store = new TypedViewStore(root);
    let fullStateSerializations = 0;
    const stringify = JSON.stringify;
    JSON.stringify = function (value, ...args) {
        if (value?.benchmarkPayload) fullStateSerializations++;
        return stringify(value, ...args);
    };
    try {
        const start = performance.now();
        const page = await store.queryTopics({ corpusId: "corpus" });
        assert.equal(page.io.stateBytes, Buffer.byteLength(stringify(state)));
        return {
            elapsedMs: performance.now() - start,
            fullStateSerializations,
        };
    } finally {
        JSON.stringify = stringify;
    }
}

async function macroRun() {
    const capabilities = Array.from({ length: 4 }, (_, i) => ({
        id: `read-${i}`,
        transport: "native",
        providerId: "benchmark",
        operation: `read-${i}`,
        contractVersion: "1",
        inputSchema: { type: "null" },
        outputSchema: { type: "string" },
        schemaDigest: recipeSchemaDigest({ type: "null" }, { type: "string" }),
        compatibility: "exact",
        effect: "read",
    }));
    const source = `async function execute(api, params) {
        let result = "";
        for (let i = 0; i < 4; i++) result += await api.tools.call("read-" + i, null);
        return result;
    }`;
    const artifact = recipeArtifact("benchmark", "capture", {
        source: {
            language: "typescript",
            text: source,
            digest: recipeDigest(source),
        },
        executable: compileRecipeProgram(source),
        capabilities,
        inputSchema: { type: "null" },
    });
    let inspections = 0,
        active = 0,
        maxActive = 0,
        calls = 0;
    const start = performance.now();
    const result = await executeRecipeProgram(artifact, null, {
        runId: "benchmark",
        binding: {
            workspaceId: "benchmark",
            profileId: "benchmark",
            providerId: "benchmark",
            accountId: "benchmark",
            sessionId: "benchmark",
            generation: "1",
        },
        signal: new AbortController().signal,
        host: {
            inspectCapability: async (capability) => {
                inspections++;
                maxActive = Math.max(maxActive, ++active);
                try {
                    await delay(5);
                    return { status: "available", capability };
                } finally {
                    active--;
                }
            },
            invokeCapability: async () => {
                calls++;
                return { status: "completed", value: "x" };
            },
            invokeSemantic: async () => {
                throw new Error("Unexpected semantic call");
            },
        },
    });
    assert.equal(result.status, "completed", result.message);
    assert.equal(result.output, "xxxx");
    assert.equal(calls, 4);
    return {
        elapsedMs: performance.now() - start,
        inspections,
        maxActive,
        calls,
    };
}

async function reindexRead(root) {
    let gate;
    const service = new FileMemoryService(root, {
        viewDrafts: false,
        informationalViews: false,
        sourceSynopses: false,
        indexFactory: (_id, directory) =>
            new (class extends FakeSemanticCorpusIndex {
                async rebuild(documents) {
                    if (gate) {
                        gate.entered.resolve();
                        await gate.release.promise;
                    }
                    return super.rebuild(documents);
                }
            })(directory),
    });
    let reindex, read;
    try {
        const { corpusId } = await service.createCorpus("benchmark");
        const job = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "source",
                sourceType: "text",
                title: "Synthetic",
                text: "Zephyr",
            },
        });
        await waitForMemoryJob(service, job.jobId);
        await service.search({ corpusId, query: "Zephyr" });
        gate = { entered: deferred(), release: deferred() };
        reindex = service.reindexCorpus(corpusId);
        await Promise.race([
            gate.entered.promise,
            reindex.then(() => {
                throw new Error("Reindex skipped rebuild");
            }),
        ]);
        let finished = false;
        const start = performance.now();
        read = service.search({ corpusId, query: "Zephyr" }).then((result) => {
            finished = true;
            assert.equal(result.matches.length, 1);
            return performance.now() - start;
        });
        await delay(30);
        const readCompletedDuringPreparation = finished;
        gate.release.resolve();
        const elapsedMs = await read;
        await reindex;
        return { elapsedMs, readCompletedDuringPreparation };
    } finally {
        gate?.release.resolve();
        await Promise.allSettled([reindex, read].filter(Boolean));
        await service.close();
    }
}

async function run(options) {
    const root = await mkdtemp(path.join(os.tmpdir(), "typeagent-hot-path-"));
    try {
        const workloads = {};
        const cpu = process.cpuUsage();
        const start = performance.now();
        for (const [name, operation] of [
            ["topic-32k", (directory) => topicRead(directory, 32 * 1024)],
            ["topic-256k", (directory) => topicRead(directory, 256 * 1024)],
            ["macro-4-capabilities", () => macroRun()],
            ["reindex-concurrent-read", (directory) => reindexRead(directory)],
        ]) {
            const samples = [];
            for (let i = 0; i < options.samples + options.warmups; i++) {
                const sample = await operation(path.join(root, `${name}-${i}`));
                if (i >= options.warmups) samples.push(sample);
            }
            workloads[name] = {
                elapsedMs: summary(samples.map((s) => s.elapsedMs)),
                observations: samples,
            };
        }
        const files = [
            "packages/memory/service/dist/fileMemoryService.js",
            "packages/memory/service/dist/viewStore.js",
            "packages/memory/service/dist/viewHistory.js",
            "packages/copilot-macros/dist/recipeExecutor.js",
            "packages/memory/service/dist/test/fakeSemanticCorpusIndex.js",
            "packages/copilot-macros/dist/test/recipeCatalogFixtures.js",
        ];
        const checkpoint = Object.fromEntries(
            await Promise.all(
                files.map(async (file) => [
                    file,
                    createHash("sha256")
                        .update(await readFile(path.join(productRoot, file)))
                        .digest("hex"),
                ]),
            ),
        );
        return {
            schemaVersion: 1,
            scope: "Offline synthetic first-milestone hot paths; not full scale or model quality qualification",
            commit: execFileSync("git", ["rev-parse", "HEAD"], {
                cwd: productRoot,
                encoding: "utf8",
            }).trim(),
            dirty:
                execFileSync("git", ["status", "--porcelain"], {
                    cwd: productRoot,
                    encoding: "utf8",
                }).trim().length > 0,
            node: process.version,
            pnpm: execFileSync(
                process.execPath,
                ["-p", "require('./package.json').packageManager"],
                { cwd: productRoot, encoding: "utf8" },
            ).trim(),
            machine: {
                platform: process.platform,
                architecture: process.arch,
                cpu: os.cpus()[0]?.model,
            },
            configuration: {
                ...options,
                provider: "offline-stubs",
                seed: "fixed",
                inspectionDelayMs: 5,
                preparationHoldMs: 30,
            },
            checkpoint,
            elapsedMs: performance.now() - start,
            cpuMicros: process.cpuUsage(cpu),
            peakRssBytes: process.resourceUsage().maxRSS * 1024,
            workloads,
        };
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

const { values } = parseArgs({
    options: {
        samples: { type: "string", default: "5" },
        warmups: { type: "string", default: "1" },
        output: { type: "string" },
    },
});
const samples = Number(values.samples),
    warmups = Number(values.warmups);
assert.ok(Number.isSafeInteger(samples) && samples > 0 && samples <= 100);
assert.ok(Number.isSafeInteger(warmups) && warmups >= 0 && warmups <= 10);
const result = JSON.stringify(await run({ samples, warmups }), null, 2) + "\n";
if (values.output)
    await writeFile(path.resolve(values.output), result, { flag: "wx" });
else process.stdout.write(result);
