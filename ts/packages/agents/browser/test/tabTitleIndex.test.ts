// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const tryCreateEmbeddingModel = jest.fn(() => ({
    generateEmbedding: jest.fn(),
}));

jest.mock("@typeagent/aiclient", () => ({
    tryCreateEmbeddingModel,
}));
jest.mock("@typeagent/agent-runtime", () => ({
    generateEmbedding: jest.fn(),
    indexesOfNearest: jest.fn(),
    SimilarityType: { Dot: "dot" },
}));

import { createTabTitleIndex } from "../src/agent/tabTitleIndex.mjs";

describe("createTabTitleIndex", () => {
    const embeddingProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    const embeddingModel = process.env.TYPEAGENT_EMBEDDING_MODEL;
    const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT_EMBEDDING;

    afterEach(() => {
        restoreEnv("TYPEAGENT_EMBEDDING_PROVIDER", embeddingProvider);
        restoreEnv("TYPEAGENT_EMBEDDING_MODEL", embeddingModel);
        restoreEnv("AZURE_OPENAI_ENDPOINT_EMBEDDING", azureEndpoint);
    });

    test("uses the configured local embedding provider without Azure settings", async () => {
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "local";
        process.env.TYPEAGENT_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
        delete process.env.AZURE_OPENAI_ENDPOINT_EMBEDDING;

        const index = createTabTitleIndex();

        expect(tryCreateEmbeddingModel).toHaveBeenCalledTimes(1);
        await expect(index.reset()).resolves.toBeUndefined();
    });
});

function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
