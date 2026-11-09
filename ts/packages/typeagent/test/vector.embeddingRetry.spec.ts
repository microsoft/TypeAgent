// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TextEmbeddingModel } from "@typeagent/aiclient";
import { success } from "typechat";
import {
    generateEmbeddingWithRetry,
    generateTextEmbeddingsWithRetry,
} from "../src/vector/vectorIndex.js";

const jest = import.meta.jest;

describe("embedding retry budgets", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test.each(["single", "batch"])(
        "%s allows the provider's 60-second rate-limit wait without a duplicate attempt",
        async (mode) => {
            let calls = 0;
            const generate = async () => {
                calls++;
                await new Promise((resolve) => setTimeout(resolve, 65_000));
                return success([1, 0]);
            };
            const model: TextEmbeddingModel = {
                maxBatchSize: 8,
                generateEmbedding: generate,
                generateEmbeddingBatch: async () => {
                    const result = await generate();
                    return success([result.data]);
                },
            };
            const work =
                mode === "single"
                    ? generateEmbeddingWithRetry(model, "quota", 0, 0)
                    : generateTextEmbeddingsWithRetry(model, ["quota"], 0, 0);
            await jest.advanceTimersByTimeAsync(65_000);
            await expect(work).resolves.toBeDefined();
            expect(calls).toBe(1);
        },
    );

    test("forwards character bounds without turning them into concurrency", async () => {
        const batches: string[][] = [];
        let active = 0;
        let peak = 0;
        const model: TextEmbeddingModel = {
            maxBatchSize: 8,
            generateEmbedding: async () => success([1, 0]),
            generateEmbeddingBatch: async (texts) => {
                batches.push(texts);
                peak = Math.max(peak, ++active);
                await new Promise((resolve) => setTimeout(resolve, 10));
                active--;
                return success(texts.map(() => [1, 0]));
            },
        };
        const work = generateTextEmbeddingsWithRetry(
            model,
            ["aaaa", "bbbb", "cccc"],
            0,
            0,
            8,
        );
        await jest.advanceTimersByTimeAsync(20);
        await expect(work).resolves.toHaveLength(3);
        expect(batches).toEqual([["aaaa", "bbbb"], ["cccc"]]);
        expect(peak).toBe(1);
    });

    test("an explicit short timeout still rejects a hung provider", async () => {
        const model: TextEmbeddingModel = {
            maxBatchSize: 1,
            generateEmbedding: () => new Promise(() => {}),
        };
        const work = generateEmbeddingWithRetry(model, "hung", 0, 0, 25);
        const rejected = expect(work).rejects.toThrow(
            "callWithRetry attempt timed out after 25ms",
        );
        await jest.advanceTimersByTimeAsync(25);
        await rejected;
    });

    test("the default budget remains bounded for a hung provider", async () => {
        const model: TextEmbeddingModel = {
            maxBatchSize: 1,
            generateEmbedding: () => new Promise(() => {}),
        };
        const work = generateEmbeddingWithRetry(model, "hung", 0, 0);
        const rejected = expect(work).rejects.toThrow(
            "callWithRetry attempt timed out after 180000ms",
        );
        await jest.advanceTimersByTimeAsync(180_000);
        await rejected;
    });
});
