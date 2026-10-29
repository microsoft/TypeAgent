// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { parseArgs } from "node:util";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const { values } = parseArgs({
    options: {
        store: { type: "string" },
        out: { type: "string" },
        corpus: { type: "string" },
        json: { type: "string" },
        "git-blob": { type: "string" },
        rounds: { type: "string", default: "2" },
    },
});
assert(
    values.store &&
        values.out &&
        values.corpus &&
        !!values.json !== !!values["git-blob"],
    "Required: --store, --out, --corpus and exactly one of --json or --git-blob",
);
const source = resolve(values.store);
const output = resolve(values.out);
const nested = relative(source, output);
assert(
    nested && (nested.startsWith(`..${sep}`) || isAbsolute(nested)),
    "Output must not be inside the source store",
);
const rounds = Number(values.rounds);
assert(
    Number.isInteger(rounds) && rounds >= 1 && rounds <= 3,
    "Rounds must be 1..3",
);
await mkdir(output);
const { loadConfigSync } = await import("../../packages/config/dist/index.js");
const { initRuntimeConfigFromProcessEnv } = await import(
    "../../packages/aiclient/dist/index.js"
);
const { FileMemoryService } = await import(
    "../../packages/memory/service/dist/fileMemoryService.js"
);
loadConfigSync();
initRuntimeConfigFromProcessEnv();
const fetch = globalThis.fetch;
globalThis.fetch = async () => {
    throw new Error(
        "Network/model calls are forbidden in local serving experiments",
    );
};
const initialization: unknown[] = [];
try {
    for (let round = 0; round < rounds; round++) {
        for (const lazy of round % 2 ? [true, false] : [false, true]) {
            const directory = resolve(
                output,
                `${round}-${lazy ? "lazy" : "eager"}`,
            );
            await cp(source, directory, {
                recursive: true,
                errorOnExist: true,
                force: false,
            });
            const service = new FileMemoryService(directory, {
                performanceExperiments: lazy ? "lazy-collections" : "",
                maintenanceMode: "manual",
                sourceSynopses: false,
                discoveryPolicy: "off",
            });
            try {
                const cpu = process.cpuUsage();
                const started = performance.now();
                await service.initialize();
                const initialized = performance.now();
                const collections = await service.listCorpora();
                const listed = performance.now();
                const corpus = await service.getCorpus(values.corpus);
                assert(corpus, "Selected collection must exist");
                const opened = performance.now();
                const usage = process.cpuUsage(cpu);
                initialization.push({
                    round,
                    lazy,
                    collections: collections.length,
                    initializeMs: initialized - started,
                    listingMs: listed - initialized,
                    firstOpenMs: opened - listed,
                    totalMs: opened - started,
                    cpuMs: (usage.user + usage.system) / 1000,
                });
            } finally {
                await service.close();
            }
        }
    }
    const fixturePath = values.json ?? values["git-blob"];
    assert(fixturePath);
    const fixture = await readFile(fixturePath);
    const decoded = values["git-blob"]
        ? inflateSync(fixture, { maxOutputLength: 128 * 1024 * 1024 })
        : fixture;
    let text: string;
    if (values["git-blob"]) {
        const zero = decoded.indexOf(0);
        const header = decoded.subarray(0, zero).toString("ascii");
        assert(/^blob \d+$/.test(header), "Fixture must be a Git blob");
        assert(
            Number(header.slice(5)) === decoded.length - zero - 1,
            "Invalid blob length",
        );
        text = decoded.subarray(zero + 1).toString("utf8");
    } else text = decoded.toString("utf8");
    const workerStart = performance.now();
    const worker = new Worker(
        `
        const {parentPort} = require("node:worker_threads");
        parentPort.on("message", text => {
            try { parentPort.postMessage({success:true, data:JSON.parse(text)}); }
            catch(error) { parentPort.postMessage({success:false, message:error.message}); }
        });
    `,
        { eval: true },
    );
    let workerStartupMs: number;
    const parsing: unknown[] = [];
    try {
        await once(worker, "online", {
            signal: AbortSignal.timeout(30_000),
        });
        workerStartupMs = performance.now() - workerStart;
        for (let round = 0; round < rounds; round++) {
            for (const mode of round % 2
                ? (["worker", "inline"] as const)
                : (["inline", "worker"] as const)) {
                const histogram = monitorEventLoopDelay({ resolution: 5 });
                histogram.enable();
                const elapsedMs: number[] = [];
                try {
                    await delay(20);
                    histogram.reset();
                    for (let index = 0; index < 5; index++) {
                        const started = performance.now();
                        let parsed: unknown;
                        if (mode === "inline") parsed = JSON.parse(text);
                        else {
                            const received = once(worker, "message", {
                                signal: AbortSignal.timeout(60_000),
                            });
                            worker.postMessage(text);
                            const [message] = await received;
                            assert(message.success, message.message);
                            parsed = message.data;
                        }
                        assert(
                            parsed !== undefined,
                            "JSON parse returned no value",
                        );
                        elapsedMs.push(performance.now() - started);
                        await delay(10);
                    }
                } finally {
                    histogram.disable();
                }
                parsing.push({
                    round,
                    mode,
                    elapsedMs,
                    eventLoopDelayMaxMs: histogram.max / 1e6,
                    eventLoopDelayP95Ms: histogram.percentile(95) / 1e6,
                });
            }
        }
    } finally {
        await worker.terminate();
    }
    await writeFile(
        resolve(output, "results.json"),
        JSON.stringify(
            {
                schemaVersion: 1,
                measuredAt: new Date().toISOString(),
                gitRevision: execFileSync("git", ["rev-parse", "HEAD"], {
                    encoding: "utf8",
                }).trim(),
                nodeVersion: process.version,
                fixtureKind: values["git-blob"] ? "inflated-git-blob" : "json",
                fixtureSha256: createHash("sha256").update(text).digest("hex"),
                networkCallsAllowed: false,
                originalStoreUntouched: true,
                startupWarming: false,
                maintenanceMode: "manual",
                initialization,
                jsonBytes: Buffer.byteLength(text, "utf8"),
                workerStartupMs,
                parsing,
                limitation:
                    "JSON parsing plus full result structured cloning only; this does not isolate index hydration or prove production-worker benefit.",
            },
            null,
            2,
        ) + "\n",
    );
    console.log(
        JSON.stringify({ initialization, parsing, workerStartupMs }, null, 2),
    );
} finally {
    globalThis.fetch = fetch;
}
