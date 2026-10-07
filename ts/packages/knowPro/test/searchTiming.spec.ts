// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    currentSearchTraceId,
    recordSearchTiming,
    runWithSearchTiming,
    timeSearchStage,
} from "../src/searchTiming.js";

describe("search timing", () => {
    const originalFlag = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
    const originalWarn = console.warn;
    let logs: string[];

    beforeEach(() => {
        logs = [];
        console.warn = (line: unknown) => {
            logs.push(String(line));
        };
    });

    afterEach(() => {
        if (originalFlag === undefined) {
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        } else {
            process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = originalFlag;
        }
        console.warn = originalWarn;
    });

    test("disabled tracing performs no clocks or logs and preserves return values", async () => {
        delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        const clock = performance.now;
        let clockCalls = 0;
        performance.now = () => {
            clockCalls++;
            return clock.call(performance);
        };
        try {
            const pending = Promise.resolve(42);
            expect(
                runWithSearchTiming("ignored", "test", () =>
                    timeSearchStage("async", () => pending),
                ),
            ).toBe(pending);
            expect(await pending).toBe(42);
            expect(timeSearchStage("sync", () => 7)).toBe(7);
            recordSearchTiming("manual", 1);
            expect(currentSearchTraceId()).toBeUndefined();
            expect(clockCalls).toBe(0);
            expect(logs).toEqual([]);
        } finally {
            performance.now = clock;
        }
    });

    test("enabled stages inherit context and emit only safe metadata", async () => {
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        await runWithSearchTiming(
            "trace-1",
            "outer",
            async () => {
                expect(timeSearchStage("sync", () => 12)).toBe(12);
                await runWithSearchTiming(undefined, "nested", async () => {
                    await Promise.resolve();
                    expect(currentSearchTraceId()).toBe("trace-1");
                    await timeSearchStage("async", () =>
                        Promise.resolve("private"),
                    );
                    recordSearchTiming("manual", 5, {
                        count: 3,
                        query: "never log this",
                        sourceId: "source-1",
                        access: "read",
                        indexKind: "documents",
                        error: "private error",
                    });
                });
            },
            { cacheHit: true },
        );
        const entries = logs.map((line) =>
            JSON.parse(line.replace("[memory-search-timing] ", "")),
        );
        expect(entries.map((entry) => entry.stage)).toEqual([
            "sync",
            "async",
            "manual",
        ]);
        expect(entries.map((entry) => entry.scope)).toEqual([
            "outer",
            "nested",
            "nested",
        ]);
        expect(entries.every((entry) => entry.traceId === "trace-1")).toBe(
            true,
        );
        expect(entries.every((entry) => entry.status === "success")).toBe(true);
        expect(
            entries.every((entry) =>
                Number.isFinite(Date.parse(entry.timestamp)),
            ),
        ).toBe(true);
        expect(entries[0].metadata).toEqual({ cacheHit: true });
        expect(entries[2].metadata).toEqual({
            count: 3,
            sourceId: "source-1",
            access: "read",
            indexKind: "documents",
        });
        expect(logs.join("\n")).not.toContain("private");
        expect(logs.join("\n")).not.toContain("never log this");
        expect(logs.join("\n")).not.toContain("private error");
        expect(currentSearchTraceId()).toBeUndefined();
    });

    test("concurrent requests keep distinct IDs across awaits and nested stages", async () => {
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        const ids = await Promise.all(
            ["a", "b"].map((id) =>
                runWithSearchTiming(id, "request", () =>
                    timeSearchStage("total", async () => {
                        await new Promise((resolve) =>
                            setTimeout(resolve, id === "a" ? 5 : 0),
                        );
                        return runWithSearchTiming(undefined, "nested", () =>
                            currentSearchTraceId(),
                        );
                    }),
                ),
            ),
        );
        expect(ids).toEqual(["a", "b"]);
        expect(logs.some((line) => line.includes('"traceId":"a"'))).toBe(true);
        expect(logs.some((line) => line.includes('"traceId":"b"'))).toBe(true);
    });

    test("sync and async failures retain their error and never log error content", async () => {
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        const error = new Error("secret query source prompt tokens");
        await runWithSearchTiming("errors", "request", async () => {
            expect(() =>
                timeSearchStage("sync", () => {
                    throw error;
                }),
            ).toThrow(error);
            await expect(
                timeSearchStage("async", async () => {
                    throw error;
                }),
            ).rejects.toBe(error);
        });
        expect(logs).toHaveLength(2);
        expect(logs.every((line) => line.includes('"status":"error"'))).toBe(
            true,
        );
        expect(logs.join("\n")).not.toContain(error.message);
    });

    test("returned translation failures are errors without logging their message", async () => {
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        const failure = { success: false, message: "private model response" };
        const result = await runWithSearchTiming("failure", "translator", () =>
            timeSearchStage("translation", () => Promise.resolve(failure)),
        );
        expect(result).toBe(failure);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toContain('"status":"error"');
        expect(logs[0]).not.toContain(failure.message);
    });

    test("a broken diagnostic sink cannot affect the work result or error", async () => {
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        console.warn = () => {
            throw new Error("sink offline");
        };
        const error = new Error("work failed");
        await runWithSearchTiming("sink", "test", async () => {
            expect(timeSearchStage("sync", () => 5)).toBe(5);
            expect(
                await timeSearchStage("async", () => Promise.resolve(6)),
            ).toBe(6);
            await expect(
                timeSearchStage("error", () => Promise.reject(error)),
            ).rejects.toBe(error);
        });
    });
});
