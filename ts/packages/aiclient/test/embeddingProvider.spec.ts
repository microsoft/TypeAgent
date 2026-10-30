// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { configFromEnvRecord } from "../src/index.js";
import {
    setRuntimeConfig,
    _resetRuntimeConfigForTests,
} from "../src/runtimeConfig.js";
import {
    getEmbeddingProvider,
    getEmbeddingSize,
    tryCreateEmbeddingModel,
} from "../src/embeddingProvider.js";
import type { EmbeddingModelDefinition } from "@typeagent/config";
import { supportsImageEmbeddings } from "../src/models.js";
import { createEmbeddingModel, ModelType } from "../src/openai.js";
import { embeddingIdentityKey } from "../src/embeddingIdentity.js";

describe("embedding provider selection reaches real construction (offline)", () => {
    const originalEnv = process.env;
    const originalFetch = globalThis.fetch;
    const endpoints = {
        TYPEAGENT_EMBEDDING_SIZE: "2",
        OPENAI_API_KEY: "synthetic-openai-key",
        OPENAI_ENDPOINT_EMBEDDING: "https://openai.invalid/embeddings",
        OPENAI_MODEL_EMBEDDING: "synthetic-model",
        AZURE_OPENAI_ENDPOINT_EMBEDDING: "https://azure.invalid/embeddings",
        AZURE_OPENAI_API_KEY_EMBEDDING: "synthetic-azure-key",
        AZURE_OPENAI_ENDPOINT_EMBEDDING_NAMED_EASTUS:
            "https://named.invalid/embeddings",
        AZURE_OPENAI_API_KEY_EMBEDDING_NAMED_EASTUS: "synthetic-named-key",
    };
    let calls: string[];
    let bodies: Record<string, unknown>[];
    beforeEach(() => {
        process.env = { ...endpoints };
        calls = [];
        bodies = [];
        globalThis.fetch = async (url, init) => {
            calls.push(String(url));
            if (typeof init?.body === "string")
                bodies.push(JSON.parse(init.body));
            return new Response(
                JSON.stringify({ data: [{ embedding: [1, 0] }] }),
                {
                    status: 200,
                    headers: { "content-type": "application/json" },
                },
            );
        };
    });
    afterEach(() => {
        process.env = originalEnv;
        globalThis.fetch = originalFetch;
        _resetRuntimeConfigForTests();
    });

    test.each(["azure", "openai"] as const)(
        "explicit %s wins with mixed credentials",
        async (provider) => {
            setRuntimeConfig({
                ...configFromEnvRecord(endpoints),
                embedding: { provider, size: 2 },
            });
            const model = tryCreateEmbeddingModel()!;
            expect(calls).toEqual([]);
            expect((await model.generateEmbedding("offline")).success).toBe(
                true,
            );
            expect(calls).toEqual([
                endpoints[
                    provider === "azure"
                        ? "AZURE_OPENAI_ENDPOINT_EMBEDDING"
                        : "OPENAI_ENDPOINT_EMBEDDING"
                ],
            ]);
        },
    );

    test("inferred Azure ignores an unrelated OpenAI key without embedding endpoint", async () => {
        delete process.env.OPENAI_ENDPOINT_EMBEDDING;
        setRuntimeConfig(
            configFromEnvRecord({ ...process.env } as Record<string, string>),
        );
        expect(getEmbeddingProvider()).toBe("azure");
        expect(
            (await tryCreateEmbeddingModel()!.generateEmbedding("offline"))
                .success,
        ).toBe(true);
        expect(calls).toEqual([endpoints.AZURE_OPENAI_ENDPOINT_EMBEDDING]);
    });

    test("explicit none constructs nothing, even with credentials", () => {
        setRuntimeConfig({
            ...configFromEnvRecord(endpoints),
            embedding: { provider: "none" },
        });
        expect(tryCreateEmbeddingModel()).toBeUndefined();
        expect(calls).toEqual([]);
    });

    test("provider forwarding preserves named endpoint pools and old overloads", async () => {
        setRuntimeConfig({
            ...configFromEnvRecord(endpoints),
            embedding: { provider: "azure", size: 2 },
        });
        expect(
            (
                await tryCreateEmbeddingModel(
                    "embedding_named",
                )!.generateEmbedding("offline")
            ).success,
        ).toBe(true);
        expect(calls[0]).toBe(
            endpoints.AZURE_OPENAI_ENDPOINT_EMBEDDING_NAMED_EASTUS,
        );
        const custom = createEmbeddingModel(
            {
                provider: "openai",
                endpoint: "https://custom.invalid/embeddings",
                apiKey: "synthetic",
                modelType: ModelType.Embedding,
                modelName: "custom",
            },
            2,
        );
        expect((await custom.generateEmbedding("offline")).success).toBe(true);
        expect(calls[1]).toBe("https://custom.invalid/embeddings");
    });

    test("misconfigured chosen provider fails explicitly without hosted fallback", () => {
        process.env = { OPENAI_API_KEY: "synthetic" };
        setRuntimeConfig({
            ...configFromEnvRecord({ OPENAI_API_KEY: "synthetic" }),
            embedding: { provider: "azure" },
        });
        expect(() => tryCreateEmbeddingModel()).toThrow();
        expect(calls).toEqual([]);
    });

    test("same-sized hosted model and revision switches change identity without I/O", () => {
        const configured = (model: string, revision: string) => {
            setRuntimeConfig({
                ...configFromEnvRecord(endpoints),
                embedding: { provider: "azure", model, revision, size: 2 },
            });
            return tryCreateEmbeddingModel()!;
        };
        const first = configured("model-a", "version-1");
        const second = configured("model-b", "version-1");
        const revised = configured("model-a", "version-2");
        expect(embeddingIdentityKey(first.embeddingIdentity!)).not.toBe(
            embeddingIdentityKey(second.embeddingIdentity!),
        );
        expect(embeddingIdentityKey(first.embeddingIdentity!)).not.toBe(
            embeddingIdentityKey(revised.embeddingIdentity!),
        );
        expect(calls).toEqual([]);
    });

    function configureNamed(
        alias: string,
        definitions: Record<string, EmbeddingModelDefinition>,
    ): void {
        setRuntimeConfig({
            ...configFromEnvRecord(endpoints),
            embedding: undefined,
            defaultEmbeddingModel: alias,
            embeddingModels: definitions,
        });
    }

    const hostedProfile: EmbeddingModelDefinition = {
        provider: "azure",
        deployment: "embedding_named",
        model: "synthetic-hosted",
        size: 2,
        modalities: ["text"],
    };

    test("named Azure profile selects its deployment and validates dimensions without requesting reduction", async () => {
        configureNamed("hosted", { hosted: hostedProfile });
        expect(getEmbeddingProvider()).toBe("azure");
        expect(getEmbeddingSize()).toBe(2);
        const model = tryCreateEmbeddingModel()!;
        expect(calls).toEqual([]);
        expect((await model.generateEmbedding("named profile")).success).toBe(
            true,
        );
        expect(calls).toEqual([
            endpoints.AZURE_OPENAI_ENDPOINT_EMBEDDING_NAMED_EASTUS,
        ]);
        expect(bodies).toHaveLength(1);
        expect(bodies[0]).not.toHaveProperty("dimensions");
        expect(model.embeddingIdentity?.model).toBe("synthetic-hosted");
        expect(model.embeddingIdentity?.dimensions).toBe(2);
    });

    test("catalog alias renaming preserves identity and a changed binding does not", () => {
        configureNamed("before", { before: hostedProfile });
        const before = tryCreateEmbeddingModel()!.embeddingIdentity!;
        configureNamed("renamed", { renamed: hostedProfile });
        expect(
            embeddingIdentityKey(tryCreateEmbeddingModel()!.embeddingIdentity!),
        ).toBe(embeddingIdentityKey(before));
        configureNamed("renamed", {
            renamed: { ...hostedProfile, model: "different-model" },
        });
        expect(
            embeddingIdentityKey(tryCreateEmbeddingModel()!.embeddingIdentity!),
        ).not.toBe(embeddingIdentityKey(before));
        expect(calls).toEqual([]);
    });

    test.each(["azure", "openai"] as const)(
        "named %s embedding-3 profile requests 1536 dimensions for single and batch inputs",
        async (provider) => {
            globalThis.fetch = async (url, init) => {
                calls.push(String(url));
                const body = JSON.parse(String(init?.body));
                bodies.push(body);
                const inputs = Array.isArray(body.input)
                    ? body.input
                    : [body.input];
                return new Response(
                    JSON.stringify({
                        data: inputs.map(() => ({
                            embedding: [1, ...Array<number>(1535).fill(0)],
                        })),
                    }),
                    { status: 200 },
                );
            };
            configureNamed("large", {
                large: {
                    provider,
                    ...(provider === "azure"
                        ? { deployment: "embedding_named" }
                        : {}),
                    model: "text-embedding-3-large",
                    size: 1536,
                    modalities: ["text"],
                },
            });
            const model = tryCreateEmbeddingModel()!;
            const single = await model.generateEmbedding("single");
            const batch = await model.generateEmbeddingBatch!(["one", "two"]);
            expect(single.success && single.data).toHaveLength(1536);
            expect(batch.success && batch.data).toHaveLength(2);
            expect(bodies.map((body) => body.dimensions)).toEqual([1536, 1536]);
            expect(model.embeddingIdentity?.model).toBe(
                "text-embedding-3-large",
            );
            expect(model.embeddingIdentity?.dimensions).toBe(1536);
            expect(calls).toEqual([
                provider === "azure"
                    ? endpoints.AZURE_OPENAI_ENDPOINT_EMBEDDING_NAMED_EASTUS
                    : endpoints.OPENAI_ENDPOINT_EMBEDDING,
                provider === "azure"
                    ? endpoints.AZURE_OPENAI_ENDPOINT_EMBEDDING_NAMED_EASTUS
                    : endpoints.OPENAI_ENDPOINT_EMBEDDING,
            ]);
        },
    );

    test.each(["text-embedding-3-small", "text-embedding-3-large"])(
        "named %s requests its configured size and rejects a different output size",
        async (model) => {
            configureNamed("reduced", {
                reduced: { ...hostedProfile, model, size: 1536 },
            });
            const result = await tryCreateEmbeddingModel()!.generateEmbedding(
                "wrong-sized response",
            );
            expect(bodies[0].dimensions).toBe(1536);
            expect(result.success).toBe(false);
        },
    );

    test("named Ada profile does not request unsupported dimension reduction", async () => {
        configureNamed("ada", {
            ada: { ...hostedProfile, model: "text-embedding-ada-002" },
        });
        await tryCreateEmbeddingModel()!.generateEmbedding("Ada");
        expect(bodies[0]).not.toHaveProperty("dimensions");
    });

    test("a catalog profile can retain the legacy Azure default transport and identity", () => {
        setRuntimeConfig({
            ...configFromEnvRecord(endpoints),
            embedding: { provider: "azure", size: 2 },
        });
        const before = tryCreateEmbeddingModel()!.embeddingIdentity!;
        configureNamed("current", {
            current: {
                provider: "azure",
                model: before.model,
                size: before.dimensions,
                modalities: ["text"],
            },
        });
        expect(
            embeddingIdentityKey(tryCreateEmbeddingModel()!.embeddingIdentity!),
        ).toBe(embeddingIdentityKey(before));
        expect(calls).toEqual([]);
    });

    test("named dimensions and deployment cannot be overridden independently", () => {
        configureNamed("hosted", { hosted: hostedProfile });
        expect(() => tryCreateEmbeddingModel(undefined, 3)).toThrow(
            "dimensions cannot be overridden",
        );
        expect(() => tryCreateEmbeddingModel("another-route")).toThrow(
            "deployment cannot be overridden",
        );
        expect(calls).toEqual([]);
    });

    test("only the selected local profile controls dimensions and enabled modalities without loading weights", async () => {
        const definitions: Record<string, EmbeddingModelDefinition> = {
            minilm: {
                provider: "local",
                runtime: "minilm",
                model: "Xenova/all-MiniLM-L6-v2",
                revision: "751bff37182d3f1213fa05d7196b954e230abad9",
                size: 384,
                modalities: ["text"],
                localFilesOnly: true,
            },
            gemma: {
                provider: "local",
                runtime: "embeddinggemma",
                model: "onnx-community/embeddinggemma-2-ONNX",
                revision: "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
                size: 768,
                modalities: ["text", "image"],
                localFilesOnly: true,
            },
        };
        configureNamed("minilm", definitions);
        const minilm = tryCreateEmbeddingModel()!;
        expect(getEmbeddingSize()).toBe(384);
        expect(supportsImageEmbeddings(minilm)).toBe(false);
        await minilm.dispose?.();
        configureNamed("gemma", definitions);
        const gemma = tryCreateEmbeddingModel()!;
        expect(getEmbeddingSize()).toBe(768);
        expect(supportsImageEmbeddings(gemma)).toBe(true);
        await gemma.dispose?.();
        expect(calls).toEqual([]);
    });

    test("a named disabled selector never falls back to hosted credentials", () => {
        configureNamed("none", { hosted: hostedProfile });
        expect(getEmbeddingProvider()).toBe("none");
        expect(tryCreateEmbeddingModel()).toBeUndefined();
        expect(calls).toEqual([]);
    });
});
