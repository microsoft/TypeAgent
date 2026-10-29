// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { createCheckpointObserver } from "./knowledge-observer.mjs";

async function flush() {
    for (let index = 0; index < 40; index++) await Promise.resolve();
}

function fixture() {
    let checkpoint = {
        checkpointId: "checkpoint",
        updatedAt: "original-durable-time",
        state: "running",
        families: ["questions", "wiki", "projects", "topics"],
        reasons: [],
    };
    const record = {
        corpusId: "corpus",
        knowledgeCheckpoint: structuredClone(checkpoint),
        knowledgeWait: { outcome: "timed-out" },
    };
    const writes = [];
    let reads = 0;
    const controls = {
        signal: new AbortController().signal,
        failure: (error) => ({ message: error.message }),
        persist: async () => writes.push(structuredClone(record)),
    };
    const service = {
        getKnowledgeCheckpoint: async () => {
            reads++;
            return structuredClone(checkpoint);
        },
        listViewSummaries: async () => ({
            wikiFamily: { enabled: true, pending: false },
            projectFamily: { enabled: true, pending: true },
        }),
    };
    return {
        record,
        service,
        controls,
        writes,
        reads: () => reads,
        transition(state) {
            checkpoint = {
                ...checkpoint,
                state,
                updatedAt: "later-durable-time",
            };
        },
    };
}

test("periodic authoritative refresh reports a late terminal transition and independent family debt within 30 seconds", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    const f = fixture();
    const observer = createCheckpointObserver(f.service, f.record, f.controls);
    await flush();
    assert.equal(f.reads(), 1);
    assert.equal(f.record.knowledgeObservation.observedEpochMs, 1000);
    assert.deepEqual(f.record.knowledgeObservation.completedFamilies, ["wiki"]);
    assert.deepEqual(
        f.record.knowledgeObservation.remainingFamilyDebt.map(
            ({ family, state }) => [family, state],
        ),
        [
            ["questions", "unknown"],
            ["projects", "pending"],
            ["topics", "unknown"],
        ],
    );
    f.transition("failed");
    t.mock.timers.tick(29999);
    await flush();
    assert.equal(f.reads(), 1);
    t.mock.timers.tick(1);
    await observer.done;
    assert.equal(f.record.knowledgeCheckpoint.state, "failed");
    assert.equal(f.record.knowledgeObservation.durableState, "failed");
    assert.equal(f.record.knowledgeObservation.observedEpochMs, 31000);
    assert.equal(
        f.record.knowledgeObservation.checkpointUpdatedAt,
        "later-durable-time",
    );
    assert.equal(
        f.record.knowledgeObservation.requiredCheckpointSatisfied,
        false,
    );
    assert.equal(f.record.knowledgeObservation.active, false);
    assert.equal(f.writes.at(-1).knowledgeObservation.active, false);
    assert.equal(f.record.knowledgeWait.outcome, "timed-out");
    t.mock.timers.tick(120000);
    await flush();
    assert.equal(f.reads(), 2);
});

test("a post-wait refresh joins a pending older read before sampling the later state", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    const f = fixture();
    const pending = Promise.withResolvers();
    let reads = 0;
    f.service.getKnowledgeCheckpoint = () => {
        if (++reads === 1) return pending.promise;
        return Promise.resolve({
            ...f.record.knowledgeCheckpoint,
            state: "failed",
            updatedAt: "late",
        });
    };
    const observer = createCheckpointObserver(f.service, f.record, f.controls);
    await flush();
    const refreshed = observer.refresh();
    pending.resolve({ ...f.record.knowledgeCheckpoint });
    await refreshed;
    await observer.done;
    assert.equal(reads, 2);
    assert.equal(f.record.knowledgeCheckpoint.state, "failed");
    assert.equal(f.record.knowledgeObservation.checkpointUpdatedAt, "late");
    assert.equal(f.writes.at(-1).knowledgeObservation.durableState, "failed");
});

test("refresh cadence includes publication time instead of adding it to the polling interval", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    const f = fixture();
    const publication = Promise.withResolvers();
    let reads = 0;
    f.service.getKnowledgeCheckpoint = async () => ({
        ...f.record.knowledgeCheckpoint,
        state: ++reads === 1 ? "running" : "failed",
    });
    f.controls.persist = () =>
        reads === 1 ? publication.promise : Promise.resolve();
    const observer = createCheckpointObserver(f.service, f.record, f.controls);
    await flush();
    assert.equal(f.record.knowledgeObservation.staleAfterEpochMs, 61000);
    t.mock.timers.tick(45000);
    publication.resolve();
    await flush();
    t.mock.timers.tick(0);
    await observer.done;
    assert.equal(reads, 2);
    assert.equal(f.record.knowledgeObservation.observedEpochMs, 46000);
});

test("shutdown joins in-flight reads without polling or accepting late state and propagates late rejections", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    for (const lateFailure of [false, true]) {
        const f = fixture();
        const pending = Promise.withResolvers();
        let reads = 0;
        f.service.getKnowledgeCheckpoint = () => {
            reads++;
            return pending.promise;
        };
        const observer = createCheckpointObserver(
            f.service,
            f.record,
            f.controls,
        );
        await flush();
        t.mock.timers.tick(120000);
        await flush();
        assert.equal(reads, 1);
        let finished = false;
        const stopped = observer.stop().then(
            () => {
                finished = true;
            },
            (error) => {
                finished = true;
                throw error;
            },
        );
        const checked = lateFailure
            ? assert.rejects(stopped, /late status rejection/)
            : stopped;
        await flush();
        assert.equal(finished, false);
        if (lateFailure) pending.reject(new Error("late status rejection"));
        else
            pending.resolve({
                ...f.record.knowledgeCheckpoint,
                state: "ready",
            });
        await checked;
        await flush();
        t.mock.timers.tick(120000);
        await flush();
        assert.equal(reads, 1);
        assert.equal(f.record.knowledgeCheckpoint.state, "running");
        assert.equal(f.record.knowledgeObservation.active, false);
        assert.equal(f.record.knowledgeObservation.status, "unknown");
        assert.equal(f.writes.length, lateFailure ? 1 : 0);
    }
});

test("initial and later status-read failures retain explicit unknown or stale history and stop without retry", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    for (const initial of [true, false]) {
        const f = fixture();
        const error = new Error("status unavailable");
        const read = f.service.getKnowledgeCheckpoint;
        let fail = initial;
        let calls = 0;
        f.service.getKnowledgeCheckpoint = async () => {
            calls++;
            if (fail) throw error;
            return read();
        };
        const observer = createCheckpointObserver(
            f.service,
            f.record,
            f.controls,
        );
        const rejected = assert.rejects(
            observer.done,
            (actual) => actual === error,
        );
        await flush();
        if (!initial) {
            fail = true;
            t.mock.timers.tick(30000);
        }
        await rejected;
        assert.equal(
            f.record.knowledgeObservation.status,
            initial ? "unknown" : "stale",
        );
        assert.equal(
            f.record.knowledgeObservation.errors[0].stage,
            "status-read",
        );
        assert.equal(
            f.writes.at(-1).knowledgeObservation.errors[0].error.message,
            error.message,
        );
        const before = calls;
        t.mock.timers.tick(120000);
        await flush();
        assert.equal(calls, before);
    }
});

test("publication failures reject observation; combined read/publication failure retains both errors", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    for (const readFailure of [false, true]) {
        const f = fixture();
        const disk = new Error("publication failed");
        const read = new Error("status failed");
        if (readFailure)
            f.service.getKnowledgeCheckpoint = async () => {
                throw read;
            };
        let writes = 0;
        f.controls.persist = async () => {
            writes++;
            throw disk;
        };
        const observer = createCheckpointObserver(
            f.service,
            f.record,
            f.controls,
        );
        await assert.rejects(observer.done, (error) => {
            if (!readFailure) return error === disk;
            assert.deepEqual(error.errors, [read, disk]);
            return true;
        });
        assert.equal(f.record.knowledgeObservation.active, false);
        assert.equal(
            f.record.knowledgeObservation.errors[0].stage,
            readFailure ? "status-read" : "persistence",
        );
        t.mock.timers.tick(120000);
        await flush();
        assert.equal(writes, 1);
    }
});

test("close joins an in-flight publication before resolving observer completion", async () => {
    const f = fixture();
    const publication = Promise.withResolvers();
    f.controls.persist = () => publication.promise;
    const observer = createCheckpointObserver(f.service, f.record, f.controls);
    await flush();
    let finished = false;
    const stopped = observer.stop().then(() => {
        finished = true;
    });
    await flush();
    assert.equal(finished, false);
    publication.resolve();
    await stopped;
    assert.equal(f.record.knowledgeObservation.active, false);
});
