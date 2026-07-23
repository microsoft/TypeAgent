// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createScriptExecutor } from "../src/execution/scriptExecutor.js";

describe("script executor", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it("clears the timeout after a successful script", async () => {
        jest.useFakeTimers();
        const executor = createScriptExecutor({
            apiParamName: "repo",
            defaultTimeout: 30_000,
        });

        await expect(
            executor.execute(
                "async function execute(repo, params) { return { success: true, data: params.value }; }",
                {},
                { value: "done" },
            ),
        ).resolves.toEqual({ success: true, data: "done" });
        expect(jest.getTimerCount()).toBe(0);
    });

    it("returns a failure when asynchronous execution times out", async () => {
        jest.useFakeTimers();
        const executor = createScriptExecutor({
            apiParamName: "repo",
            defaultTimeout: 100,
        });

        const execution = executor.execute(
            "async function execute() { await new Promise(() => undefined); }",
            {},
            {},
        );
        await jest.advanceTimersByTimeAsync(100);

        await expect(execution).resolves.toEqual({
            success: false,
            error: "Script execution timeout",
            message: "Script execution failed: Script execution timeout",
        });
        expect(jest.getTimerCount()).toBe(0);
    });
});
