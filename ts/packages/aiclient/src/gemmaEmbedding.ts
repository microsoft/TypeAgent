// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    CandidateAdapter,
    createAdapterEmbeddingModel,
    LazyCandidateEmbeddingModel,
} from "./candidateEmbedding.js";
import { EmbeddingPart, EmbeddingRole } from "./embeddingIdentity.js";

export const DefaultGemmaEmbeddingModel =
    "onnx-community/embeddinggemma-2-ONNX";
export const DefaultGemmaEmbeddingRevision =
    "daa72c51243991dfcaf9f9137d2c573d8f7790c0";
export const GemmaEmbeddingDimensions = 768;
const prompts = {
    query: "task: search result | query: ",
    document: "title: none | text: ",
};
const preprocessing =
    "Pinned EmbeddingGemma2Processor; RGB decoded pixels; ordered image placeholders; padding; no truncation; role prefix only when text is present";
const digest = (bytes: string | Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

export interface GemmaEmbeddingSettings {
    model?: string | undefined;
    revision?: string | undefined;
    cacheDir?: string | undefined;
    modalities?: readonly ("text" | "image")[] | undefined;
    localFilesOnly?: boolean | undefined;
    maxBatchSize?: number | undefined;
    maxPending?: number | undefined;
}

type Runtime = typeof import("@huggingface/transformers");
let initialization = Promise.resolve();

function objectValue(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object") {
        throw new Error("Invalid Gemma runtime output");
    }
    return value as Record<string, unknown>;
}

function tensorDimensions(value: unknown): number[] {
    const dims = objectValue(value).dims;
    assert.ok(
        Array.isArray(dims) &&
            dims.every((dim) => Number.isSafeInteger(dim) && dim > 0),
        "Invalid Gemma tensor dimensions",
    );
    return dims;
}

function tensorRows(value: unknown): number[][] {
    const tensor = objectValue(value);
    assert.equal(typeof tensor.tolist, "function");
    const rows: unknown = Reflect.apply(
        tensor.tolist as (...args: never[]) => unknown,
        value,
        [],
    );
    assert.ok(Array.isArray(rows), "Invalid Gemma tensor rows");
    return rows.map((row: unknown) => {
        assert.ok(Array.isArray(row), "Invalid Gemma tensor row");
        return row.map((item: unknown) => {
            assert.ok(
                typeof item === "number" || typeof item === "bigint",
                "Invalid Gemma tensor value",
            );
            const number = Number(item);
            assert.ok(Number.isFinite(number), "Nonfinite Gemma tensor value");
            return number;
        });
    });
}

export async function inventoryGemmaArtifacts(
    cacheDir: string,
    revision: string,
    vision: boolean,
): Promise<{ path: string; sha256: string }[]> {
    const snapshot = path.join(
        cacheDir,
        ...DefaultGemmaEmbeddingModel.split("/"),
        revision,
    );
    const artifacts: { path: string; sha256: string }[] = [];
    async function visit(directory: string): Promise<void> {
        for (const entry of await fs.readdir(directory, {
            withFileTypes: true,
        })) {
            assert.ok(
                !entry.isSymbolicLink(),
                "Gemma artifact symlinks are unsupported",
            );
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(target);
            else if (entry.isFile()) {
                const hash = createHash("sha256");
                for await (const bytes of createReadStream(target))
                    hash.update(bytes);
                artifacts.push({
                    path: path
                        .relative(cacheDir, target)
                        .split(path.sep)
                        .join("/"),
                    sha256: hash.digest("hex"),
                });
            }
        }
    }
    await visit(snapshot);
    const required = [
        "config.json",
        "processor_config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "model.onnx",
        "model.onnx_data",
        ...(vision ? ["vision_encoder.onnx"] : []),
    ];
    for (const filename of required) {
        assert.ok(
            artifacts.some((item) => item.path.endsWith("/" + filename)),
            `Missing pinned Gemma artifact ${filename}; stage the configured cache or explicitly allow downloads`,
        );
    }
    return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

function snapshotSamples(samples: EmbeddingPart[][]): EmbeddingPart[][] {
    let budget = 32 * 1024 * 1024;
    return samples.map((parts) => {
        assert.ok(
            parts.length > 0 && parts.length <= 16,
            "Invalid ordered media parts",
        );
        return parts.map((part): EmbeddingPart => {
            if (part.type === "text") {
                assert.ok(
                    part.text.length > 0 && part.text.length <= 131072,
                    "Invalid Gemma text length",
                );
                assert.ok(
                    !/<\|(?:image|audio|video)(?:\|)?>|<(?:image|audio|video)\|>|<\|(?:image_start|image_end|audio_start|audio_end)\|>/.test(
                        part.text,
                    ),
                    "Use ordered image parts, not authored media placeholders",
                );
                budget -= Buffer.byteLength(part.text);
                assert.ok(budget >= 0, "Gemma media batch exceeds 32 MiB");
                return { type: "text", text: part.text };
            }
            assert.equal(part.type, "image", "Unsupported Gemma modality");
            assert.ok(
                part.bytes instanceof Uint8Array &&
                    part.bytes.length > 0 &&
                    part.bytes.length <= 16 * 1024 * 1024,
                "Invalid image byte length",
            );
            assert.ok(
                ["image/png", "image/jpeg", "image/webp"].includes(
                    part.mimeType,
                ),
                "Unsupported image MIME type",
            );
            const bytes = Uint8Array.from(part.bytes);
            assert.match(part.sha256, /^[a-f0-9]{64}$/);
            assert.equal(digest(bytes), part.sha256, "Image SHA256 mismatch");
            budget -= bytes.length;
            assert.ok(budget >= 0, "Gemma media batch exceeds 32 MiB");
            return { ...part, bytes };
        });
    });
}

async function loadAdapter(
    runtime: Runtime,
    settings: GemmaEmbeddingSettings,
): Promise<CandidateAdapter> {
    const revision = settings.revision ?? DefaultGemmaEmbeddingRevision;
    const cacheDir = path.resolve(
        settings.cacheDir ??
            path.join(os.homedir(), ".cache", "typeagent", "embeddinggemma"),
    );
    const vision = settings.modalities?.includes("image") ?? false;
    const offline = settings.localFilesOnly ?? true;
    let artifacts = offline
        ? await inventoryGemmaArtifacts(cacheDir, revision, vision)
        : undefined;
    assert.equal(
        runtime.env.version,
        "4.3.1",
        "Unexpected Gemma runtime version",
    );
    const old = {
        cacheDir: runtime.env.cacheDir,
        useBrowserCache: runtime.env.useBrowserCache,
        allowRemoteModels: runtime.env.allowRemoteModels,
        allowLocalModels: runtime.env.allowLocalModels,
        fetch: runtime.env.fetch,
    };
    Object.assign(runtime.env, { cacheDir, useBrowserCache: false });
    if (offline) {
        Object.assign(runtime.env, {
            allowRemoteModels: false,
            allowLocalModels: true,
            fetch: async () => {
                throw new Error("Offline Gemma loading forbids runtime fetch");
            },
        });
    }
    let model:
        | Awaited<ReturnType<Runtime["AutoModel"]["from_pretrained"]>>
        | undefined;
    try {
        // Loading by snapshot avoids tokenizer discovery's unpinned metadata request.
        const source = offline
            ? path.join(
                  cacheDir,
                  ...DefaultGemmaEmbeddingModel.split("/"),
                  revision,
              )
            : DefaultGemmaEmbeddingModel;
        const options = { revision, local_files_only: offline };
        const config = await runtime.AutoConfig.from_pretrained(
            source,
            options,
        );
        assert.equal(config.model_type, "embedding_gemma2");
        if (vision)
            assert.ok(
                Reflect.get(config, "vision_config"),
                "Checkpoint lacks vision configuration",
            );
        Object.assign(config, {
            audio_config: null,
            ...(!vision ? { vision_config: null } : {}),
        });
        const processor = await runtime.AutoProcessor.from_pretrained(
            source,
            options,
        );
        const imageToken: unknown = Reflect.get(processor, "image_token");
        if (vision)
            assert.equal(
                imageToken,
                "<|image|>",
                "Unexpected image placeholder",
            );
        model = await runtime.AutoModel.from_pretrained(source, {
            ...options,
            config,
            device: "cpu",
            dtype: "fp32",
        });
        artifacts ??= await inventoryGemmaArtifacts(cacheDir, revision, vision);
        const loadedModel = model;
        const artifactHash = digest(
            JSON.stringify(
                Object.fromEntries(
                    [...artifacts]
                        .sort((left, right) =>
                            left.path < right.path
                                ? -1
                                : left.path > right.path
                                  ? 1
                                  : 0,
                        )
                        .map((item) => [item.path, item.sha256]),
                ),
            ),
        );
        const embedMedia = async (
            input: EmbeddingPart[][],
            role: EmbeddingRole,
        ) => {
            const samples = snapshotSamples(input);
            const texts: string[] = [];
            const images: InstanceType<Runtime["RawImage"]>[][] = [];
            for (const parts of samples) {
                let text = parts.some((part) => part.type === "text")
                    ? prompts[role]
                    : "";
                const decoded: InstanceType<Runtime["RawImage"]>[] = [];
                for (const part of parts) {
                    if (part.type === "text") text += part.text;
                    else {
                        assert.ok(
                            vision,
                            "Image embeddings disabled by configuration",
                        );
                        const image = (
                            await runtime.RawImage.fromBlob(
                                new Blob([part.bytes], { type: part.mimeType }),
                            )
                        ).rgb();
                        assert.ok(
                            image.width > 0 &&
                                image.height > 0 &&
                                image.width * image.height <= 16000000 &&
                                image.channels === 3,
                            "Invalid or oversized decoded image",
                        );
                        decoded.push(image);
                        text += imageToken;
                    }
                }
                texts.push(text);
                images.push(decoded);
            }
            const inputs = objectValue(
                await processor(
                    texts,
                    images.some((items) => items.length) ? images : null,
                    null,
                    null,
                    { padding: true, truncation: false },
                ),
            );
            const dims = tensorDimensions(inputs.input_ids);
            assert.ok(
                dims.length === 2 &&
                    dims[0] === samples.length &&
                    dims[1] <= 8192,
                "Expanded Gemma input exceeds token limit or has invalid cardinality",
            );
            const result = objectValue(await loadedModel(inputs));
            assert.deepEqual(tensorDimensions(result.sentence_embedding), [
                samples.length,
                GemmaEmbeddingDimensions,
            ]);
            return tensorRows(result.sentence_embedding).map((row) => {
                const norm = Math.hypot(...row);
                assert.ok(
                    Number.isFinite(norm) && norm > 0,
                    "Invalid Gemma vector norm",
                );
                return Array.from(
                    Float32Array.from(row, (value) => value / norm),
                );
            });
        };
        return {
            descriptor: {
                provider: "local",
                model: DefaultGemmaEmbeddingModel,
                revision,
                dimensions: GemmaEmbeddingDimensions,
                query_prompt: prompts.query,
                document_prompt: prompts.document,
                pooling: "model mean pooling",
                normalization: "l2",
                preprocessing: vision
                    ? preprocessing
                    : preprocessing + "; vision-disabled",
                artifact_sha256: artifactHash,
            },
            artifacts,
            metadata: {
                runtime: "Transformers.js 4.3.1; CPU FP32",
                localFilesOnly: offline,
                vision,
            },
            embedMedia,
            embed: (texts, role) =>
                embedMedia(
                    texts.map((text) => [{ type: "text", text }]),
                    role,
                ),
            dispose: async () => {
                await loadedModel.dispose();
            },
        };
    } catch (cause) {
        await model?.dispose();
        throw cause;
    } finally {
        Object.assign(runtime.env, old);
    }
}

export function createGemmaEmbeddingModel(
    settings: GemmaEmbeddingSettings = {},
): LazyCandidateEmbeddingModel {
    if (
        settings.model !== undefined &&
        settings.model !== DefaultGemmaEmbeddingModel
    ) {
        throw new Error(
            `Gemma runtime supports only ${DefaultGemmaEmbeddingModel}`,
        );
    }
    const revision = settings.revision ?? DefaultGemmaEmbeddingRevision;
    assert.match(
        revision,
        /^[a-f0-9]{40}$/,
        "Gemma requires an immutable 40-hex revision",
    );
    const modalities = settings.modalities ?? ["text"];
    assert.ok(
        modalities.includes("text") &&
            modalities.every((value) => value === "text" || value === "image"),
        "Unsupported Gemma modalities",
    );
    const selected = { ...settings, modalities: [...modalities] };
    return createAdapterEmbeddingModel(
        {
            revision,
            maxBatchSize: settings.maxBatchSize ?? 8,
            maxPending: settings.maxPending ?? 16,
        },
        async () => {
            const loading = initialization.then(async () => {
                const runtime = await import("@huggingface/transformers");
                return loadAdapter(runtime, selected);
            });
            initialization = loading.then(
                () => {},
                () => {},
            );
            return loading;
        },
        Object.freeze({
            inputModalities: Object.freeze([...modalities]),
            mixedInputs: modalities.includes("image"),
        }),
    );
}
