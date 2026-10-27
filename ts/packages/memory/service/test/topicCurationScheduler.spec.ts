// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { runOrderedTopicBatches } from "../src/topicCurationScheduler.js";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
const packet = (start: number) => ({
    start,
    end: start + 1,
    fingerprint: `${start}`,
});

test("disjoint calls overlap, finish out of order and commit in canonical order", async () => {
    const first = deferred(),
        both = deferred();
    const commits: number[] = [],
        calls: number[] = [];
    const run = runOrderedTopicBatches(
        2,
        2,
        new AbortController().signal,
        packet,
        async ({ start }) => {
            calls.push(start);
            if (calls.length === 2) both.resolve();
            if (start === 0) await first.promise;
            return start;
        },
        async (_packet, value) => {
            commits.push(value);
        },
    );
    await both.promise;
    expect(commits).toEqual([]);
    first.resolve();
    await run;
    expect(calls).toEqual([0, 1]);
    expect(commits).toEqual([0, 1]);
});

test("changed packet/root dependencies discard and drain stale proposals before retry", async () => {
    const first = deferred(),
        stale = deferred(),
        both = deferred(),
        aborted = deferred();
    let revision = 0;
    const calls: string[] = [],
        commits: string[] = [];
    const run = runOrderedTopicBatches(
        3,
        2,
        new AbortController().signal,
        (start) => ({
            start,
            end: start === 1 && revision ? 3 : start + 1,
            fingerprint: `${start}:${revision}`,
        }),
        async (packet, signal) => {
            calls.push(packet.fingerprint);
            if (calls.length === 2) both.resolve();
            if (packet.start === 0) await first.promise;
            if (packet.fingerprint === "1:0") {
                signal.addEventListener("abort", aborted.resolve, {
                    once: true,
                });
                await stale.promise;
            }
            return packet.fingerprint;
        },
        async (_packet, value) => {
            commits.push(value);
            revision++;
        },
    );
    await both.promise;
    first.resolve();
    await aborted.promise;
    expect(calls).toEqual(["0:0", "1:0"]);
    stale.resolve();
    await run;
    expect(calls).toEqual(["0:0", "1:0", "1:1"]);
    expect(commits).toEqual(["0:0", "1:1"]);
});

test("provider failure aborts and drains siblings without committing pending results", async () => {
    const both = deferred(),
        fail = deferred();
    let active = 0,
        drained = false,
        committed = false;
    const run = runOrderedTopicBatches(
        2,
        2,
        new AbortController().signal,
        packet,
        async ({ start }, signal) => {
            if (++active === 2) both.resolve();
            if (!start) {
                await fail.promise;
                throw new Error("Provider failed");
            }
            await new Promise<void>((resolve) =>
                signal.addEventListener(
                    "abort",
                    () => {
                        drained = true;
                        resolve();
                    },
                    { once: true },
                ),
            );
            signal.throwIfAborted();
            return start;
        },
        async () => {
            committed = true;
        },
    );
    await both.promise;
    fail.resolve();
    await expect(run).rejects.toThrow("Provider failed");
    expect(drained).toBe(true);
    expect(committed).toBe(false);
});

test("cancelled signal-ignoring providers are drained and cannot commit", async () => {
    const both = deferred(),
        release = deferred();
    const controller = new AbortController();
    let calls = 0,
        commits = 0;
    const run = runOrderedTopicBatches(
        4,
        2,
        controller.signal,
        packet,
        async () => {
            if (++calls === 2) both.resolve();
            await release.promise;
            return 0;
        },
        async () => {
            commits++;
        },
    );
    await both.promise;
    controller.abort(new Error("Cancelled"));
    release.resolve();
    await expect(run).rejects.toThrow("Cancelled");
    expect(calls).toBe(2);
    expect(commits).toBe(0);
});

test("checkpoint publication failure drains speculative calls without publishing them", async () => {
    const both = deferred();
    let calls = 0,
        drained = false;
    const commits: number[] = [];
    await expect(
        runOrderedTopicBatches(
            3,
            2,
            new AbortController().signal,
            packet,
            async ({ start }, signal) => {
                if (++calls === 2) both.resolve();
                if (!start) await both.promise;
                else {
                    await new Promise<void>((resolve) =>
                        signal.addEventListener(
                            "abort",
                            () => {
                                drained = true;
                                resolve();
                            },
                            { once: true },
                        ),
                    );
                    signal.throwIfAborted();
                }
                return start;
            },
            async (_packet, value) => {
                commits.push(value);
                throw new Error("Checkpoint persistence failed");
            },
        ),
    ).rejects.toThrow("Checkpoint persistence failed");
    expect(drained).toBe(true);
    expect(calls).toBe(2);
    expect(commits).toEqual([0]);
});
