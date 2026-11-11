// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { runOrderedTopicBatches } from "../src/topicCurationScheduler.js";
import { runWithSearchTiming } from "@typeagent/knowpro";

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

describe("speculative work accounting", () => {
    const originalFlag = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
    const originalWarn = console.warn;
    let events: Array<{
        stage: string;
        metadata: { attempt?: number; aborted?: boolean };
    }>;
    beforeEach(() => {
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        events = [];
        console.warn = (line: unknown) => {
            const text = String(line);
            if (text.startsWith("[memory-search-timing] "))
                events.push(
                    JSON.parse(text.slice("[memory-search-timing] ".length)),
                );
        };
    });
    afterEach(() => {
        console.warn = originalWarn;
        if (originalFlag === undefined)
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = originalFlag;
    });

    test("late post-abort completions remain measured and never become commits", async () => {
        const both = deferred(),
            stale = deferred(),
            aborted = deferred();
        let revision = 0,
            calls = 0;
        const run = runWithSearchTiming("accounting", "test", () =>
            runOrderedTopicBatches(
                2,
                2,
                new AbortController().signal,
                (start) => ({
                    start,
                    end: start + 1,
                    fingerprint: `${start}:${revision}`,
                }),
                async ({ start, fingerprint }, signal) => {
                    if (++calls === 2) both.resolve();
                    if (start === 0) await both.promise;
                    if (fingerprint === "1:0") {
                        signal.addEventListener("abort", aborted.resolve, {
                            once: true,
                        });
                        await stale.promise;
                    }
                    return fingerprint;
                },
                async () => {
                    revision++;
                },
            ),
        );
        await aborted.promise;
        stale.resolve();
        await run;
        const at = (stage: string) =>
            events.filter(
                (event) =>
                    event.stage === `topic.curation.speculation.${stage}`,
            );
        expect(at("proposed")).toHaveLength(3);
        expect(at("started")).toHaveLength(3);
        expect(at("completed")).toHaveLength(3);
        expect(at("discard")).toHaveLength(1);
        expect(at("abort")).toHaveLength(1);
        expect(
            at("completed").filter((event) => event.metadata.aborted),
        ).toHaveLength(1);
        expect(at("commit").map((event) => event.metadata.attempt)).toEqual([
            1, 3,
        ]);
    });

    test("failed publication has no success-shaped commit event", async () => {
        await expect(
            runWithSearchTiming("accounting", "test", () =>
                runOrderedTopicBatches(
                    1,
                    1,
                    new AbortController().signal,
                    packet,
                    async () => 1,
                    async () => {
                        throw new Error("Checkpoint publication failed");
                    },
                ),
            ),
        ).rejects.toThrow("Checkpoint publication failed");
        expect(
            events.filter(
                (event) =>
                    event.stage === "topic.curation.speculation.completed",
            ),
        ).toHaveLength(1);
        expect(
            events.filter(
                (event) => event.stage === "topic.curation.speculation.commit",
            ),
        ).toHaveLength(0);
    });
});
