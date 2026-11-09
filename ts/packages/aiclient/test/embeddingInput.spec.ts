// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    countEmbeddingTokens,
    embeddingInputLimitError,
    maxEmbeddingInputTokens,
} from "../src/embeddingInput.js";
import { createEmbeddingModel, ModelType } from "../src/openai.js";
import type { AzureApiSettings } from "../src/azureSettings.js";

const atLimit = " word".repeat(8_000);
const aboveLimit = atLimit + " word";
const settings: AzureApiSettings = {
    provider: "azure",
    modelType: ModelType.Embedding,
    apiKey: "test-key",
    endpoint:
        "https://example.openai.azure.com/openai/deployments/ada-002/embeddings",
};

describe("embedding input token ceiling", () => {
    afterEach(() => jest.restoreAllMocks());

    test("measures exact limits and treats special-token spellings as literal text", () => {
        expect(maxEmbeddingInputTokens).toBe(8_000);
        expect(countEmbeddingTokens(atLimit)).toBe(8_000);
        expect(countEmbeddingTokens(aboveLimit)).toBe(8_001);
        expect(embeddingInputLimitError(atLimit)).toBeUndefined();
        expect(embeddingInputLimitError(["short", aboveLimit])).toBe(
            "Embedding input[1] has 8001 tokens; maximum is 8000 (cl100k_base)",
        );
        expect(() => countEmbeddingTokens("<|endoftext|>")).not.toThrow();
    });

    test.each(["single", "batch"])(
        "rejects an oversized %s request before any HTTP/authentication work",
        async (mode) => {
            const fetch = jest
                .spyOn(globalThis, "fetch")
                .mockRejectedValue(new Error("No HTTP request should be made"));
            const model = createEmbeddingModel(settings, 2);
            const result =
                mode === "single"
                    ? await model.generateEmbedding(aboveLimit)
                    : await model.generateEmbeddingBatch!([
                          "short",
                          aboveLimit,
                      ]);
            expect(result).toMatchObject({
                success: false,
                message: expect.stringContaining(
                    "8001 tokens; maximum is 8000",
                ),
            });
            expect(fetch).not.toHaveBeenCalled();
        },
    );

    test.each(["single", "batch"])(
        "sends the unmodified input at the exact ceiling through the %s API",
        async (mode) => {
            const fetch = jest
                .spyOn(globalThis, "fetch")
                .mockResolvedValue(
                    Response.json({ data: [{ embedding: [1, 0] }] }),
                );
            const model = createEmbeddingModel(settings, 2);
            const result =
                mode === "single"
                    ? await model.generateEmbedding(atLimit)
                    : await model.generateEmbeddingBatch!([atLimit]);
            expect(result.success).toBe(true);
            expect(fetch).toHaveBeenCalledTimes(1);
            const body = fetch.mock.calls[0][1]?.body;
            expect(typeof body).toBe("string");
            expect(JSON.parse(String(body)).input).toEqual(
                mode === "single" ? atLimit : [atLimit],
            );
        },
    );
});
