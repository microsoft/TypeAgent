// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createCopilotEmbeddingModel,
    DefaultCopilotEmbeddingModel,
} from "../src/copilotEmbedding.js";
import type {
    CopilotModelEndpoint,
    CopilotModelEndpointProvider,
} from "../src/copilotModels.js";
import type { CopilotApiSettings } from "../src/copilotSettings.js";
import { ModelType } from "../src/apiTypes.js";

function settings(): CopilotApiSettings {
    return {
        provider: "copilot",
        modelType: ModelType.Chat,
        endpoint: "copilot-cli",
        modelName: "gpt-5-mini",
        disableInfiniteSessions: true,
        fallbackModels: [],
        timeout: 5_000,
        maxRetryAttempts: 0,
    };
}

function endpoint(baseUrl = "https://capi.example"): CopilotModelEndpoint {
    return {
        baseUrl,
        model: DefaultCopilotEmbeddingModel,
        headers: { Authorization: "Bearer secret" },
    };
}

function endpointProvider(
    endpoints: CopilotModelEndpoint[],
): CopilotModelEndpointProvider & { forceCalls: boolean[] } {
    const forceCalls: boolean[] = [];
    let index = 0;
    return {
        forceCalls,
        async getEndpoint(force = false) {
            forceCalls.push(force);
            if (force) index++;
            return endpoints[Math.min(index, endpoints.length - 1)];
        },
    };
}

function response(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

describe("createCopilotEmbeddingModel", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("posts to CAPI and restores response order", async () => {
        const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
        globalThis.fetch = async (url, init) => {
            fetchCalls.push({ url: url.toString(), init: init ?? {} });
            return response(200, {
                data: [
                    { index: 1, embedding: [3, 4] },
                    { index: 0, embedding: [1, 2] },
                ],
            });
        };
        const provider = endpointProvider([endpoint()]);
        const model = createCopilotEmbeddingModel(
            DefaultCopilotEmbeddingModel,
            settings(),
            provider,
        );

        const result = await model.generateEmbeddingBatch?.(["one", "two"]);

        expect(result).toEqual({
            success: true,
            data: [
                [1, 2],
                [3, 4],
            ],
        });
        expect(fetchCalls).toHaveLength(1);
        const { url, init } = fetchCalls[0];
        expect(url).toBe("https://capi.example/embeddings");
        expect(JSON.parse(init?.body as string)).toEqual({
            input: ["one", "two"],
            model: "text-embedding-3-small",
            encoding_format: "float",
        });
        expect(init?.headers).toMatchObject({
            Authorization: "Bearer secret",
            Accept: "application/json",
            "Content-Type": "application/json",
        });
    });

    test("refreshes the endpoint once after an authorization failure", async () => {
        const fetchCalls: string[] = [];
        globalThis.fetch = async (url) => {
            fetchCalls.push(url.toString());
            return fetchCalls.length === 1
                ? response(401, { error: "expired" })
                : response(200, {
                      data: [{ index: 0, embedding: [1, 2] }],
                  });
        };
        const provider = endpointProvider([
            endpoint("https://old.example"),
            endpoint("https://new.example"),
        ]);
        const model = createCopilotEmbeddingModel(
            DefaultCopilotEmbeddingModel,
            settings(),
            provider,
        );

        const result = await model.generateEmbedding("hello");

        expect(result).toEqual({ success: true, data: [1, 2] });
        expect(provider.forceCalls).toEqual([false, true]);
        expect(fetchCalls[1]).toBe("https://new.example/embeddings");
    });

    test("rejects incomplete response indexes", async () => {
        globalThis.fetch = async () =>
            response(200, {
                data: [
                    { index: 0, embedding: [1, 2] },
                    { index: 0, embedding: [3, 4] },
                ],
            });
        const model = createCopilotEmbeddingModel(
            DefaultCopilotEmbeddingModel,
            settings(),
            endpointProvider([endpoint()]),
        );

        const result = await model.generateEmbeddingBatch?.(["one", "two"]);

        expect(result).toEqual({
            success: false,
            message: "Copilot embeddings response has an invalid data entry",
        });
    });

    test("rejects batches larger than the CAPI limit", async () => {
        let fetchCount = 0;
        globalThis.fetch = async () => {
            fetchCount++;
            return response(200, { data: [] });
        };
        const model = createCopilotEmbeddingModel(
            DefaultCopilotEmbeddingModel,
            settings(),
            endpointProvider([endpoint()]),
        );

        const result = await model.generateEmbeddingBatch?.(
            Array.from({ length: 65 }, (_, index) => `text-${index}`),
        );

        expect(result).toEqual({
            success: false,
            message: "Batch size must be <= 64",
        });
        expect(fetchCount).toBe(0);
    });
});
