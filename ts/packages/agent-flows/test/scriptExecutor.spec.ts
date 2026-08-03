// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { spawnSync } from "node:child_process";
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

    it("preserves an advisory script failure without a runtime marker", async () => {
        const executor = createScriptExecutor({ apiParamName: "repo" });

        await expect(
            executor.execute(
                'async function execute() { return { success: false, error: "advisory failure" }; }',
                {},
                {},
            ),
        ).resolves.toEqual({
            success: false,
            error: "advisory failure",
        });
    });

    it("bridges API methods, values, parameters, and results as JSON", async () => {
        const executor = createScriptExecutor({ apiParamName: "repo" });
        const api = {
            prefix: "host",
            combine(this: { prefix: string }, value: string) {
                return { combined: `${this.prefix}:${value}` };
            },
        };

        await expect(
            executor.execute(
                `async function execute(repo, params) {
                    const result = await repo.combine(params.value);
                    return {
                        success: true,
                        data: { ...result, prefix: repo.prefix },
                    };
                }`,
                api,
                { value: "input" },
            ),
        ).resolves.toEqual({
            success: true,
            data: { combined: "host:input", prefix: "host" },
        });
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
            runtimeError: true,
        });
        expect(jest.getTimerCount()).toBe(0);
    });

    it("terminates a CPU loop started after an awaited host call", () => {
        const executorUrl = new URL(
            "../execution/scriptExecutor.js",
            import.meta.url,
        ).href;
        const childSource = `
            import { createScriptExecutor } from ${JSON.stringify(executorUrl)};
            const executor = createScriptExecutor({
                apiParamName: "repo",
                defaultTimeout: 50,
            });
            const result = await executor.execute(
                "async function execute(repo) { await repo.ping(); while (true) {} }",
                { ping: async () => "pong" },
                {},
            );
            process.stdout.write(JSON.stringify(result));
        `;

        const child = spawnSync(
            process.execPath,
            ["--input-type=module", "--eval", childSource],
            { encoding: "utf8", timeout: 5_000 },
        );

        expect(child.error).toBeUndefined();
        expect(child.status).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual({
            success: false,
            error: "Script execution timeout",
            message: "Script execution failed: Script execution timeout",
            runtimeError: true,
        });
    });

    it.each([
        {
            name: "a generated async-function constructor",
            api: {},
            source: `async function execute() {
                const AsyncFunction = (async () => {})["con" + "structor"];
                const hostType = await AsyncFunction("return typeof process")();
                return { success: true, data: hostType };
            }`,
        },
        {
            name: "a host API function constructor",
            api: { ping: () => "pong" },
            source: `async function execute(repo) {
                const FunctionConstructor = repo.ping["con" + "structor"];
                const hostType = FunctionConstructor("return typeof process")();
                return { success: true, data: hostType };
            }`,
        },
    ])("prevents $name from reaching host globals", async ({ api, source }) => {
        const executor = createScriptExecutor({ apiParamName: "repo" });

        await expect(executor.execute(source, api, {})).resolves.toEqual(
            expect.objectContaining({
                success: false,
                runtimeError: true,
            }),
        );
    });
});
