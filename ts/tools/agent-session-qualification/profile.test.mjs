// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { StageProfiler, instrumentRuntime, runProfile } from "./profile.mjs";
import { tsRoot } from "./evaluate.mjs";

test("nested stage durations preserve self time and partition wall time exactly", () => {
    let now = 0;
    const profiler = new StageProfiler(() => now);
    const value = profiler.measure("outer", "work", 10, () => {
        now = 2;
        profiler.measure("inner", "filesystem", 110, () => {
            now = 5;
        });
        now = 10;
        return 42;
    });
    const result = profiler.close();
    assert.equal(value, 42);
    assert.equal(result.elapsedMs, 10);
    assert.equal(result.accountedWallMs, 10);
    assert.equal(
        result.operations.find((item) => item.name === "outer").selfMs,
        7,
    );
    assert.equal(
        result.operations.find((item) => item.name === "inner").inclusiveMs,
        3,
    );
    assert.equal(
        result.wallBuckets.find((item) => item.category === "filesystem")
            .elapsedMs,
        3,
    );
});

test("overlapping children subtract their union and concurrency has an explicit wall bucket", () => {
    let now = 0;
    const profiler = new StageProfiler(() => now);
    const parent = profiler.begin("parent", "work", 10);
    profiler.context.run(parent, () => {
        now = 1;
        const first = profiler.begin("first", "filesystem", 110);
        now = 2;
        const second = profiler.begin("second", "network.chat", 110);
        now = 4;
        profiler.end(first);
        now = 6;
        profiler.end(second);
    });
    now = 8;
    profiler.end(parent);
    const result = profiler.close();
    assert.equal(result.accountedWallMs, 8);
    assert.equal(
        result.operations.find((item) => item.name === "parent").selfMs,
        3,
    );
    assert.equal(
        result.wallBuckets.find(
            (item) => item.category === "filesystem + network.chat",
        ).elapsedMs,
        2,
    );
});

test("method hooks preserve receivers, synchronous results and failures, and restore originals", async () => {
    const object = {
        value: 7,
        sync() {
            return this.value;
        },
        async fail() {
            throw new Error("controlled failure");
        },
    };
    const original = object.sync;
    const profiler = new StageProfiler();
    profiler.wrap(object, "sync", "test.sync", "work", 10);
    profiler.wrap(object, "fail", "test.fail", "work", 10);
    assert.equal(object.sync(), 7);
    await assert.rejects(object.fail(), /controlled failure/);
    const result = profiler.close();
    assert.equal(object.sync, original);
    assert.equal(
        result.operations.find((item) => item.name === "test.fail").failures,
        1,
    );
    assert.equal(JSON.stringify(result).includes("controlled failure"), false);
});

test("filesystem hooks observe existing ESM named imports without logging paths or contents", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-profile-"),
    );
    const profiler = new StageProfiler();
    try {
        profiler.installFilesystem();
        const file = path.join(directory, "session.json");
        await writeFile(file, "PRIVATE-SENTINEL");
        assert.equal(await readFile(file, "utf8"), "PRIVATE-SENTINEL");
        const result = profiler.snapshot();
        assert.ok(
            result.operations.some(
                (item) => item.name === "fs.writeFile:session",
            ),
        );
        assert.ok(
            result.operations.some(
                (item) => item.name === "fs.readFile:session",
            ),
        );
        assert.equal(
            JSON.stringify(result).includes("PRIVATE-SENTINEL"),
            false,
        );
        assert.equal(JSON.stringify(result).includes(directory), false);
    } finally {
        profiler.close();
        await rm(directory, { recursive: true, force: true });
    }
});

test("HTTP profiling records status and numeric Retry-After without URLs or headers", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
        new Response("ignored", {
            status: 429,
            headers: { "retry-after": "2", authorization: "PRIVATE-SENTINEL" },
        });
    const profiler = new StageProfiler();
    try {
        profiler.installFetch();
        const response = await fetch(
            "https://private.invalid/chat/completions",
        );
        assert.equal(response.status, 429);
        const result = profiler.snapshot();
        assert.deepEqual(result.httpStatuses["chat:429"], {
            count: 1,
            retryAfterSeconds: [2],
        });
        assert.equal(JSON.stringify(result).includes("private.invalid"), false);
        assert.equal(
            JSON.stringify(result).includes("PRIVATE-SENTINEL"),
            false,
        );
    } finally {
        profiler.close();
        globalThis.fetch = original;
    }
});

test("production hooks include real storage and lock callbacks without invoking hosted models", async () => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-profile-owner-"),
    );
    const profiler = new StageProfiler();
    const compiled = (relative) =>
        import(pathToFileURL(path.join(tsRoot, ...relative.split("/"))).href);
    let service;
    try {
        await instrumentRuntime(profiler, {}, compiled);
        const { FileMemoryService } = await compiled(
            "packages/memory/service/dist/fileMemoryService.js",
        );
        service = new FileMemoryService(directory);
        const corpus = await service.createCorpus(
            "Profiling controlled corpus",
        );
        await service.getCorpus(corpus.corpusId);
        const runtime = await service.getCorpusRuntime(corpus.corpusId);
        await runtime.access.read(async () => {});
        const result = profiler.snapshot();
        assert.ok(
            result.operations.some(
                (item) => item.name === "corpus.writeManifest",
            ),
        );
        assert.ok(
            result.operations.some(
                (item) => item.name === "corpus.lock.read.wait",
            ),
        );
    } finally {
        await service?.close();
        profiler.close();
        await rm(directory, { recursive: true, force: true });
    }
});

test("profiling CLI requires an explicit separate output directory", async () => {
    await assert.rejects(runProfile([]), /--profile-directory is required/);
    await assert.rejects(
        runProfile([
            "--profile-directory",
            path.join(os.tmpdir(), "profile-corpus", "nested"),
            "--fixture-root",
            os.tmpdir(),
            "--run-directory",
            path.join(os.tmpdir(), "profile-corpus"),
        ]),
        /outside evaluation output/,
    );
});
