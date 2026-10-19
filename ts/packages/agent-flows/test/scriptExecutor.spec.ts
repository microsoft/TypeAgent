// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { createScriptExecutor } from "../src/execution/scriptExecutor.js";

describe("script execution timers", () => {
    const executor = createScriptExecutor({
        apiParamName: "api",
        defaultTimeout: 100,
    });

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test.each([
        ["async () => 42", true],
        ['async () => { throw new Error("failed"); }', false],
        ['() => { throw new Error("failed"); }', false],
        ["not valid script", false],
    ])("clears timers after %s", async (source, success) => {
        const result = await executor.execute(source, {}, {});
        expect(result.success).toBe(success);
        expect(jest.getTimerCount()).toBe(0);
    });

    test("still times out a pending script and clears the timer", async () => {
        const result = executor.execute(
            "async (api) => api.pending()",
            { pending: () => new Promise<never>(() => {}) },
            {},
            { timeout: 20 },
        );
        expect(jest.getTimerCount()).toBe(1);
        await jest.advanceTimersByTimeAsync(20);
        expect(await result).toMatchObject({
            success: false,
            error: "Script execution timeout",
        });
        expect(jest.getTimerCount()).toBe(0);
    });
});
