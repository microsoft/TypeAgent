#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * setModelProvider — switch an EXISTING repo config.local.yaml between LLM
 * providers in place, for testing the self-host provider-choice flow on a
 * machine that already has a (Key-Vault-downloaded) config.
 *
 * Unlike generate-selfhost-config.mjs (which writes a fresh minimal config on
 * repo-less machines), this patches the chat `modelProvider` + `embedding`
 * fields of an existing config while PRESERVING everything else (azureOpenAI
 * endpoints, azureFoundry, maps, speech, etc.). That lets a developer flip to
 * Copilot chat + local embeddings, validate, then flip back to AI Systems
 * (`--provider aisystems`) or `--restore` the pristine backup.
 *
 * Provider governs CHAT only (routed via aiclient's provider-mode override);
 * `embedding.provider` is independent (the Copilot SDK has no embeddings).
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
 *   --embedding <mode>           local | ollama | openai | none | azure (default: local
 *                                for copilot/ollama; azure for aisystems).
 *   --copilot-model <name>       Copilot chat model (default claude-haiku-4.5).
 *   --ollama-host <url>          Ollama base URL (default http://localhost:11434).
 *   --chat-model <name>          Ollama chat model (default llama3.2).
 *   --embedding-endpoint <url>   Embedding endpoint (openai mode; full path).
 *   --embedding-model <name>     Embedding model name.
 *   --local-embedding-model <n>  transformers.js model (default Xenova/all-MiniLM-L6-v2).
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
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
const DEFAULT_OLLAMA_CHAT_MODEL = "llama3.2";
const DEFAULT_COPILOT_MODEL = "claude-haiku-4.5";
const DEFAULT_LOCAL_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
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
    switch (embedding) {
        case "local": {
            cfg.embedding = {
                provider: "local",
                model:
                    options.localEmbeddingModel ||
                    DEFAULT_LOCAL_EMBEDDING_MODEL,
            };
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
            break;
        }
        case "none": {
            cfg.embedding = { provider: "none" };
            break;
        }
        default:
            throw new Error(`Unknown embedding mode: ${embedding}`);
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
    } else if (provider === "ollama") {
        const openAI = ensureObject(cfg, "openAI");
        openAI.apiKey ??= "ollama";
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
    if (!distPath) {
        console.warn(
            "  (skipping loader validation: packages/config/dist not built)",
        );
        return Promise.resolve(true);
    }
    return import(pathToFileUrl(distPath))
        .then((mod) => {
            const { config } = mod.loadRuntimeConfigSync({
                localPath: outPath,
                populateProcessEnv: false,
            });
            console.log(
                `  Validated: modelProvider=${config.modelProvider ?? "(azure default)"}, ` +
                    `embedding.provider=${config.embedding?.provider ?? "(azure default)"}`,
            );
            return true;
        })
        .catch((e) => {
            console.error(`  Validation FAILED: ${e.message}`);
            return false;
        });
}

function pathToFileUrl(p) {
    return new URL(`file://${path.resolve(p).replace(/\\/g, "/")}`).href;
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

    const embeddingDefault = provider === "aisystems" ? "azure" : "local";
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
        copilotModel: arg("--copilot-model"),
        ollamaHost: arg("--ollama-host", DEFAULT_OLLAMA_HOST),
        chatModel: arg("--chat-model"),
        embeddingEndpoint: arg("--embedding-endpoint"),
        embeddingModel: arg("--embedding-model"),
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

    const body = yaml.dump(cfg, { indent: 2, lineWidth: -1, noRefs: true });
    const out =
        "# Copyright (c) Microsoft Corporation.\n" +
        "# Licensed under the MIT License.\n" +
        "#\n" +
        `# Patched by setModelProvider.mjs (chat=${provider}, embedding=${embedding}).\n` +
        "# Restore the original with: node setModelProvider.mjs --restore\n" +
        "#\n" +
        body;

    if (hasFlag("--dry-run")) {
        process.stdout.write(out);
        return 0;
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
    console.log(
        `Patched ${configPath} (${provider} chat, ${embedding} embeddings)`,
    );
    if (provider === "ollama") {
        console.log(
            `  Prereq: 'ollama serve' running with '${options.chatModel || DEFAULT_OLLAMA_CHAT_MODEL}' pulled.`,
        );
    } else if (provider === "copilot") {
        console.log("  Prereq: an authenticated 'copilot' CLI (github login).");
    }
    if (embedding === "local") {
        console.log(
            "  Embeddings: bundled CPU-only local model (downloads weights on first use).",
        );
    } else if (embedding === "none") {
        console.log(
            "  Embeddings: disabled — semantic search / fuzzy features degrade gracefully.",
        );
    }

    if (!hasFlag("--no-validate")) {
        const ok = await validate(configPath);
        if (!ok) {
            return 1;
        }
    }
    return 0;
}

main().then((code) => process.exit(code));
