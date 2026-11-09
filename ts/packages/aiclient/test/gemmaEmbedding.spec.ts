// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
    setRuntimeConfig,
    _resetRuntimeConfigForTests,
} from "../src/runtimeConfig.js";
import { configFromEnvRecord } from "../src/apiSettingsFromConfig.js";

const revision = "daa72c51243991dfcaf9f9137d2c573d8f7790c0";
const modelName = "onnx-community/embeddinggemma-2-ONNX";
const vector = Array.from({ length: 768 }, (_, index) => (index === 0 ? 1 : 0));
const tensor = (rows: number[][]) => ({
    dims: [rows.length, rows[0].length],
    tolist: () => rows,
});
const dispose = jest.fn(async () => {});
const infer = jest.fn(async () => ({
    sentence_embedding: tensor([vector]),
}));
const model = Object.assign(infer, { dispose });
const processor = Object.assign(
    jest.fn(
        async (_texts: string[], _images: unknown, ..._args: unknown[]) => ({
            input_ids: tensor([[1, 2]]),
        }),
    ),
    { image_token: "<|image|>" },
);
const config = jest.fn(async (_source: string, _options: unknown) => ({
    model_type: "embedding_gemma2",
    vision_config: {},
    audio_config: {},
}));
const loadModel = jest.fn(async (_source: string, _options: unknown) => model);
const env = {
    version: "4.3.1",
    cacheDir: "original",
    useBrowserCache: true,
    allowRemoteModels: true,
    allowLocalModels: false,
    fetch: globalThis.fetch,
};
jest.unstable_mockModule("@huggingface/transformers", () => ({
    env,
    AutoConfig: { from_pretrained: config },
    AutoProcessor: { from_pretrained: async () => processor },
    AutoModel: { from_pretrained: loadModel },
    RawImage: {
        fromBlob: async () => ({
            rgb: () => ({ width: 1, height: 1, channels: 3 }),
        }),
    },
}));
const { createGemmaEmbeddingModel } = await import("../src/gemmaEmbedding.js");
const { tryCreateEmbeddingModel, getEmbeddingSize } = await import(
    "../src/embeddingProvider.js"
);
const { supportsImageEmbeddings, resolveEmbeddingModel } = await import(
    "../src/models.js"
);

describe("AIClient packaged Gemma runtime (offline injected backend)", () => {
    let cacheDir: string;
    const originalFetch = globalThis.fetch;
    beforeEach(async () => {
        jest.clearAllMocks();
        globalThis.fetch = async () => {
            throw new Error("Network forbidden by test");
        };
        cacheDir = await mkdtemp(path.join(os.tmpdir(), "typeagent-gemma-"));
        const root = path.join(cacheDir, ...modelName.split("/"), revision);
        await mkdir(path.join(root, "onnx"), { recursive: true });
        for (const name of [
            "config.json",
            "processor_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
        ]) {
            await writeFile(path.join(root, name), "{}");
        }
        for (const name of [
            "model.onnx",
            "model.onnx_data",
            "vision_encoder.onnx",
        ]) {
            await writeFile(
                path.join(root, "onnx", name),
                "synthetic injected-backend artifact",
            );
        }
    });
    afterEach(async () => {
        globalThis.fetch = originalFetch;
        _resetRuntimeConfigForTests();
        await rm(cacheDir, { recursive: true, force: true });
    });

    test("configured model exposes image capability before loading and resolves role identities", async () => {
        setRuntimeConfig({
            ...configFromEnvRecord({}),
            embedding: {
                provider: "local",
                runtime: "embeddinggemma",
                modalities: ["text", "image"],
                cacheDir,
            },
        });
        const embedding = tryCreateEmbeddingModel()!;
        expect(getEmbeddingSize()).toBe(768);
        expect(supportsImageEmbeddings(embedding)).toBe(true);
        expect(loadModel).not.toHaveBeenCalled();
        const resolved = await resolveEmbeddingModel(embedding);
        expect(resolved.embeddingIdentity?.model).toBe(modelName);
        expect(resolved.embeddingIdentity?.revision).toBe(revision);
        expect(resolved.forRole!("query").embeddingIdentity?.task).toBe(
            "query",
        );
        expect(await resolved.generateEmbedding("local")).toEqual({
            success: true,
            data: vector,
        });
        expect(config).toHaveBeenCalledWith(
            path.join(cacheDir, ...modelName.split("/"), revision),
            { revision, local_files_only: true },
        );
        expect(env.cacheDir).toBe("original");
        expect(env.allowRemoteModels).toBe(true);
        await resolved.dispose!();
    });

    test("text-only configuration disables vision and rejects images before loading", async () => {
        const embedding = createGemmaEmbeddingModel({
            cacheDir,
            modalities: ["text"],
        });
        expect(supportsImageEmbeddings(embedding)).toBe(false);
        const bytes = Uint8Array.of(1);
        const result = await embedding.generateMediaEmbeddingBatch([
            [
                {
                    type: "image",
                    bytes,
                    mimeType: "image/png",
                    sha256: "0".repeat(64),
                },
            ],
        ]);
        expect(result.success).toBe(false);
        expect(loadModel).not.toHaveBeenCalled();
        await embedding.resolve();
        const call = loadModel.mock.calls[0];
        expect(objectField(call[1], "config")).toMatchObject({
            vision_config: null,
            audio_config: null,
        });
        await embedding.dispose();
    });

    test("native image bytes and ordered mixed parts use the packaged processor", async () => {
        const embedding = createGemmaEmbeddingModel({
            cacheDir,
            modalities: ["text", "image"],
        });
        const bytes = Uint8Array.of(1, 2, 3);
        const result = await embedding
            .forRole("query")
            .generateMediaEmbeddingBatch([
                [
                    { type: "text", text: "arrows " },
                    {
                        type: "image",
                        bytes,
                        mimeType: "image/png",
                        sha256: createHash("sha256")
                            .update(bytes)
                            .digest("hex"),
                    },
                ],
            ]);
        expect(result.success).toBe(true);
        expect(processor.mock.calls[0]?.[0]).toEqual([
            "task: search result | query: arrows <|image|>",
        ]);
        expect(processor.mock.calls[0]?.[1]).toHaveLength(1);
        await embedding.dispose();
    });

    test("missing cached artifacts reject without loading or fetching", async () => {
        await rm(
            path.join(
                cacheDir,
                ...modelName.split("/"),
                revision,
                "onnx",
                "vision_encoder.onnx",
            ),
        );
        const embedding = createGemmaEmbeddingModel({
            cacheDir,
            modalities: ["text", "image"],
        });
        await expect(embedding.resolve()).rejects.toThrow(
            "vision_encoder.onnx",
        );
        expect(loadModel).not.toHaveBeenCalled();
        await embedding.dispose();
    });

    test("malformed output is rejected and disposal is idempotent", async () => {
        const embedding = createGemmaEmbeddingModel({ cacheDir });
        infer.mockResolvedValueOnce({ sentence_embedding: tensor([[0]]) });
        expect((await embedding.generateEmbedding("input")).success).toBe(
            false,
        );
        await embedding.dispose();
        await embedding.dispose();
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(
            (await embedding.generateEmbedding("after dispose")).success,
        ).toBe(false);
    });

    test("queued inputs are immutable snapshots", async () => {
        const embedding = createGemmaEmbeddingModel({
            cacheDir,
            modalities: ["text", "image"],
        });
        const text = { type: "text" as const, text: "original " };
        const bytes = Uint8Array.of(1, 2, 3);
        const image = {
            type: "image" as const,
            bytes,
            mimeType: "image/png",
            sha256: createHash("sha256").update(bytes).digest("hex"),
        };
        const pending = embedding.generateMediaEmbeddingBatch([[text, image]]);
        text.text = "mutated ";
        bytes.fill(0);
        expect((await pending).success).toBe(true);
        expect(processor.mock.calls[0]?.[0]).toEqual([
            "title: none | text: original <|image|>",
        ]);
        await embedding.dispose();
    });

    test("factory rejects incompatible dimensions/runtime/model and unsupported revisions", () => {
        setRuntimeConfig({
            ...configFromEnvRecord({}),
            embedding: {
                provider: "local",
                runtime: "embeddinggemma",
                size: 384,
            },
        });
        expect(() => tryCreateEmbeddingModel()).toThrow("768");
        expect(() => createGemmaEmbeddingModel({ revision: "main" })).toThrow(
            "immutable",
        );
        expect(() =>
            createGemmaEmbeddingModel({ model: "different-model" }),
        ).toThrow("supports only");
    });
});

function objectField(value: unknown, key: string): unknown {
    if (typeof value !== "object" || value === null)
        throw new Error("Invalid test call");
    return Reflect.get(value, key);
}
