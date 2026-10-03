// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { retryProcedurePublication } from "../src/procedurePublication.js";

test("retries transient Windows version publication without rewriting content", async () => {
    const publish = import.meta.jest
        .fn(async () => undefined)
        .mockRejectedValueOnce(
            Object.assign(new Error("locked"), { code: "EPERM" }),
        )
        .mockRejectedValueOnce(
            Object.assign(new Error("busy"), { code: "EBUSY" }),
        )
        .mockResolvedValue(undefined);
    const waits: number[] = [];
    await retryProcedurePublication(
        publish,
        async (milliseconds) => {
            waits.push(milliseconds);
        },
        true,
    );
    expect(publish).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([25, 50]);
});

test("bounds retries and preserves the final publication error", async () => {
    const error = Object.assign(new Error("locked"), { code: "EACCES" });
    const publish = import.meta.jest
        .fn(async () => undefined)
        .mockRejectedValue(error);
    const waits: number[] = [];
    await expect(
        retryProcedurePublication(
            publish,
            async (milliseconds) => {
                waits.push(milliseconds);
            },
            true,
        ),
    ).rejects.toBe(error);
    expect(publish).toHaveBeenCalledTimes(5);
    expect(waits).toEqual([25, 50, 100, 200]);
});

test("does not retry non-Windows or non-transient errors", async () => {
    const locked = Object.assign(new Error("locked"), { code: "EPERM" });
    const denied = import.meta.jest
        .fn(async () => undefined)
        .mockRejectedValue(locked);
    const wait = import.meta.jest.fn(
        async (_milliseconds: number) => undefined,
    );
    await expect(retryProcedurePublication(denied, wait, false)).rejects.toBe(
        locked,
    );
    expect(denied).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const publish = import.meta.jest
        .fn(async () => undefined)
        .mockRejectedValue(missing);
    await expect(retryProcedurePublication(publish, wait, true)).rejects.toBe(
        missing,
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
});
