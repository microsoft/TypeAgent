// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IndexWarmupScheduler,
    type IndexWarmupJob,
} from "../src/indexWarmup.js";

const jest = import.meta.jest;

describe("completion-paced index warmup", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(0);
    });
    afterEach(() => jest.useRealTimers());

    test("startup waits five seconds and later loads wait five seconds after completion", async () => {
        const starts: number[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const jobs: IndexWarmupJob[] = ["a", "b"].map((key) => ({
            key,
            corpusId: "corpus",
            run: async () => {
                starts.push(Date.now());
                if (key === "a") await gate;
                return true;
            },
        }));
        const errors = jest.fn();
        const scheduler = new IndexWarmupScheduler(async () => jobs, errors);
        scheduler.start();
        scheduler.start();
        await jest.advanceTimersByTimeAsync(4_999);
        expect(starts).toEqual([]);
        await jest.advanceTimersByTimeAsync(1);
        expect(starts).toEqual([5_000]);
        await jest.advanceTimersByTimeAsync(20_000);
        expect(starts).toHaveLength(1);
        release();
        await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(4_999);
        expect(starts).toHaveLength(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(starts).toEqual([5_000, 30_000]);
        expect(errors).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
        await scheduler.close();
    });

    test("collection open is immediate and takes priority without overlapping an active load", async () => {
        const starts: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const jobs: IndexWarmupJob[] = ["a", "b", "c"].map((key) => ({
            key,
            corpusId: key === "c" ? "selected" : "other",
            run: async () => {
                starts.push(key);
                if (key === "a") await gate;
                return true;
            },
        }));
        const scheduler = new IndexWarmupScheduler(
            async (corpusId) =>
                jobs.filter((job) => !corpusId || job.corpusId === corpusId),
            (error) => {
                throw error;
            },
        );
        scheduler.start();
        await jest.advanceTimersByTimeAsync(5_000);
        scheduler.open("other");
        scheduler.open("selected");
        scheduler.open("selected");
        await jest.advanceTimersByTimeAsync(0);
        expect(starts).toEqual(["a"]);
        release();
        await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(5_000);
        expect(starts).toEqual(["a", "c"]);
        await scheduler.close();
        expect(jest.getTimerCount()).toBe(0);
    });

    test("opening a collection before startup deadline warms it immediately", async () => {
        const run = jest.fn(async () => true);
        const scheduler = new IndexWarmupScheduler(
            async () => [{ key: "a", corpusId: "selected", run }],
            (error) => {
                throw error;
            },
        );
        scheduler.start();
        scheduler.open("selected");
        await jest.advanceTimersByTimeAsync(0);
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(true);
        await jest.advanceTimersByTimeAsync(5_000);
        expect(run).toHaveBeenCalledTimes(1);
        await scheduler.close();
    });

    test("invalidation discards discoveries that were already in flight", async () => {
        const run = jest.fn(async () => true);
        let release!: (jobs: IndexWarmupJob[]) => void;
        const discovery = new Promise<IndexWarmupJob[]>((resolve) => {
            release = resolve;
        });
        const scheduler = new IndexWarmupScheduler(
            async () => discovery,
            jest.fn(),
        );
        scheduler.start();
        await jest.advanceTimersByTimeAsync(5_000);
        scheduler.invalidate("corpus");
        release([{ key: "forgotten", corpusId: "corpus", run }]);
        await jest.advanceTimersByTimeAsync(0);
        expect(run).not.toHaveBeenCalled();
        await scheduler.close();
        expect(jest.getTimerCount()).toBe(0);
    });

    test("failures are reported once and shutdown cancels the startup timer", async () => {
        const errors = jest.fn();
        const run = jest.fn(async () => {
            throw new Error("corrupt index");
        });
        const scheduler = new IndexWarmupScheduler(
            async () => [{ key: "a", corpusId: "corpus", run }],
            errors,
        );
        scheduler.start();
        await jest.advanceTimersByTimeAsync(5_000);
        expect(errors).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(60_000);
        expect(run).toHaveBeenCalledTimes(1);
        await scheduler.close();
        const stopped = new IndexWarmupScheduler(async () => [], errors);
        stopped.start();
        await stopped.close();
        await jest.advanceTimersByTimeAsync(5_000);
        expect(jest.getTimerCount()).toBe(0);
    });
});
