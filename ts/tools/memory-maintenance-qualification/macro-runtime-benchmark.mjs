// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import * as runtime from "../../packages/copilot-macros/dist/recipeExecutor.js";
import { compileRecipeProgram } from "../../packages/copilot-macros/dist/recipeCompiler.js";
import {
    recipeDigest,
    recipeSchemaDigest,
} from "../../packages/copilot-macros/dist/recipeCore.js";
import { recipeArtifact } from "../../packages/copilot-macros/dist/test/recipeCatalogFixtures.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const binding = {
    workspaceId: "benchmark",
    profileId: "benchmark",
    providerId: "benchmark",
    accountId: "benchmark",
    sessionId: "benchmark",
    generation: "1",
};
const capability = {
    id: "read",
    transport: "native",
    providerId: "benchmark",
    operation: "read",
    contractVersion: "1",
    inputSchema: { type: "null" },
    outputSchema: { type: "string" },
    schemaDigest: recipeSchemaDigest({ type: "null" }, { type: "string" }),
    compatibility: "exact",
    effect: "read",
};

function artifact(parallel) {
    const source = parallel
        ? `async function execute(api, params) {
            return (await Promise.all(Array.from({length: 8}, () => api.tools.call("read", null)))).join("");
        }`
        : `async function execute(api, params) { return await api.tools.call("read", null); }`;
    return recipeArtifact("runtime-benchmark", "capture", {
        source: {
            language: "typescript",
            text: source,
            digest: recipeDigest(source),
        },
        executable: compileRecipeProgram(source),
        capabilities: [capability],
        inputSchema: { type: "null" },
    });
}

function distribution(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    return {
        samples,
        p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    };
}

async function workload(name, width, parallel, samples) {
    const owner = runtime.RecipeExecutor
        ? new runtime.RecipeExecutor()
        : { execute: runtime.executeRecipeProgram, close: async () => {} };
    const program = artifact(parallel);
    const observations = [];
    let active = 0,
        maxActive = 0;
    try {
        for (let round = 0; round <= samples; round++) {
            maxActive = 0;
            const cpu = process.cpuUsage();
            const start = performance.now();
            const results = await Promise.all(
                Array.from({ length: width }, (_, index) =>
                    owner.execute(
                        program,
                        null,
                        {
                            runId: `${name}-${round}-${index}`,
                            binding,
                            signal: new AbortController().signal,
                            host: {
                                inspectCapability: async (capability) => ({
                                    status: "available",
                                    capability,
                                }),
                                invokeCapability: async () => {
                                    maxActive = Math.max(maxActive, ++active);
                                    try {
                                        await new Promise((resolve) =>
                                            setTimeout(resolve, 10),
                                        );
                                        return {
                                            status: "completed",
                                            value: "x",
                                        };
                                    } finally {
                                        active--;
                                    }
                                },
                                invokeSemantic: async () => {
                                    throw new Error("Unexpected semantic call");
                                },
                            },
                        },
                        { timeoutMs: 30_000 },
                    ),
                ),
            );
            for (const result of results) {
                assert.equal(result.status, "completed", result.message);
                assert.equal(result.output, parallel ? "xxxxxxxx" : "x");
                assert.equal(result.completedCallIds.length, parallel ? 8 : 1);
            }
            observations.push({
                phase: round === 0 ? "cold" : "warm",
                elapsedMs: performance.now() - start,
                maxActiveCalls: maxActive,
                queueMs: results.map(
                    (result) => result.performance?.workerQueueMs ?? null,
                ),
                workerReused: results.map(
                    (result) => result.performance?.workerReused ?? null,
                ),
                rssBytes: process.memoryUsage().rss,
                cpuMicros: process.cpuUsage(cpu),
            });
        }
        return {
            width,
            parallel,
            observations,
            warmElapsedMs: distribution(
                observations.slice(1).map((value) => value.elapsedMs),
            ),
        };
    } finally {
        await owner.close();
    }
}

export async function runMacroRuntimeBenchmark(samples) {
    const workloads = {};
    for (const [name, width, parallel] of [
        ["single", 1, false],
        ["parallel-reads", 1, true],
        ["concurrent-4", 4, false],
        ["concurrent-8", 8, false],
    ])
        workloads[name] = await workload(name, width, parallel, samples);
    const checkpoint = {};
    for (const file of [
        "recipeExecutor.js",
        "recipeExecutorWorker.js",
        "recipeWorkerPool.js",
    ]) {
        try {
            checkpoint[file] = createHash("sha256")
                .update(
                    await readFile(
                        path.join(
                            root,
                            "packages",
                            "copilot-macros",
                            "dist",
                            file,
                        ),
                    ),
                )
                .digest("hex");
        } catch (error) {
            if (file !== "recipeWorkerPool.js" || error.code !== "ENOENT")
                throw error;
            checkpoint[file] = null;
        }
    }
    return {
        schemaVersion: 1,
        scope: "Offline synthetic B4-B5; no live quality or scale qualification",
        mode: runtime.RecipeExecutor
            ? "owned-reusable-workers"
            : "one-worker-per-run",
        commit: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
        }).trim(),
        dirty:
            execFileSync("git", ["status", "--porcelain"], {
                cwd: root,
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
            coldRounds: 1,
            provider: "offline-stubs",
            callDelayMs: 10,
            seed: "fixed",
        },
        peakRssBytes: process.resourceUsage().maxRSS * 1024,
        workloads,
    };
}

async function main() {
    const { values } = parseArgs({
        options: {
            samples: { type: "string", default: "5" },
            output: { type: "string" },
        },
    });
    const samples = Number(values.samples);
    if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100)
        throw new Error("samples must be between 1 and 100");
    const result =
        JSON.stringify(await runMacroRuntimeBenchmark(samples), null, 2) + "\n";
    if (values.output) await writeFile(values.output, result, { flag: "wx" });
    else process.stdout.write(result);
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    await main();
}
