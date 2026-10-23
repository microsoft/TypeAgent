// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const rawWriteFile = fs.writeFile.bind(fs);
const rawMkdir = fs.mkdir.bind(fs);

export class StageProfiler {
    constructor(now = () => performance.now()) {
        this.now = now;
        this.started = now();
        this.last = this.started;
        this.context = new AsyncLocalStorage();
        this.active = new Set();
        this.operations = new Map();
        this.wall = new Map();
        this.http = new Map();
        this.filesystemErrors = new Map();
        this.restores = [];
        this.wrapped = new WeakMap();
        this.cpuStarted = process.cpuUsage();
        this.eluStarted = performance.eventLoopUtilization();
        this.loop = monitorEventLoopDelay({ resolution: 20 });
        this.loop.enable();
    }

    bucket() {
        let priority = -1;
        const categories = new Set();
        const ancestors = new Set();
        for (const span of this.active)
            for (let parent = span.parent; parent; parent = parent.parent)
                ancestors.add(parent);
        for (const span of this.active) {
            if (ancestors.has(span)) continue;
            if (span.priority > priority) {
                priority = span.priority;
                categories.clear();
            }
            if (span.priority === priority) categories.add(span.category);
        }
        return [...categories].sort().join(" + ") || "harness.unclassified";
    }

    tick(now) {
        const bucket = this.bucket();
        this.wall.set(bucket, (this.wall.get(bucket) ?? 0) + now - this.last);
        this.last = now;
    }

    begin(name, category, priority) {
        const now = this.now();
        this.tick(now);
        const parent = this.context.getStore();
        const span = {
            name,
            category,
            priority,
            parent,
            start: now,
            children: 0,
            childMs: 0,
            childStart: now,
            ended: false,
        };
        if (parent && !parent.ended && parent.children++ === 0)
            parent.childStart = now;
        this.active.add(span);
        return span;
    }

    end(span, failed = false) {
        if (span.ended) return;
        const now = this.now();
        this.tick(now);
        span.ended = true;
        this.active.delete(span);
        if (span.children) span.childMs += now - span.childStart;
        if (span.parent && !span.parent.ended && --span.parent.children === 0)
            span.parent.childMs += now - span.parent.childStart;
        const elapsedMs = now - span.start;
        const item = this.operations.get(span.name) ?? {
            name: span.name,
            category: span.category,
            calls: 0,
            failures: 0,
            inclusiveMs: 0,
            selfMs: 0,
            maxMs: 0,
        };
        item.calls++;
        item.failures += Number(failed);
        item.inclusiveMs += elapsedMs;
        item.selfMs += Math.max(0, elapsedMs - span.childMs);
        item.maxMs = Math.max(item.maxMs, elapsedMs);
        this.operations.set(span.name, item);
    }

    measure(name, category, priority, operation) {
        if (this.closed) return operation();
        const span = this.begin(name, category, priority);
        try {
            const value = this.context.run(span, operation);
            if (value && typeof value.then === "function")
                return value.then(
                    (result) => {
                        this.end(span);
                        return result;
                    },
                    (error) => {
                        this.end(span, true);
                        throw error;
                    },
                );
            this.end(span);
            return value;
        } catch (error) {
            this.end(span, true);
            throw error;
        }
    }

    wrap(object, method, name, category, priority, factory, restore = true) {
        assert.equal(
            typeof object[method],
            "function",
            `Missing profiling hook ${name}`,
        );
        let methods = this.wrapped.get(object);
        if (!methods) this.wrapped.set(object, (methods = new Set()));
        if (methods.has(method)) return;
        methods.add(method);
        const original = object[method];
        const profiler = this;
        object[method] = factory
            ? factory(original)
            : function (...args) {
                  return profiler.measure(name, category, priority, () =>
                      original.apply(this, args),
                  );
              };
        if (restore)
            this.restores.push(() => {
                object[method] = original;
            });
    }

    installFilesystem() {
        const profiler = this;
        for (const method of [
            "readFile",
            "writeFile",
            "mkdir",
            "readdir",
            "stat",
            "lstat",
            "rename",
            "rm",
            "unlink",
            "access",
            "copyFile",
            "cp",
            "realpath",
            "open",
        ]) {
            this.wrap(
                fs,
                method,
                `fs.${method}`,
                "filesystem",
                110,
                (original) =>
                    function (...args) {
                        const purpose = filePurpose(args[0]);
                        return profiler.measure(
                            `fs.${method}:${purpose}`,
                            "filesystem",
                            110,
                            async () => {
                                try {
                                    const value = await original.apply(
                                        this,
                                        args,
                                    );
                                    if (method === "open")
                                        profiler.instrumentHandle(value);
                                    return value;
                                } catch (error) {
                                    const code = /^[A-Z0-9_]{1,30}$/.test(
                                        error?.code,
                                    )
                                        ? error.code
                                        : "unknown";
                                    const key = `${method}:${purpose}:${code}`;
                                    profiler.filesystemErrors.set(
                                        key,
                                        (profiler.filesystemErrors.get(key) ??
                                            0) + 1,
                                    );
                                    throw error;
                                }
                            },
                        );
                    },
            );
        }
        syncBuiltinESMExports();
    }

    instrumentHandle(handle) {
        for (const method of [
            "readFile",
            "writeFile",
            "sync",
            "datasync",
            "close",
            "stat",
            "read",
            "write",
        ])
            this.wrap(
                handle,
                method,
                `fs.handle.${method}`,
                "filesystem",
                110,
                undefined,
                false,
            );
    }

    installFetch() {
        const original = globalThis.fetch;
        const profiler = this;
        globalThis.fetch = function (input, init) {
            const url = new URL(
                typeof input === "string" || input instanceof URL
                    ? input
                    : input.url,
            );
            const kind = url.pathname.endsWith("/embeddings")
                ? "embedding"
                : /\/chat\/completions$|\/responses$/.test(url.pathname)
                  ? "chat"
                  : "metadata";
            return profiler.measure(
                `http.${kind}`,
                `network.${kind}`,
                110,
                async () => {
                    const response = await original(input, init);
                    const key = `${kind}:${response.status}`;
                    const value = profiler.http.get(key) ?? {
                        count: 0,
                        retryAfterSeconds: [],
                    };
                    value.count++;
                    const retry = response.headers.get("retry-after");
                    if (
                        retry !== null &&
                        Number.isFinite(Number(retry)) &&
                        Number(retry) >= 0 &&
                        Number(retry) <= 86400
                    )
                        value.retryAfterSeconds.push(Number(retry));
                    profiler.http.set(key, value);
                    return response;
                },
            );
        };
        this.restores.push(() => {
            globalThis.fetch = original;
        });
    }

    snapshot() {
        const now = this.now();
        this.tick(now);
        const elapsedMs = now - this.started;
        const wallBuckets = [...this.wall]
            .map(([category, elapsedMs]) => ({
                category,
                elapsedMs,
            }))
            .sort((a, b) => b.elapsedMs - a.elapsedMs);
        return {
            schemaVersion: 1,
            elapsedMs,
            accounting:
                "Wall buckets partition the observed window by highest-priority active operations; concurrent categories are explicit. Inclusive/self operation sums are NOT wall shares. Self time excludes the union of direct child spans, not all asynchronous descendants.",
            wallBuckets,
            accountedWallMs: wallBuckets.reduce(
                (n, item) => n + item.elapsedMs,
                0,
            ),
            operations: [...this.operations.values()].sort(
                (a, b) => b.selfMs - a.selfMs,
            ),
            openOperations: [...this.active].map(({ name, start }) => ({
                name,
                elapsedMs: now - start,
            })),
            httpStatuses: Object.fromEntries(this.http),
            filesystemErrors: Object.fromEntries(this.filesystemErrors),
            cpuMicroseconds: process.cpuUsage(this.cpuStarted),
            eventLoopUtilization: performance.eventLoopUtilization(
                this.eluStarted,
            ),
            eventLoopDelayMs: {
                p50: this.loop.percentile(50) / 1e6,
                p95: this.loop.percentile(95) / 1e6,
                max: this.loop.max / 1e6,
            },
            processResources: process.resourceUsage(),
            memory: process.memoryUsage(),
            limitations: [
                "Filesystem spans include asynchronous API waits, not OS/native SQLite I/O or SDK child-process work.",
                "HTTP spans stop at response headers; logical provider spans include response consumption and endpoint discovery.",
                "Instrumentation and progress-file overhead are part of this profiling run; this is not a retrospective decomposition of older runs.",
                "No prompts, file contents, headers, credentials or endpoint URLs are recorded.",
            ],
        };
    }

    close() {
        const result = this.snapshot();
        this.closed = true;
        this.loop.disable();
        for (const restore of this.restores.reverse()) restore();
        syncBuiltinESMExports();
        return result;
    }
}

function filePurpose(file) {
    const filename = file instanceof URL ? fileURLToPath(file) : String(file);
    const name = path.basename(filename);
    if (path.basename(path.dirname(filename)) === ".segments")
        return name.endsWith(".bin") ? "index-binary" : "index-json";
    if (
        /^(model-calls|embedding-calls|receipt|results|progress|profile)\.json/.test(
            name,
        )
    )
        return "harness";
    if (name.startsWith("session.json")) return "session";
    if (name.startsWith("manifest.json")) return "manifest";
    if (name.startsWith("corpus")) return "index";
    if (name.endsWith(".json") || name.includes(".json.")) return "other-json";
    return "other";
}

export async function instrumentRuntime(profiler, runtime, compiled) {
    const [
        { FileMemoryService },
        { AgentSessionStore },
        { RevisionTextStore },
        { DocMemory },
        { KnowProCorpusIndex },
    ] = await Promise.all([
        compiled("packages/memory/service/dist/fileMemoryService.js"),
        compiled("packages/memory/service/dist/agentSessionStore.js"),
        compiled("packages/memory/service/dist/revisionTextStore.js"),
        compiled("packages/memory/conversation/dist/docMemory.js"),
        compiled("packages/memory/service/dist/knowProCorpusIndex.js"),
    ]);
    const hooks = [
        [
            FileMemoryService.prototype,
            "corpus",
            [
                "initialize",
                "close",
                "processIngestion",
                "processIngestionGroup",
                "collectIndexSegments",
                "readManifest",
                "writeManifest",
                "readSerializedManifest",
                "saveJob",
                "updateJob",
                "getJob",
                "loadCorpusRuntime",
                "ensureDocumentIndex",
                "prepareReindex",
                "rebuildAndActivate",
                "withEligibleAgentSessionSources",
                "getAgentSessionImport",
                "importAgentSession",
                "getSourceContent",
                "search",
                "searchAgentMemories",
                "forgetSource",
            ],
        ],
        [
            AgentSessionStore.prototype,
            "session",
            [
                "load",
                "save",
                "get",
                "run",
                "retainEpisode",
                "retainEpisodes",
                "receiptStamp",
                "checkpoint",
                "purge",
            ],
        ],
        [
            RevisionTextStore.prototype,
            "revision-text",
            ["read", "prepare", "prepared", "verified"],
        ],
        [
            DocMemory.prototype,
            "doc-memory",
            [
                "buildIndex",
                "addToIndex",
                "serialize",
                "deserialize",
                "writeToFile",
            ],
        ],
        [DocMemory, "doc-memory", ["readFromFile"]],
        [KnowProCorpusIndex.prototype, "corpus-index", ["rebuildRetained"]],
    ];
    for (const [prototype, prefix, methods] of hooks)
        for (const method of methods) {
            const specific =
                /Manifest|save|checkpoint|verified|serialize|writeToFile/.test(
                    method,
                );
            profiler.wrap(
                prototype,
                method,
                `${prefix}.${method}`,
                `${prefix}.${method}`,
                specific ? 80 : 40,
            );
        }
    profiler.wrap(
        FileMemoryService.prototype,
        "getCorpusRuntime",
        "corpus.getCorpusRuntime",
        "corpus.runtime",
        40,
        (original) =>
            function (...args) {
                return profiler.measure(
                    "corpus.getCorpusRuntime",
                    "corpus.runtime",
                    40,
                    async () => {
                        const runtime = await original.apply(this, args);
                        for (const method of ["read", "write"])
                            profiler.wrap(
                                runtime.access,
                                method,
                                `corpus.lock.${method}`,
                                "queue.wait",
                                50,
                                (access) =>
                                    function (operation) {
                                        const wait = profiler.begin(
                                            `corpus.lock.${method}.wait`,
                                            "queue.wait",
                                            50,
                                        );
                                        try {
                                            return Promise.resolve(
                                                access.call(
                                                    this,
                                                    (...values) => {
                                                        profiler.end(wait);
                                                        return profiler.measure(
                                                            `corpus.lock.${method}.execute`,
                                                            "queue.execute",
                                                            45,
                                                            () =>
                                                                operation(
                                                                    ...values,
                                                                ),
                                                        );
                                                    },
                                                ),
                                            ).finally(() => profiler.end(wait));
                                        } catch (error) {
                                            profiler.end(wait, true);
                                            throw error;
                                        }
                                    },
                            );
                        return runtime;
                    },
                );
            },
    );
    if (runtime.tracker) {
        profiler.wrap(
            runtime.tracker.model,
            "complete",
            "provider.chat",
            "provider.chat",
            100,
        );
        profiler.wrap(
            runtime.tracker,
            "persist",
            "harness.persist.chat-log",
            "harness.persistence",
            90,
        );
    }
    if (runtime.embeddingTracker) {
        profiler.wrap(
            runtime.embeddingTracker,
            "persist",
            "harness.persist.embedding-log",
            "harness.persistence",
            90,
        );
        profiler.wrap(
            runtime.embeddingTracker,
            "invoke",
            "embedding.invoke",
            "embedding.orchestration",
            60,
            (original) =>
                function (model, ...args) {
                    for (const method of [
                        "generateEmbedding",
                        "generateEmbeddingBatch",
                    ])
                        if (model[method])
                            profiler.wrap(
                                model,
                                method,
                                `provider.embedding.${method}`,
                                "provider.embedding",
                                100,
                            );
                    return original.call(this, model, ...args);
                },
        );
    }
}

export async function runProfile(argv) {
    const index = argv.indexOf("--profile-directory");
    assert.ok(index >= 0 && argv[index + 1], "--profile-directory is required");
    const profileDirectory = path.resolve(argv[index + 1]);
    const evaluator = await import("./evaluate.mjs");
    const options = evaluator.parseArgs([
        ...argv.slice(0, index),
        ...argv.slice(index + 2),
    ]);
    const inside = (parent, child) => {
        const relative = path.relative(parent, child);
        return (
            relative === "" ||
            (!relative.startsWith("..") && !path.isAbsolute(relative))
        );
    };
    assert.ok(
        !inside(options.runDirectory, profileDirectory),
        "Profile directory must be outside evaluation output",
    );
    assert.ok(
        !options.resumeFrom || !inside(options.resumeFrom, profileDirectory),
        "Profile directory must not modify resume source",
    );
    await rawMkdir(profileDirectory);
    const profiler = new StageProfiler();
    profiler.installFilesystem();
    profiler.installFetch();
    const compiled = (relative) =>
        import(
            pathToFileURL(path.join(evaluator.tsRoot, ...relative.split("/")))
                .href
        );
    let progress = Promise.resolve();
    let progressFailure;
    const timer = setInterval(() => {
        const value = JSON.stringify(profiler.snapshot(), null, 2) + "\n";
        progress = progress
            .then(() =>
                rawWriteFile(
                    path.join(profileDirectory, "progress.json"),
                    value,
                ),
            )
            .catch((error) => {
                progressFailure = error;
            });
    }, 30_000);
    let receipt;
    try {
        receipt = await profiler.measure(
            "evaluation",
            "harness.unclassified",
            0,
            () =>
                evaluator.evaluate(options, {
                    profilePhase: (name, operation) =>
                        profiler.measure(name, name, 20, operation),
                    createRuntime: async (...args) => {
                        const runtime = await profiler.measure(
                            "runtime.initialize",
                            "runtime.initialize",
                            20,
                            () => evaluator.createRuntime(...args),
                        );
                        try {
                            await instrumentRuntime(
                                profiler,
                                runtime,
                                compiled,
                            );
                            runtime.profilePhase = (name, operation) =>
                                profiler.measure(name, name, 20, operation);
                            return runtime;
                        } catch (error) {
                            await runtime.stop();
                            throw error;
                        }
                    },
                }),
        );
        return receipt;
    } finally {
        clearInterval(timer);
        await progress;
        const result = profiler.close();
        result.state = receipt?.state ?? "failed";
        result.evaluationElapsedMs = receipt?.elapsedMs ?? null;
        if (progressFailure)
            result.progressWriteFailure = {
                code: progressFailure.code ?? "unknown",
            };
        await rawWriteFile(
            path.join(profileDirectory, "profile.json"),
            JSON.stringify(result, null, 2) + "\n",
        );
        if (progressFailure) throw progressFailure;
    }
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        const result = await runProfile(process.argv.slice(2));
        process.stdout.write(
            JSON.stringify({
                state: result.state,
                cases: result.cases.length,
                elapsedMs: result.elapsedMs,
            }) + "\n",
        );
        process.exitCode = result.state === "complete" ? 0 : 1;
    } catch (error) {
        console.error(
            JSON.stringify({
                state: "failed",
                code: error.code ?? "profiling-failed",
                message:
                    error instanceof assert.AssertionError
                        ? error.message
                        : undefined,
            }),
        );
        process.exitCode = 1;
    }
}
