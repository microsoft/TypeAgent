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
    await clock.advanceTimersByTimeAsync(59_999);
    expect(clock.getTimerCount()).toBe(1);
    await clock.advanceTimersByTimeAsync(1);
    await assertion;
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
