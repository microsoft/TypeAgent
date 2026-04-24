// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { createProgramNameIndex } from "../src/programNameIndex.js";
import { TextEmbeddingModel } from "aiclient";

/** Build a minimal TextEmbeddingModel stub. */
function makeModel(
    fn: (input: string) => Promise<{ success: true; data: number[] }>,
): TextEmbeddingModel {
    return { generateEmbedding: fn, maxBatchSize: 1 } as TextEmbeddingModel;
}

const successModel = makeModel(async () => ({
    success: true,
    data: [1, 0],
}));

describe("createProgramNameIndex", () => {
    test("stores embedding for a new program", async () => {
        let calls = 0;
        const model = makeModel(async () => {
            calls++;
            return { success: true, data: [1, 0] };
        });

        const index = createProgramNameIndex({}, undefined, model);
        await index.addOrUpdate("notepad");

        expect(calls).toBe(1);
        // toJSON returns a base64 string for the stored embedding
        expect(index.toJSON()).toHaveProperty("notepad");
    });

    test("skips model call for already-cached program", async () => {
        let calls = 0;
        const model = makeModel(async () => {
            calls++;
            return { success: true, data: [1, 0] };
        });

        const index = createProgramNameIndex({}, undefined, model);
        await index.addOrUpdate("notepad");
        await index.addOrUpdate("notepad"); // second call: already cached

        expect(calls).toBe(1);
    });

    test("swallows error and does not store entry when model always fails", async () => {
        jest.useFakeTimers();
        const failModel = makeModel(async () => {
            throw new Error("simulated 429");
        });

        const index = createProgramNameIndex({}, undefined, failModel);
        const promise = index.addOrUpdate("chrome");

        // Advance past all retry delays (generateEmbeddingWithRetry defaults: 3 retries, 2500ms each with backoff)
        await jest.runAllTimersAsync();
        await promise;

        expect(index.toJSON()).not.toHaveProperty("chrome");
        jest.useRealTimers();
    });

    test("retries on transient failure and stores embedding on success", async () => {
        jest.useFakeTimers();
        let callCount = 0;
        const transientModel = makeModel(async () => {
            callCount++;
            if (callCount === 1) throw new Error("transient 429");
            return { success: true, data: [0.5, 0.5] };
        });

        const index = createProgramNameIndex({}, undefined, transientModel);
        const promise = index.addOrUpdate("explorer");

        // Advance past the first retry delay
        await jest.runAllTimersAsync();
        await promise;

        expect(callCount).toBeGreaterThanOrEqual(2);
        expect(index.toJSON()).toHaveProperty("explorer");
        jest.useRealTimers();
    });

    test("reset clears all stored embeddings", async () => {
        const index = createProgramNameIndex({}, undefined, successModel);
        await index.addOrUpdate("notepad");
        await index.reset();

        expect(index.toJSON()).toEqual({});
    });
});
