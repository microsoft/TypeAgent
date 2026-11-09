// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const embeddingRuntimeVersions = Object.freeze({
    "@huggingface/transformers": "4.3.1",
    sharp: "0.35.5",
    "onnxruntime-node": "1.30.0",
});

export const localEmbeddingModels = Object.freeze({
    minilm: {
        provider: "local",
        runtime: "minilm",
        model: "Xenova/all-MiniLM-L6-v2",
        revision: "751bff37182d3f1213fa05d7196b954e230abad9",
        size: 384,
        modalities: ["text"],
    },
    embeddinggemma: {
        provider: "local",
        runtime: "embeddinggemma",
        model: "onnx-community/embeddinggemma-2-ONNX",
        revision: "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
        size: 768,
        modalities: ["text", "image"],
    },
});

export function defaultEmbeddingCacheDir() {
    return path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), ".cache"),
        "TypeAgent",
        "embedding-cache",
    );
}

export function localEmbeddingDefinition(selection = "minilm", cacheDir) {
    const key = selection.toLowerCase();
    const model =
        localEmbeddingModels[key] ??
        Object.values(localEmbeddingModels).find(
            (entry) => entry.model === selection,
        );
    if (!model) {
        throw new Error(
            `Unsupported local embedding model '${selection}'; choose minilm or embeddinggemma.`,
        );
    }
    return {
        ...model,
        modalities: [...model.modalities],
        cacheDir: path.resolve(cacheDir || defaultEmbeddingCacheDir()),
        localFilesOnly: true,
    };
}

export function localEmbeddingAssets(definition) {
    const assets = [
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "onnx/model.onnx",
    ];
    if (definition.runtime === "embeddinggemma") {
        assets.push("processor_config.json", "onnx/model.onnx_data");
        if (definition.modalities.includes("image")) {
            assets.push("onnx/vision_encoder.onnx");
        }
    }
    return assets;
}

function validateDefinition(definition) {
    const pinned = localEmbeddingDefinition(
        definition.runtime,
        definition.cacheDir,
    );
    if (
        definition.model !== pinned.model ||
        definition.revision !== pinned.revision ||
        definition.size !== pinned.size ||
        !Array.isArray(definition.modalities) ||
        !definition.modalities.includes("text") ||
        definition.modalities.some(
            (value) => !pinned.modalities.includes(value),
        )
    ) {
        throw new Error(
            "Provisioning requires a supported pinned local embedding definition.",
        );
    }
}

function validAsset(filename) {
    try {
        const stat = fs.lstatSync(filename);
        if (!stat.isFile() || stat.size === 0) return false;
        if (filename.endsWith(".json"))
            JSON.parse(fs.readFileSync(filename, "utf8"));
        return true;
    } catch {
        return false;
    }
}

// This stages one selected immutable CPU/FP32 snapshot, never the whole catalog.
export async function provisionLocalEmbedding(
    definition,
    { allowDownload = false, fetchImpl = globalThis.fetch } = {},
) {
    validateDefinition(definition);
    const snapshot = path.join(
        definition.cacheDir,
        ...definition.model.split("/"),
        definition.revision,
    );
    const assets = localEmbeddingAssets(definition);
    const missing = assets.filter(
        (asset) => !validAsset(path.join(snapshot, asset)),
    );
    if (!missing.length) return { snapshot, downloaded: [] };
    if (!allowDownload) {
        throw new Error(
            `Missing pinned ${definition.runtime} assets: ${missing.join(", ")}. ` +
                "Stage the complete snapshot offline or explicitly pass --download-local-embedding (Gemma is multiple GB).",
        );
    }
    const downloaded = [];
    for (const asset of missing) {
        const destination = path.join(snapshot, asset);
        const partial = `${destination}.partial`;
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        try {
            const response = await fetchImpl(
                `https://huggingface.co/${definition.model}/resolve/${definition.revision}/${asset}`,
            );
            if (!response.ok || !response.body) {
                throw new Error(`HTTP ${response.status} downloading ${asset}`);
            }
            await pipeline(
                Readable.fromWeb(response.body),
                fs.createWriteStream(partial),
            );
            // Validate before publishing; interrupted downloads can be retried.
            if (fs.statSync(partial).size === 0) {
                throw new Error(`Empty model asset ${asset}`);
            }
            if (asset.endsWith(".json"))
                JSON.parse(fs.readFileSync(partial, "utf8"));
            fs.renameSync(partial, destination);
            downloaded.push(asset);
        } finally {
            fs.rmSync(partial, { force: true });
        }
    }
    return { snapshot, downloaded };
}

export function selectLocalEmbedding(cfg, selection, cacheDir) {
    const definition = localEmbeddingDefinition(selection, cacheDir);
    const alias = `local-${definition.runtime}`;
    cfg.embeddingModels ??= {};
    cfg.embeddingModels[alias] = definition;
    cfg.defaultEmbeddingModel = alias;
    delete cfg.embedding;
    return definition;
}

export function selectEmbeddingAlias(cfg, alias) {
    if (
        !cfg.embeddingModels?.[alias] &&
        alias.startsWith("local-") &&
        localEmbeddingModels[alias.slice("local-".length)]
    ) {
        selectLocalEmbedding(cfg, alias.slice("local-".length));
    }
    if (alias !== "none" && !cfg.embeddingModels?.[alias]) {
        throw new Error(`Unknown embedding model alias '${alias}'.`);
    }
    cfg.defaultEmbeddingModel = alias;
    delete cfg.embedding;
}

export async function selectConfiguredEmbeddingAlias(cfg, alias, localPath) {
    if (alias !== "none") {
        try {
            const config = await import("@typeagent/config");
            const bundledDefaults = path.join(
                path.dirname(fileURLToPath(import.meta.url)),
                "config.defaults.yaml",
            );
            const loaded = config.loadConfigSync({
                localPath,
                defaultsPath:
                    process.env.TYPEAGENT_CONFIG_DEFAULTS ||
                    (fs.existsSync(bundledDefaults)
                        ? bundledDefaults
                        : undefined),
                dotEnvPath: path.join(
                    path.dirname(localPath),
                    ".embedding-no-dotenv",
                ),
                populateProcessEnv: false,
            });
            const inherited = JSON.parse(
                loaded.env.TYPEAGENT_EMBEDDING_MODELS || "{}",
            )[alias];
            if (inherited) {
                cfg.embeddingModels ??= {};
                cfg.embeddingModels[alias] = {
                    ...inherited,
                    ...cfg.embeddingModels[alias],
                };
            }
        } catch (error) {
            if (
                error.code !== "ERR_MODULE_NOT_FOUND" &&
                error.code !== "MODULE_NOT_FOUND"
            )
                throw error;
        }
    }
    selectEmbeddingAlias(cfg, alias);
}

export function selectedLocalEmbedding(cfg) {
    const alias = cfg.defaultEmbeddingModel;
    const definition = cfg.embeddingModels?.[alias];
    if (definition?.provider !== "local") {
        throw new Error(
            "--download-local-embedding requires a selected local embedding profile.",
        );
    }
    const normalized = {
        ...localEmbeddingDefinition(
            definition.runtime ?? definition.model,
            definition.cacheDir,
        ),
        ...definition,
        cacheDir: path.resolve(
            definition.cacheDir || defaultEmbeddingCacheDir(),
        ),
        localFilesOnly: true,
    };
    validateDefinition(normalized);
    cfg.embeddingModels[alias] = normalized;
    return normalized;
}

export function downloadEmbeddingConsent(argv = process.argv) {
    const index = argv.indexOf("--download-local-embedding");
    if (index === -1) return false;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) return true;
    if (value === "0") return false;
    if (value === "1") return true;
    throw new Error(
        "--download-local-embedding accepts only 0 or 1 (or no value).",
    );
}
