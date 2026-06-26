// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncMutex } from "../src/installSources/mutex.js";

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AsyncMutex", () => {
    it("serializes concurrent critical sections", async () => {
        const mutex = new AsyncMutex();
        let active = 0;
        let maxActive = 0;
        const order: number[] = [];

        async function op(id: number): Promise<void> {
            await mutex.runExclusive(async () => {
                active++;
                maxActive = Math.max(maxActive, active);
                await delay(20);
                order.push(id);
                active--;
            });
        }

        await Promise.all([op(1), op(2), op(3)]);
        expect(maxActive).toBe(1);
        // FIFO ordering of acquisition.
        expect(order).toEqual([1, 2, 3]);
    });

    it("releases the lock even when the body throws", async () => {
        const mutex = new AsyncMutex();
        await expect(
            mutex.runExclusive(async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
        // The mutex must still be usable.
        const result = await mutex.runExclusive(async () => 42);
        expect(result).toBe(42);
    });

    it("returns the body's resolved value", async () => {
        const mutex = new AsyncMutex();
        await expect(mutex.runExclusive(async () => "ok")).resolves.toBe("ok");
    });
});
