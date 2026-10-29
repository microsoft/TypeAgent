// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createMaintenanceBuildScheduler,
    yieldMaintenanceBuild,
} from "../src/maintenanceConcurrency.js";
import { runOrderedTopicBatches } from "../src/topicCurationScheduler.js";

function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test.each([false, true])(
    "priority=%s uses every slot without preempting active work",
    async (priority) => {
        const schedule = createMaintenanceBuildScheduler(4, false, priority);
        const release = gate();
        const entered: string[] = [];
        const native = Array.from({ length: 8 }, (_, index) =>
            schedule(async () => {
                entered.push(`native-${index}`);
                if (index < 4) await release.promise;
            }, true),
        );
        const short = schedule(async () => {
            entered.push("short");
        }, false);
        await turn();
        expect(entered).toEqual([
            "native-0",
            "native-1",
            "native-2",
            "native-3",
        ]);
        release.resolve();
        await Promise.all([...native, short]);
        expect(entered.indexOf("short")).toBe(priority ? 4 : 8);
        expect(entered.filter((name) => name.startsWith("native"))).toEqual(
            Array.from({ length: 8 }, (_, index) => `native-${index}`),
        );
    },
);

test("three short admissions are followed by native service under sustained demand", async () => {
    const schedule = createMaintenanceBuildScheduler(1, false, true);
    const release = gate();
    const entered: string[] = [];
    const first = schedule(() => release.promise, true);
    const native = Array.from({ length: 2 }, (_, index) =>
        schedule(async () => {
            entered.push(`native-${index}`);
        }, true),
    );
    const short = Array.from({ length: 8 }, (_, index) =>
        schedule(async () => {
            entered.push(`short-${index}`);
        }, false),
    );
    release.resolve();
    await Promise.all([first, ...native, ...short]);
    expect(entered).toEqual([
        "short-0",
        "short-1",
        "short-2",
        "native-0",
        "short-3",
        "short-4",
        "short-5",
        "native-1",
        "short-6",
        "short-7",
    ]);
});

test("a native continuation releases only after its durable checkpoint and drained workers", async () => {
    const schedule = createMaintenanceBuildScheduler(1, false, true);
    const commit = gate();
    const worker = gate();
    const entered: string[] = [];
    let durable = false;
    const native = schedule(async () => {
        entered.push("native");
        await commit.promise;
        durable = true;
        await yieldMaintenanceBuild(new AbortController().signal, async () => {
            await worker.promise;
            entered.push("drained");
        });
        entered.push("resumed");
    }, true);
    await turn();
    const short = schedule(async () => {
        expect(durable).toBe(true);
        entered.push("short");
    }, false);
    await turn();
    expect(entered).toEqual(["native"]);
    commit.resolve();
    await turn();
    expect(entered).toEqual(["native"]);
    worker.resolve();
    await Promise.all([native, short]);
    expect(entered).toEqual(["native", "drained", "short", "resumed"]);
});

test("yield does not drain or relinquish a slot without short demand", async () => {
    const schedule = createMaintenanceBuildScheduler(1, false, true);
    let drains = 0;
    await schedule(async () => {
        await yieldMaintenanceBuild(new AbortController().signal, async () => {
            drains++;
        });
    }, true);
    expect(drains).toBe(0);
});

test.each(["cancelled", "forgotten", "deadline", "closing"])(
    "%s while paused removes the continuation and cannot leak a permit",
    async (reason) => {
        const schedule = createMaintenanceBuildScheduler(1, false, true);
        const checkpoint = gate();
        const enteredShort = gate();
        const releaseShort = gate();
        const controller = new AbortController();
        let resumed = false;
        const native = schedule(async () => {
            await checkpoint.promise;
            await yieldMaintenanceBuild(controller.signal);
            resumed = true;
        }, true);
        const rejection = expect(native).rejects.toThrow(reason);
        const short = schedule(async () => {
            enteredShort.resolve();
            await releaseShort.promise;
        }, false);
        checkpoint.resolve();
        await enteredShort.promise;
        await turn();
        controller.abort(new Error(reason));
        await rejection;
        expect(resumed).toBe(false);
        let following = false;
        const next = schedule(async () => {
            following = true;
        }, true);
        await turn();
        expect(following).toBe(false);
        releaseShort.resolve();
        await Promise.all([short, next]);
        expect(following).toBe(true);
    },
);

test("failed checkpoint or drain does not admit a short job until native cleanup finishes", async () => {
    const schedule = createMaintenanceBuildScheduler(1, false, true);
    const checkpoint = gate();
    const cleanup = gate();
    const entered: string[] = [];
    const native = schedule(async () => {
        try {
            await checkpoint.promise;
            await yieldMaintenanceBuild(
                new AbortController().signal,
                async () => {
                    throw new Error("Checkpoint worker failed");
                },
            );
        } finally {
            entered.push("cleanup");
            await cleanup.promise;
        }
    }, true);
    const rejected = expect(native).rejects.toThrow("Checkpoint worker failed");
    const short = schedule(async () => {
        entered.push("short");
    }, false);
    checkpoint.resolve();
    await turn();
    expect(entered).toEqual(["cleanup"]);
    cleanup.resolve();
    await Promise.all([rejected, short]);
    expect(entered).toEqual(["cleanup", "short"]);
});

test("generative curation drains started lookahead after a checkpoint before lending capacity", async () => {
    const schedule = createMaintenanceBuildScheduler(1, false, true);
    const both = gate();
    const slow = gate();
    const committed = gate();
    let active = 0;
    let durable = 0;
    const order: string[] = [];
    const native = schedule(
        () =>
            runOrderedTopicBatches(
                3,
                2,
                new AbortController().signal,
                (start) => ({
                    start,
                    end: start + 1,
                    fingerprint: String(start),
                }),
                async ({ start }) => {
                    active++;
                    if (start === 1) both.resolve();
                    await both.promise;
                    if (start === 1) await slow.promise;
                    active--;
                    return start;
                },
                async (_packet, value) => {
                    durable++;
                    order.push(`commit-${value}`);
                    if (value === 0) committed.resolve();
                    return true;
                },
            ),
        true,
    );
    await both.promise;
    const short = schedule(async () => {
        expect(active).toBe(0);
        expect(durable).toBe(1);
        order.push("short");
    }, false);
    await committed.promise;
    await turn();
    expect(order).toEqual(["commit-0"]);
    slow.resolve();
    await Promise.all([native, short]);
    expect(order).toEqual(["commit-0", "short", "commit-1", "commit-2"]);
});

test("conflicting explicit reservation and priority fail rather than reserving capacity silently", () => {
    expect(() => createMaintenanceBuildScheduler(4, true, true)).toThrow(
        "cannot both be enabled",
    );
});

test.each([
    ["default", undefined, undefined, ["short", "native"]],
    ["FIFO opt-out", false, false, ["native", "short"]],
    ["explicit reservation", true, undefined, ["short", "native"]],
] as const)(
    "%s remains compatible with policy selection",
    async (_name, reserve, priority, expected) => {
        const schedule = createMaintenanceBuildScheduler(2, reserve, priority);
        const release = gate();
        const first = [
            schedule(() => release.promise, true),
            schedule(() => release.promise, true),
        ];
        const order: string[] = [];
        const native = schedule(async () => {
            order.push("native");
        }, true);
        const short = schedule(async () => {
            order.push("short");
        }, false);
        await turn();
        release.resolve();
        await Promise.all([...first, native, short]);
        expect(order).toEqual(expected);
    },
);
