// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    mkdir,
    mkdtemp,
    readFile,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TextEmbeddingModel } from "../src/models.js";

const modelName = "Xenova/all-MiniLM-L6-v2";
const revision = "751bff37182d3f1213fa05d7196b954e230abad9";
const vector = Array.from({ length: 384 }, (_, i) => Number(i === 0));
const dispose = jest.fn(async () => {});
const infer = jest.fn(async (input: string | string[], _options?: unknown) => ({
    tolist: () => (Array.isArray(input) ? input : [input]).map(() => vector),
}));
const extractor = Object.assign(infer, { dispose });
const pipeline = jest.fn(
    async (_task: string, _source: string, _options: unknown) => extractor,
);
const env = {
    cacheDir: "original",
    allowRemoteModels: true,
    allowLocalModels: false,
    fetch: globalThis.fetch,
};
const originalFetch = env.fetch;
jest.unstable_mockModule("@huggingface/transformers", () => ({
    env,
    pipeline,
}));
const { createLocalEmbeddingModel } = await import("../src/localEmbedding.js");

describe("MiniLM on the shared Transformers.js 4.3.1 runtime", () => {
    let cacheDir: string;
    let snapshot: string;
    let model: TextEmbeddingModel | undefined;
    beforeEach(async () => {
        jest.clearAllMocks();
        cacheDir = await mkdtemp(path.join(os.tmpdir(), "typeagent-minilm-"));
        snapshot = path.join(cacheDir, ...modelName.split("/"), revision);
        await mkdir(path.join(snapshot, "onnx"), { recursive: true });
        for (const file of [
            "config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            path.join("onnx", "model.onnx"),
        ]) {
            await writeFile(path.join(snapshot, file), "{}");
        }
    });
    afterEach(async () => {
        await model?.dispose?.();
        model = undefined;
        await rm(cacheDir, { recursive: true, force: true });
    });

    test("loads a pinned absolute offline snapshot with CPU FP32 and restores shared runtime settings", async () => {
        pipeline.mockImplementationOnce(async () => {
            expect(env.allowRemoteModels).toBe(false);
            expect(env.allowLocalModels).toBe(true);
            await expect(env.fetch("https://offline.invalid")).rejects.toThrow(
                "Offline MiniLM loading forbids runtime fetch",
            );
            return extractor;
        });
        model = createLocalEmbeddingModel({
            cacheDir,
            revision,
            localFilesOnly: true,
        });
        expect(pipeline).not.toHaveBeenCalled();
        expect(await model.generateEmbedding("marine")).toEqual({
            success: true,
            data: vector,
        });
        expect(pipeline).toHaveBeenCalledWith("feature-extraction", snapshot, {
            revision,
            local_files_only: true,
            device: "cpu",
            dtype: "fp32",
        });
        expect(infer).toHaveBeenCalledWith(["marine"], {
            pooling: "mean",
            normalize: true,
        });
        expect(env).toEqual({
            cacheDir: "original",
            allowRemoteModels: true,
            allowLocalModels: false,
            fetch: originalFetch,
        });
        expect(model.embeddingIdentity?.preprocessing).toContain(
            "Transformers.js 4.3.1",
        );
        await model.dispose!();
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    test("continues to accept an unversioned legacy cache for main only", async () => {
        const modelDir = path.dirname(snapshot);
        for (const file of [
            "config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "onnx",
        ]) {
            await rename(path.join(snapshot, file), path.join(modelDir, file));
        }
        model = createLocalEmbeddingModel({ cacheDir, localFilesOnly: true });
        expect((await model.generateEmbedding("legacy")).success).toBe(true);
        expect(pipeline.mock.calls[0][1]).toBe(modelDir);
    });

    test("does not silently substitute another revision for an incomplete pinned snapshot", async () => {
        await rm(path.join(snapshot, "onnx", "model.onnx"));
        model = createLocalEmbeddingModel({
            cacheDir,
            revision,
            localFilesOnly: true,
        });
        await expect(model.resolve!()).rejects.toThrow(
            "Offline MiniLM cache is incomplete",
        );
        expect(pipeline).not.toHaveBeenCalled();
    });

    test("preserves staged offline artifacts after a native loading failure and permits retry", async () => {
        pipeline.mockRejectedValueOnce(
            new Error(`Load model from ${snapshot} failed`),
        );
        model = createLocalEmbeddingModel({
            cacheDir,
            revision,
            localFilesOnly: true,
        });
        expect((await model.generateEmbedding("first")).success).toBe(false);
        expect(env.fetch).toBe(originalFetch);
        expect(await readFile(path.join(snapshot, "config.json"), "utf8")).toBe(
            "{}",
        );
        expect((await model.generateEmbedding("retry")).success).toBe(true);
        expect(pipeline).toHaveBeenCalledTimes(2);
    });

    test("keeps download-enabled model-ID loading explicit and uses the same FP32 policy", async () => {
        model = createLocalEmbeddingModel({
            cacheDir,
            revision,
            localFilesOnly: false,
        });
        expect((await model.generateEmbedding("model ID")).success).toBe(true);
        expect(pipeline).toHaveBeenCalledWith("feature-extraction", modelName, {
            revision,
            local_files_only: false,
            device: "cpu",
            dtype: "fp32",
        });
    });

    test("rejects revisions outside the selected model cache", async () => {
        model = createLocalEmbeddingModel({
            cacheDir,
            revision: "..",
            localFilesOnly: true,
        });
        await expect(model.resolve!()).rejects.toThrow(
            "MiniLM revision must resolve inside its model cache",
        );
        expect(pipeline).not.toHaveBeenCalled();
    });
});
