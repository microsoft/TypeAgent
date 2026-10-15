// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPerformanceTrace, unionMs } from "./performance-trace.mjs";
import { installOfflineTrace } from "./p6-preflight.mjs";

test("exclusive duration subtracts interval union, not overlapping sums", () => {
    assert.equal(
        unionMs(
            [
                [1, 8],
                [3, 9],
                [12, 22],
            ],
            0,
            20,
        ),
        16,
    );
    assert.equal(unionMs([[0, 30]], 5, 15), 10);
});

test("sparse metadata retains view and source identities without source bodies", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memory-metadata-"));
    const trace = createPerformanceTrace(
        root,
        "metadata-control",
        () => "test",
    );
    const target = { generate: async () => "complete" };
    trace.wrap(target, "generate", "adapter.generate");
    await target.generate(
        { corpusId: "corpus", id: "job" },
        {
            snapshot: {
                definition: { viewId: "view", wiki: { query: "scope" } },
                inputFingerprint: "fingerprint",
                inputs: [
                    { passages: [{ excerpt: "NOT_METADATA_PROSE" }] },
                    { passages: [{}] },
                ],
            },
        },
    );
    await trace.close();
    const raw = await readFile(
        path.join(root, "performance-events.jsonl"),
        "utf8",
    );
    const enter = raw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .find((event) => event.edge === "ENTER");
    assert.deepEqual(
        Object.fromEntries(
            [
                "corpusId",
                "jobId",
                "viewId",
                "query",
                "fingerprint",
                "sources",
                "fragments",
            ].map((key) => [key, enter[key]]),
        ),
        {
            corpusId: "corpus",
            jobId: "job",
            viewId: "view",
            query: "scope",
            fingerprint: "fingerprint",
            sources: 2,
            fragments: 2,
        },
    );
    assert.equal(raw.includes("NOT_METADATA_PROSE"), false);
});

test("history snapshot state remains original and is never serialized into metadata telemetry", async () => {
    const root = await mkdtemp(
        path.join(
            process.env.QUALIFICATION_ARTIFACTS ?? os.tmpdir(),
            "memory-performance-control-",
        ),
    );
    const trace = createPerformanceTrace(
        root,
        "snapshot-control",
        () => "test",
    );
    const snapshot = { state: { originalBody: "NOT_TELEMETRY_PROSE" } };
    const promised = Promise.resolve(snapshot);
    const target = { read: () => promised };
    trace.wrap(target, "read", "history.read");
    assert.equal(target.read(), promised);
    assert.equal(await promised, snapshot);
    const summary = await trace.close();
    assert.equal(summary.groups["test/history.read"].calls, 1);
    assert.equal(
        (
            await readFile(path.join(root, "performance-events.jsonl"), "utf8")
        ).includes("NOT_TELEMETRY_PROSE"),
        false,
    );
});

test("actual role-trace installer ignores identity metadata and absent optional methods", async () => {
    const root = await mkdtemp(
        path.join(
            process.env.QUALIFICATION_ARTIFACTS ?? os.tmpdir(),
            "memory-performance-control-",
        ),
    );
    const trace = createPerformanceTrace(root, "role-control", () => "test");
    const promised = Promise.resolve("actual");
    const options = {
        viewSynthesisAdapter: {
            identity: "unchanged",
            generate: () => promised,
        },
        sourceSynopsisModel: {
            identity: "unchanged",
            fits: () => true,
            complete: () => promised,
        },
    };
    installOfflineTrace(options, { tracer: trace, onEvent: trace.event });
    assert.equal(options.sourceSynopsisModel.identity, "unchanged");
    assert.equal(options.viewSynthesisAdapter.generate(), promised);
    assert.equal(options.sourceSynopsisModel.complete(), promised);
    await promised;
    const summary = await trace.close();
    assert.equal(summary.groups["test/adapter.generate"].calls, 1);
    assert.equal(summary.groups["test/synopsis.complete"].calls, 1);
});

test("observer preserves receiver, exact promise, rejection, synchronous throw and cancellation", async () => {
    const root = await mkdtemp(
        path.join(
            process.env.QUALIFICATION_ARTIFACTS ?? os.tmpdir(),
            "memory-performance-control-",
        ),
    );
    const trace = createPerformanceTrace(root, "control", () => "test");
    const controller = new AbortController();
    const failure = new Error("original error");
    const fulfilled = Promise.resolve({ state: "complete" });
    const target = {
        value: 42,
        success(signal) {
            assert.equal(this.value, 42);
            assert.equal(signal, controller.signal);
            return fulfilled;
        },
        rejected() {
            return Promise.reject(failure);
        },
        thrown() {
            throw failure;
        },
        cancelled(signal) {
            signal.throwIfAborted();
        },
    };
    const original = target.success;
    for (const method of ["success", "rejected", "thrown", "cancelled"])
        trace.wrap(target, method, method);
    assert.equal(target.success(controller.signal), fulfilled);
    await fulfilled;
    await assert.rejects(target.rejected(), (error) => error === failure);
    assert.throws(
        () => target.thrown(),
        (error) => error === failure,
    );
    controller.abort(failure);
    assert.throws(
        () => target.cancelled(controller.signal),
        (error) => error === failure,
    );
    const summary = await trace.close();
    assert.equal(target.success, original);
    assert.equal(summary.groups["test/success"].calls, 1);
    assert.equal(summary.groups["test/rejected"].errors, 1);
    assert.equal(summary.pending.length, 0);
    assert.equal(summary.status, "COMPLETE_SPARSE_AND_ROLLUP_COVERAGE");
    assert.ok(
        (
            await readFile(path.join(root, "performance-events.jsonl"), "utf8")
        ).includes('"monoNs"'),
    );
});

test("ten thousand history leaves roll up without per-leaf JSONL or retained spans", async () => {
    const root = await mkdtemp(
        path.join(
            process.env.QUALIFICATION_ARTIFACTS ?? os.tmpdir(),
            "memory-performance-control-",
        ),
    );
    const trace = createPerformanceTrace(root, "rollup-control", () => "test");
    const value = Buffer.alloc(32);
    const target = { read: () => Promise.resolve(value) };
    trace.wrap(target, "read", "history.read");
    for (let i = 0; i < 10000; i++) assert.equal(await target.read(), value);
    const summary = await trace.close();
    assert.equal(summary.groups["test/history.read"].calls, 10000);
    assert.equal(summary.groups["test/history.read"].returnedBytes, 320000);
    assert.ok(summary.events < 10);
    assert.ok(summary.bytes < 10000);
    assert.equal(summary.pending.length, 0);
});

test("queue callback observes real wait/access work and preserves outer and inner results", async () => {
    const root = await mkdtemp(
        path.join(
            process.env.QUALIFICATION_ARTIFACTS ?? os.tmpdir(),
            "memory-performance-control-",
        ),
    );
    const trace = createPerformanceTrace(root, "queue-control", () => "test");
    const expected = { original: true };
    let callback;
    const outer = new Promise((resolve) => {
        callback = resolve;
    });
    const target = {
        read(operation) {
            this.operation = operation;
            return outer;
        },
    };
    trace.queue(target, "read", "access.read");
    assert.equal(
        target.read(function () {
            assert.equal(this, target);
            return expected;
        }),
        outer,
    );
    assert.equal(target.operation(), expected);
    callback(expected);
    assert.equal(await outer, expected);
    const summary = await trace.close();
    assert.equal(summary.groups["test/access.read.callback"].calls, 1);
    assert.equal(summary.groups["test/access.read.queue"].calls, 1);
});
