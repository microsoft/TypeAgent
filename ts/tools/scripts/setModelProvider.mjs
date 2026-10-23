#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * setModelProvider — switch an EXISTING repo config.local.yaml between LLM
 * providers in place, for testing the self-host provider-choice flow on a
 * machine that already has a (Key-Vault-downloaded) config.
 *
 * Unlike generate-selfhost-config.mjs (which writes a fresh minimal config on
 * repo-less machines), this patches the chat `modelProvider` + named embedding
 * fields of an existing config while PRESERVING everything else (azureOpenAI
 * endpoints, azureFoundry, maps, speech, etc.). That lets a developer flip to
 * Copilot chat + local embeddings, validate, then flip back to AI Systems
 * (`--provider aisystems`) or `--restore` the pristine backup.
 *
 * Provider governs CHAT only; existing embedding selection is preserved unless
 * embedding/model/alias options explicitly request a change.
 *
 * Config path precedence (mirrors getKeys / the @typeagent/config loader):
 *   --config
 *   > TYPEAGENT_CONFIG_LOCAL
 *   > <TYPEAGENT_CONFIG_DIR>/config.local.yaml
 *   > <repo ts/>/config.local.yaml   (in-repo default)
 *
 * Usage:
 *   node setModelProvider.mjs --provider copilot|ollama|aisystems [options]
 *   node setModelProvider.mjs --restore            # restore <config>.bak
 *
 * Options:
 *   --provider <mode>            copilot | ollama | aisystems (required unless --restore).
 *   --embedding <mode>           local | ollama | openai | none | azure (explicit override).
 *   --copilot-model <name>       Copilot chat model (default gpt-5.6-luna).
 *   --ollama-host <url>          Ollama base URL (default http://localhost:11434).
 *   --chat-model <name>          Ollama chat model (default llama3.2).
 *   --embedding-endpoint <url>   Embedding endpoint (openai mode; full path).
 *   --embedding-model <name>     Embedding model name.
 *   --local-embedding-model <n>  minilm (default) | embeddinggemma; known IDs accepted.
 *   --local-embedding-cache-dir <path> Persistent snapshot cache.
 *   --default-embedding-model <alias> Select a named profile (or none).
 *   --embedding-size <n>         Required dimensions for unknown hosted models.
 *   --download-local-embedding [0|1] Explicit download consent (default: no).
 *   --openai-key <key>           API key for openai embedding mode.
 *   --config <path>              Config file to patch (overrides env resolution).
 *   --backup                     Write <config>.bak before editing (won't clobber an
 *                                existing backup).
 *   --restore                    Restore <config> from <config>.bak and exit.
 *   --dry-run                    Print the patched YAML to stdout without writing.
 *   --no-validate                Skip loadRuntimeConfigSync validation.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const DEFAULT_COPILOT_MODEL = "gpt-5.6-luna";
const DEFAULT_COPILOT_FALLBACK_MODELS = [
    "gpt-5.4-mini",
    "gpt-5-mini",
    "gpt-5.4",
];
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

// Match getKeys.mjs / generate-selfhost-config.mjs config-path precedence.
function resolveConfigPath() {
    const explicit = arg("--config");
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

// Strip a trailing chat path so we keep only the Ollama base URL (aiclient
// appends /v1/chat/completions and /v1/embeddings itself).
function ollamaBaseUrl(url) {
    let base = (url ?? DEFAULT_OLLAMA_HOST).trim().replace(/\/+$/, "");
    base = base.replace(/\/v1\/chat\/completions$/i, "");
    base = base.replace(/\/v1$/i, "");
    return base;
}

// Ensure a nested object exists at cfg[key] and return it.
function ensureObject(cfg, key) {
    if (
        cfg[key] === undefined ||
        cfg[key] === null ||
        typeof cfg[key] !== "object" ||
        Array.isArray(cfg[key])
    ) {
        cfg[key] = {};
    }
    return cfg[key];
}

function applyEmbedding(cfg, options) {
    const { embedding } = options;
    if (options.defaultEmbeddingModel) {
        return;
    }
    if (
        !options.explicitEmbedding &&
        (cfg.defaultEmbeddingModel || cfg.embedding)
    ) {
        return;
    }
    switch (embedding) {
        case "local": {
            selectLocalEmbedding(
                cfg,
                options.localEmbeddingModel || "minilm",
                options.localEmbeddingCacheDir,
            );
            break;
        }
        case "ollama": {
            const openAI = ensureObject(cfg, "openAI");
            openAI.apiKey ??= "ollama";
            openAI.endpointEmbedding = `${ollamaBaseUrl(options.ollamaHost)}/v1/embeddings`;
            openAI.modelEmbedding =
                options.embeddingModel || DEFAULT_OLLAMA_EMBEDDING_MODEL;
            cfg.embedding = { provider: "openai" };
            break;
        }
        case "openai": {
            const openAI = ensureObject(cfg, "openAI");
            if (options.openaiKey) {
                openAI.apiKey = options.openaiKey;
            }
            openAI.apiKey ??= "sk-REPLACE_ME";
            openAI.endpointEmbedding =
                options.embeddingEndpoint ||
                "https://api.openai.com/v1/embeddings";
            openAI.modelEmbedding =
                options.embeddingModel || "text-embedding-3-small";
            cfg.embedding = { provider: "openai" };
            break;
        }
        case "azure": {
            // Restore Azure/AI-Systems embeddings: drop the override so the
            // loader falls back to the azureOpenAI embedding deployments.
            delete cfg.embedding;
            delete cfg.defaultEmbeddingModel;
            break;
        }
        case "none": {
            cfg.defaultEmbeddingModel = "none";
            delete cfg.embedding;
            break;
        }
        default:
            throw new Error(`Unknown embedding mode: ${embedding}`);
    }
    if (embedding === "openai" || embedding === "ollama") {
        const model = cfg.openAI.modelEmbedding;
        const size =
            options.embeddingSize ??
            {
                "text-embedding-3-small": 1536,
                "text-embedding-3-large": 3072,
                "text-embedding-ada-002": 1536,
                "nomic-embed-text": 768,
            }[model];
        if (!Number.isSafeInteger(size) || size <= 0) {
            throw new Error(
                "Unknown embedding dimensions; pass --embedding-size <positive integer>.",
            );
        }
        cfg.embeddingModels ??= {};
        cfg.defaultEmbeddingModel = `${embedding}-embedding`;
        cfg.embeddingModels[cfg.defaultEmbeddingModel] = {
            provider: "openai",
            model,
            size,
            modalities: ["text"],
        };
        delete cfg.embedding;
    }
}

function patchConfig(cfg, options) {
    const { provider } = options;

    if (provider === "aisystems") {
        // Return chat routing to the azureOpenAI deployments already present.
        delete cfg.modelProvider;
        applyEmbedding(cfg, options);
        return cfg;
    }

    cfg.modelProvider = provider;

    if (provider === "copilot") {
        const copilot = ensureObject(cfg, "copilot");
        copilot.defaultModel = options.copilotModel || DEFAULT_COPILOT_MODEL;
        copilot.fallbackModels ??= DEFAULT_COPILOT_FALLBACK_MODELS;
    } else if (provider === "ollama") {
        const openAI = ensureObject(cfg, "openAI");
        const local = ensureObject(openAI, "local");
        local.apiKey = "None";
        local.endpoint = ollamaBaseUrl(options.ollamaHost);
        local.model = options.chatModel || DEFAULT_OLLAMA_CHAT_MODEL;
    }

    applyEmbedding(cfg, options);
    return cfg;
}

// Best-effort validation through the real loader. Non-fatal if the built
// @typeagent/config dist isn't available (e.g. before `pnpm run build`).
function validate(outPath) {
    const distCandidates = [
        path.resolve(__dirname, "../../packages/config/dist/index.js"),
    ];
    const distPath = distCandidates.find((p) => fs.existsSync(p));
    const module = distPath
        ? import(pathToFileURL(distPath).href)
        : import("@typeagent/config");
    return module
        .then((mod) => {
            const bundledDefaults = path.join(
                __dirname,
                "config.defaults.yaml",
            );
            const { config } = mod.loadRuntimeConfigSync({
                localPath: outPath,
                defaultsPath:
                    process.env.TYPEAGENT_CONFIG_DEFAULTS ||
                    (fs.existsSync(bundledDefaults)
                        ? bundledDefaults
                        : undefined),
                populateProcessEnv: false,
            });
            const embedding = mod.resolveEmbeddingConfig(config);
            console.log(
                `  Validated: modelProvider=${config.modelProvider ?? "(azure default)"}, ` +
                    `embedding.provider=${embedding?.provider ?? "(azure default)"}`,
            );
            return true;
        })
        .catch((e) => {
            if (
                e.code === "ERR_MODULE_NOT_FOUND" ||
                e.code === "MODULE_NOT_FOUND"
            ) {
                console.warn(
                    "  (skipping loader validation: @typeagent/config not built)",
                );
                return true;
            }
            console.error(`  Validation FAILED: ${e.message}`);
            return false;
        });
}

async function prepareEmbeddingSelection(cfg, options, configPath) {
    if (options.defaultEmbeddingModel) {
        await selectConfiguredEmbeddingAlias(
            cfg,
            options.defaultEmbeddingModel,
            configPath,
        );
    }
    const download = downloadEmbeddingConsent();
    if (download && cfg.defaultEmbeddingModel) {
        await selectConfiguredEmbeddingAlias(
            cfg,
            cfg.defaultEmbeddingModel,
            configPath,
        );
    }
    const localDefinition = download ? selectedLocalEmbedding(cfg) : undefined;
    const embeddingSelection =
        cfg.defaultEmbeddingModel ??
        cfg.embedding?.provider ??
        options.embedding;
    const selectedProvider =
        cfg.embeddingModels?.[cfg.defaultEmbeddingModel]?.provider ??
        cfg.embedding?.provider;
    return { download, localDefinition, embeddingSelection, selectedProvider };
}

function logConfiguration(
    configPath,
    options,
    embeddingSelection,
    selectedProvider,
) {
    const { provider } = options;
    console.log(
        `Patched ${configPath} (${provider} chat, ${embeddingSelection} embeddings)`,
    );
    if (provider === "ollama") {
        console.log(
            `  Prereq: 'ollama serve' running with '${options.chatModel || DEFAULT_OLLAMA_CHAT_MODEL}' pulled.`,
        );
    } else if (provider === "copilot") {
        console.log("  Prereq: an authenticated 'copilot' CLI (github login).");
    }
    if (selectedProvider === "local") {
        console.log(
            "  Embeddings: pinned CPU/FP32, offline-only; explicitly stage the selected snapshot. Restart the server to switch models.",
        );
    } else if (embeddingSelection === "none") {
        console.log(
            "  Embeddings: disabled — semantic search / fuzzy features degrade gracefully.",
        );
    }
}

async function main() {
    const configPath = resolveConfigPath();
    const backupPath = `${configPath}.bak`;

    if (hasFlag("--restore")) {
        if (!fs.existsSync(backupPath)) {
            console.error(`No backup to restore: ${backupPath} not found.`);
            return 1;
        }
        fs.copyFileSync(backupPath, configPath);
        console.log(`Restored ${configPath} from ${backupPath}`);
        return 0;
    }

    const provider = (arg("--provider") ?? "").toLowerCase();
    const validProviders = ["copilot", "ollama", "aisystems"];
    if (!validProviders.includes(provider)) {
        console.error(
            `setModelProvider: --provider must be one of ${validProviders.join(", ")} ` +
                "(or pass --restore).",
        );
        return 1;
    }

    const embeddingDefault = hasFlag("--local-embedding-model")
        ? "local"
        : provider === "aisystems"
          ? "azure"
          : "local";
    const embedding = (arg("--embedding") ?? embeddingDefault).toLowerCase();
    const validEmbedding = ["local", "ollama", "openai", "none", "azure"];
    if (!validEmbedding.includes(embedding)) {
        console.error(
            `setModelProvider: --embedding must be one of ${validEmbedding.join(", ")}.`,
        );
        return 1;
    }

    if (!fs.existsSync(configPath)) {
        console.error(
            `Config not found: ${configPath}\n` +
                "This tool patches an EXISTING config. For repo-less machines use " +
                "generate-selfhost-config.mjs instead.",
        );
        return 1;
    }

    const options = {
        provider,
        embedding,
        explicitEmbedding:
            hasFlag("--embedding") || hasFlag("--local-embedding-model"),
        defaultEmbeddingModel: arg("--default-embedding-model"),
        localEmbeddingCacheDir: arg("--local-embedding-cache-dir"),
        copilotModel: arg("--copilot-model"),
        ollamaHost: arg("--ollama-host", DEFAULT_OLLAMA_HOST),
        chatModel: arg("--chat-model"),
        embeddingEndpoint: arg("--embedding-endpoint"),
        embeddingModel: arg("--embedding-model"),
        embeddingSize:
            arg("--embedding-size") === undefined
                ? undefined
                : Number(arg("--embedding-size")),
        localEmbeddingModel: arg("--local-embedding-model"),
        openaiKey: arg("--openai-key"),
    };

    const raw = fs.readFileSync(configPath, "utf8");
    const cfg = yaml.load(raw) ?? {};
    if (typeof cfg !== "object" || Array.isArray(cfg)) {
        console.error(`Config at ${configPath} is not a YAML mapping.`);
        return 1;
    }

    patchConfig(cfg, options);
    const { download, localDefinition, embeddingSelection, selectedProvider } =
        await prepareEmbeddingSelection(cfg, options, configPath);

    const body = yaml.dump(cfg, { indent: 2, lineWidth: -1, noRefs: true });
    const out =
        "# Copyright (c) Microsoft Corporation.\n" +
        "# Licensed under the MIT License.\n" +
        "#\n" +
        `# Patched by setModelProvider.mjs (chat=${provider}, embedding=${embeddingSelection}).\n` +
        "# Restore the original with: node setModelProvider.mjs --restore\n" +
        "#\n" +
        body;

    if (hasFlag("--dry-run")) {
        process.stdout.write(out);
        return 0;
    }

    if (download) {
        await provisionLocalEmbedding(localDefinition, { allowDownload: true });
    }
    if (hasFlag("--backup")) {
        if (fs.existsSync(backupPath)) {
            console.log(
                `  Backup already exists (${backupPath}); keeping it as the pristine copy.`,
            );
        } else {
            fs.writeFileSync(backupPath, raw, "utf8");
            console.log(`  Backed up original to ${backupPath}`);
        }
    }

    fs.writeFileSync(configPath, out, "utf8");
    logConfiguration(configPath, options, embeddingSelection, selectedProvider);

    if (!hasFlag("--no-validate")) {
        const ok = await validate(configPath);
        if (!ok) {
            fs.writeFileSync(configPath, raw, "utf8");
            return 1;
        }
    }
    return 0;
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error) => {
        console.error(`setModelProvider: ${error.message}`);
        process.exitCode = 1;
    });
