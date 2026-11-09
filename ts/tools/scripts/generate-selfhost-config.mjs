#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * generate-selfhost-config — emit a config.local.yaml for self-host machines
 * that do NOT have access to the AI Systems Key Vault.
 *
 * This is the single source of truth for the "provider choice" self-host flow:
 * the install scripts and the MSI both call it (via
 * `typeagent-serve.mjs provision --provider <mode>`) instead of the Key Vault
 * (`getKeys`) path.
 *
 * Two chat providers are supported:
 *   - ollama:  local OpenAI-compatible chat (`ollama serve`).
 *   - copilot: GitHub Copilot SDK chat (requires an authenticated `copilot` CLI).
 *
 * Embeddings default to pinned offline CPU/FP32 MiniLM for either provider.
 * Gemma and hosted profiles are explicit choices. No model downloads occur
 * without separate consent; selection is fixed until the server restarts.
 *
 * Config path precedence mirrors getKeys / the @typeagent/config loader:
 *   --out
 *   > TYPEAGENT_CONFIG_LOCAL
 *   > <TYPEAGENT_CONFIG_DIR>/config.local.yaml
 *   > <repo ts/>/config.local.yaml   (in-repo default; unchanged for devs)
 *
 * Usage:
 *   node generate-selfhost-config.mjs --provider ollama|copilot [options]
 *
 * Options:
 *   --out <path>                Output file (overrides env-based resolution).
 *   --force                     Overwrite an existing config.local.yaml.
 *   --ollama-host <url>         Ollama base URL (default http://localhost:11434).
 *   --chat-model <name>         Ollama chat model (default llama3.2).
 *   --copilot-model <name>      Copilot chat model (default gpt-6-luna).
 *   --embedding <mode>          copilot | local | ollama | openai | none.
 *   --embedding-endpoint <url>  Embedding endpoint (openai mode; full path).
 *   --embedding-model <name>    Embedding model name.
 *   --local-embedding-model <n> minilm (default) | embeddinggemma; known IDs also accepted.
 *   --default-embedding-model <alias> Select a named profile (or none).
 *   --embedding-size <n>        Required dimensions for unknown hosted models.
 *   --download-local-embedding [0|1] Explicit download consent (default: no).
 *   --preserve-embedding-selection Keep existing embedding selection during upgrades.
 *   --local-embedding-cache-dir <path>
 *                               Persistent cache for local model files.
 *   --openai-key <key>          API key for openai embedding mode.
 *   --dry-run                   Print the YAML to stdout without writing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
    downloadEmbeddingConsent,
    provisionLocalEmbedding,
    selectConfiguredEmbeddingAlias,
    selectLocalEmbedding,
    selectedLocalEmbedding,
} from "./localEmbeddingModels.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
const DEFAULT_OLLAMA_CHAT_MODEL = "llama3.2";
const DEFAULT_COPILOT_MODEL = "gpt-6-luna";
const DEFAULT_COPILOT_FALLBACK_MODELS = [
    "gpt-5.4-mini",
    "gpt-5-mini",
    "gpt-5.4",
];
const DEFAULT_COPILOT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";

function arg(name, fallback) {
    const i = process.argv.indexOf(name);
    return i !== -1 && i + 1 < process.argv.length
        ? process.argv[i + 1]
        : fallback;
}

function hasFlag(name) {
    return process.argv.includes(name);
}

// Match getKeys.mjs / the loader's output-path precedence.
function resolveOutPath() {
    const explicit = arg("--out");
    if (explicit) {
        return path.resolve(explicit);
    }
    if (process.env.TYPEAGENT_CONFIG_LOCAL) {
        return path.resolve(process.env.TYPEAGENT_CONFIG_LOCAL);
    }
    if (process.env.TYPEAGENT_CONFIG_DIR) {
        return path.join(process.env.TYPEAGENT_CONFIG_DIR, "config.local.yaml");
    }
    return path.resolve(__dirname, "../../config.local.yaml");
}

// Strip a trailing chat path from an Ollama URL so we keep only the base
// (aiclient appends /v1/chat/completions itself for OLLAMA_ENDPOINT).
function ollamaBaseUrl(url) {
    let base = (url ?? DEFAULT_OLLAMA_HOST).trim().replace(/\/+$/, "");
    base = base.replace(/\/v1\/chat\/completions$/i, "");
    base = base.replace(/\/v1$/i, "");
    return base;
}

function buildConfigTree(options) {
    const {
        provider,
        ollamaHost,
        chatModel,
        copilotModel,
        embedding,
        embeddingEndpoint,
        embeddingModel,
        localEmbeddingModel,
        localEmbeddingCacheDir,
        openaiKey,
    } = options;

    const tree = {};
    tree.modelProvider = provider;

    const openAI = {};
    if (provider === "ollama") {
        // Ollama exposes an OpenAI-compatible surface. The `local` sub-section
        // emits OLLAMA_ENDPOINT (base URL; aiclient appends the chat path).
        openAI.local = {
            apiKey: "None",
            endpoint: ollamaBaseUrl(ollamaHost),
            model: chatModel || DEFAULT_OLLAMA_CHAT_MODEL,
        };
    }

    if (provider === "copilot") {
        tree.copilot = {
            defaultModel: copilotModel || DEFAULT_COPILOT_MODEL,
            fallbackModels: DEFAULT_COPILOT_FALLBACK_MODELS,
        };
    }

    // Embedding wiring (independent of chat provider).
    const embeddingSection = {};
    switch (embedding) {
        case "copilot":
            embeddingSection.provider = "copilot";
            embeddingSection.model =
                embeddingModel || DEFAULT_COPILOT_EMBEDDING_MODEL;
            break;
        case "local":
            selectLocalEmbedding(
                tree,
                localEmbeddingModel || "minilm",
                localEmbeddingCacheDir,
            );
            break;
        case "ollama":
            openAI.apiKey ??= "ollama";
            openAI.endpointEmbedding = `${ollamaBaseUrl(ollamaHost)}/v1/embeddings`;
            openAI.modelEmbedding =
                embeddingModel || DEFAULT_OLLAMA_EMBEDDING_MODEL;
            embeddingSection.provider = "openai";
            break;
        case "openai":
            if (openaiKey) {
                openAI.apiKey = openaiKey;
            }
            openAI.apiKey ??= "sk-REPLACE_ME";
            openAI.endpointEmbedding =
                embeddingEndpoint || "https://api.openai.com/v1/embeddings";
            openAI.modelEmbedding = embeddingModel || "text-embedding-3-small";
            embeddingSection.provider = "openai";
            break;
        case "none":
            embeddingSection.provider = "none";
            break;
        default:
            throw new Error(`Unknown embedding mode: ${embedding}`);
    }

    if (Object.keys(openAI).length > 0) {
        tree.openAI = openAI;
    }
    applyNamedEmbedding(tree, options, embeddingSection, openAI);
    return tree;
}

function applyNamedEmbedding(tree, options, embeddingSection, openAI) {
    const { embedding } = options;
    if (embedding !== "local" && embedding !== "none") {
        const model = embeddingSection.model || openAI.modelEmbedding;
        const knownSizes = {
            "text-embedding-3-small": 1536,
            "text-embedding-3-large": 3072,
            "text-embedding-ada-002": 1536,
            "nomic-embed-text": 768,
        };
        const size = options.embeddingSize ?? knownSizes[model];
        if (!Number.isSafeInteger(size) || size <= 0) {
            throw new Error(
                "Unknown embedding dimensions; pass --embedding-size <positive integer>.",
            );
        }
        tree.defaultEmbeddingModel = `${embedding}-embedding`;
        tree.embeddingModels = {
            [tree.defaultEmbeddingModel]: {
                provider: embeddingSection.provider,
                model,
                size,
                modalities: ["text"],
            },
        };
    } else if (embedding === "none") {
        tree.defaultEmbeddingModel = "none";
    }
}

function header(provider, embedding) {
    return [
        "# Copyright (c) Microsoft Corporation.",
        "# Licensed under the MIT License.",
        "#",
        "# TypeAgent self-host configuration (generated).",
        `# Chat provider: ${provider}. Embedding source: ${embedding}.`,
        "# This file replaces the Key Vault download for machines without AI",
        "# Systems access. Regenerate with generate-selfhost-config.mjs.",
        "#",
        "# NOTE: no `vault:` section — this deployment does not use Key Vault.",
        "",
        "",
    ].join("\n");
}

function mergeConfig(existing, generated) {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(generated)) {
        merged[key] =
            value && typeof value === "object" && !Array.isArray(value)
                ? mergeConfig(existing?.[key] ?? {}, value)
                : value;
    }
    return merged;
}

function mergeExistingConfig(tree, outPath) {
    let preservedEmbeddingSelection = false;
    if (fs.existsSync(outPath) && hasFlag("--force")) {
        const existing = yaml.load(fs.readFileSync(outPath, "utf8")) ?? {};
        if (typeof existing !== "object" || Array.isArray(existing)) {
            throw new Error("Existing config must be a YAML mapping.");
        }
        const preserve =
            hasFlag("--preserve-embedding-selection") ||
            (!hasFlag("--embedding") && !hasFlag("--local-embedding-model"));
        if (
            preserve &&
            (existing.defaultEmbeddingModel || existing.embedding)
        ) {
            preservedEmbeddingSelection = true;
            delete tree.defaultEmbeddingModel;
            delete tree.embeddingModels;
            delete tree.embedding;
        } else {
            delete existing.embedding;
            delete existing.defaultEmbeddingModel;
        }
        tree = mergeConfig(existing, tree);
    }
    return { tree, preservedEmbeddingSelection };
}

async function prepareEmbeddingSelection(
    tree,
    outPath,
    preservedEmbeddingSelection,
    embedding,
) {
    if (arg("--default-embedding-model")) {
        await selectConfiguredEmbeddingAlias(
            tree,
            arg("--default-embedding-model"),
            outPath,
        );
    }
    let download = downloadEmbeddingConsent();
    if (download && tree.defaultEmbeddingModel) {
        await selectConfiguredEmbeddingAlias(
            tree,
            tree.defaultEmbeddingModel,
            outPath,
        );
    }
    const selectedProvider =
        tree.embeddingModels?.[tree.defaultEmbeddingModel]?.provider ??
        tree.embedding?.provider;
    if (preservedEmbeddingSelection && selectedProvider !== "local") {
        download = false;
    }
    if (
        download &&
        !tree.defaultEmbeddingModel &&
        tree.embedding?.provider === "local"
    ) {
        selectLocalEmbedding(
            tree,
            tree.embedding.runtime ?? tree.embedding.model ?? "minilm",
            tree.embedding.cacheDir,
        );
    }
    const localDefinition = download ? selectedLocalEmbedding(tree) : undefined;
    const embeddingSelection =
        tree.defaultEmbeddingModel ?? tree.embedding?.provider ?? embedding;
    return { download, localDefinition, selectedProvider, embeddingSelection };
}

async function main() {
    const provider = (arg("--provider") ?? "").toLowerCase();
    if (provider !== "ollama" && provider !== "copilot") {
        console.error(
            "generate-selfhost-config: --provider must be 'ollama' or 'copilot'.\n" +
                "(AI Systems provisioning uses getKeys, not this generator.)",
        );
        return 1;
    }

    const embedding = (arg("--embedding") ?? "local").toLowerCase();
    const validEmbedding = ["copilot", "local", "ollama", "openai", "none"];
    if (!validEmbedding.includes(embedding)) {
        console.error(
            `generate-selfhost-config: --embedding must be one of ${validEmbedding.join(", ")}.`,
        );
        return 1;
    }

    const options = {
        provider,
        ollamaHost: arg("--ollama-host", DEFAULT_OLLAMA_HOST),
        chatModel: arg("--chat-model"),
        copilotModel: arg("--copilot-model"),
        embedding,
        embeddingEndpoint: arg("--embedding-endpoint"),
        embeddingModel: arg("--embedding-model"),
        embeddingSize:
            arg("--embedding-size") === undefined
                ? undefined
                : Number(arg("--embedding-size")),
        localEmbeddingModel: arg("--local-embedding-model"),
        localEmbeddingCacheDir: arg("--local-embedding-cache-dir"),
        openaiKey: arg("--openai-key"),
    };

    const outPath = resolveOutPath();
    const { tree, preservedEmbeddingSelection } = mergeExistingConfig(
        buildConfigTree(options),
        outPath,
    );
    const { download, localDefinition, selectedProvider, embeddingSelection } =
        await prepareEmbeddingSelection(
            tree,
            outPath,
            preservedEmbeddingSelection,
            embedding,
        );
    const output =
        header(provider, embeddingSelection) +
        yaml.dump(tree, { indent: 2, lineWidth: -1, noRefs: true });

    if (hasFlag("--dry-run")) {
        process.stdout.write(output);
        return 0;
    }

    if (fs.existsSync(outPath) && !hasFlag("--force")) {
        console.error(
            `Refusing to overwrite existing ${outPath} (pass --force to replace it).`,
        );
        return 1;
    }

    if (download) {
        await provisionLocalEmbedding(localDefinition, { allowDownload: true });
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, "utf8");
    console.log(
        `Wrote self-host config (${provider} chat, ${embeddingSelection} embeddings) to ${outPath}`,
    );
    if (provider === "ollama") {
        console.log(
            `  Prereq: 'ollama serve' running with the '${options.chatModel || DEFAULT_OLLAMA_CHAT_MODEL}' model pulled.`,
        );
    } else {
        console.log("  Prereq: an authenticated 'copilot' CLI (github login).");
    }
    if (selectedProvider === "local") {
        console.log(
            "  Embeddings: selected pinned CPU/FP32 model, offline-only. Stage its complete snapshot or explicitly pass --download-local-embedding. Restart the server to switch models.",
        );
    } else if (embeddingSelection === "none") {
        console.log(
            "  Embeddings: disabled — semantic search / fuzzy features degrade gracefully.",
        );
    }
    return 0;
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error) => {
        console.error(`generate-selfhost-config: ${error.message}`);
        process.exitCode = 1;
    });
