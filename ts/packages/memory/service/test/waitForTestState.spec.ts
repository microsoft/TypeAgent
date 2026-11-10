// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { waitForTestState } from "./waitForTestState.js";

const clock = import.meta.jest;

beforeEach(() => clock.useFakeTimers());
afterEach(() => clock.useRealTimers());

test("returns immediately when work is already complete", async () => {
    await expect(
        waitForTestState(
            async () => "complete",
            (state) => state === "complete",
            "Job",
        ),
    ).resolves.toBe("complete");
    expect(clock.getTimerCount()).toBe(0);
});

test.each([4_000, 12_000, 25_000])(
    "waits for completion after %i ms, beyond the former fixture limits",
    async (duration) => {
        const start = Date.now();
        const result = waitForTestState(
            async () =>
                Date.now() - start >= duration ? "complete" : "running",
            (state) => state === "complete",
            "Job",
        );
        const assertion = expect(result).resolves.toBe("complete");
        await clock.advanceTimersByTimeAsync(duration);
        await assertion;
        expect(Date.now() - start).toBe(duration);
        expect(clock.getTimerCount()).toBe(0);
    },
);

test("fails at the deadline with the last observed state", async () => {
    const result = waitForTestState(
        async () => ({ state: "running", jobId: "stuck" }),
        () => false,
        "View build",
    );
    const assertion = expect(result).rejects.toThrow(
        'View build did not settle: {"state":"running","jobId":"stuck"}',
    );
    await clock.advanceTimersByTimeAsync(29_999);
    expect(clock.getTimerCount()).toBe(1);
    await clock.advanceTimersByTimeAsync(1);
    await assertion;
    expect(clock.getTimerCount()).toBe(0);
});

test("bounds a state read that never returns", async () => {
    const result = waitForTestState(
        () => new Promise<never>(() => {}),
        () => false,
        "Recovery receipt",
    );
    const assertion = expect(result).rejects.toThrow(
        "Recovery receipt did not settle: no state returned (state read pending)",
    );
    await clock.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(clock.getTimerCount()).toBe(0);
});

test("retains the last state when a later read hangs and does not poll after timeout", async () => {
    let reads = 0;
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
        release = resolve;
    });
    const result = waitForTestState(
        async () => (++reads === 1 ? "running" : pending),
        () => false,
        "Index publication",
        { timeoutMs: 100 },
    );
    const assertion = expect(result).rejects.toThrow(
        'Index publication did not settle: "running" (state read pending)',
    );
    await clock.advanceTimersByTimeAsync(100);
    await assertion;
    release("late");
    await clock.advanceTimersByTimeAsync(100);
    expect(reads).toBe(2);
    expect(clock.getTimerCount()).toBe(0);
});

test("successive stages share an absolute deadline instead of resetting the budget", async () => {
    const deadline = Date.now() + 100;
    const first = waitForTestState(
        async () => Date.now() >= deadline - 60,
        (ready) => ready,
        "Prepare",
        { deadline },
    );
    await clock.advanceTimersByTimeAsync(40);
    await first;
    const second = waitForTestState(
        async () => "running",
        () => false,
        "Recover",
        { deadline },
    );
    const assertion = expect(second).rejects.toThrow(
        'Recover did not settle: "running"',
    );
    await clock.advanceTimersByTimeAsync(60);
    await assertion;
    expect(Date.now()).toBe(deadline);
    expect(clock.getTimerCount()).toBe(0);
});

test("propagates read failures without polling again", async () => {
    await expect(
        waitForTestState(
            async () => {
                throw new Error("Index write failed");
            },
            () => false,
            "Job",
        ),
    ).rejects.toThrow("Index write failed");
    expect(clock.getTimerCount()).toBe(0);
});
