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
 * Embeddings are independent of the chat provider (the Copilot SDK has none).
 * By default we configure the bundled CPU-only local embedder (transformers.js,
 * no GPU / API key / network at runtime after first download). Callers can
 * instead point at an Ollama or OpenAI embedding endpoint, or disable embeddings
 * entirely (embedding-dependent features then degrade gracefully).
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
 *   --copilot-model <name>      Copilot chat model (default claude-sonnet-4.5).
 *   --embedding <mode>          local (default) | ollama | openai | none.
 *   --embedding-endpoint <url>  Embedding endpoint (openai mode; full path).
 *   --embedding-model <name>    Embedding model name.
 *   --local-embedding-model <n> transformers.js model (default Xenova/all-MiniLM-L6-v2).
 *   --openai-key <key>          API key for openai embedding mode.
 *   --dry-run                   Print the YAML to stdout without writing.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
const DEFAULT_OLLAMA_CHAT_MODEL = "llama3.2";
const DEFAULT_COPILOT_MODEL = "claude-sonnet-4.5";
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

// Minimal YAML emitter for the flat/nested shape we produce. Values are only
// strings/numbers here, so quote strings that could otherwise be misparsed.
function yamlScalar(value) {
    if (typeof value === "number") {
        return String(value);
    }
    const s = String(value);
    // Quote when it contains characters YAML would treat specially, or looks
    // like a non-string scalar. URLs (with ':') as *values* are fine unquoted
    // in block style, but quoting is safest for keys like api paths.
    if (
        s === "" ||
        /^[\s]|[\s]$/.test(s) ||
        /[:#{}\[\],&*!|>'"%@`]/.test(s) ||
        /^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
        /^[-+]?\d/.test(s)
    ) {
        return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return s;
}

// Render a nested plain-object tree into block-style YAML.
function renderYaml(node, indent = 0) {
    const pad = "  ".repeat(indent);
    let out = "";
    for (const [key, value] of Object.entries(node)) {
        if (value === undefined || value === null) {
            continue;
        }
        if (typeof value === "object" && !Array.isArray(value)) {
            const nested = renderYaml(value, indent + 1);
            if (nested.trim().length === 0) {
                continue;
            }
            out += `${pad}${key}:\n${nested}`;
        } else {
            out += `${pad}${key}: ${yamlScalar(value)}\n`;
        }
    }
    return out;
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
        openaiKey,
    } = options;

    const tree = {};
    tree.modelProvider = provider;

    const openAI = {};
    if (provider === "ollama") {
        // Ollama exposes an OpenAI-compatible surface. The `local` sub-section
        // emits OLLAMA_ENDPOINT (base URL; aiclient appends the chat path).
        openAI.apiKey = "ollama"; // dummy, non-empty
        openAI.local = {
            apiKey: "None",
            endpoint: ollamaBaseUrl(ollamaHost),
            model: chatModel || DEFAULT_OLLAMA_CHAT_MODEL,
        };
    }

    if (provider === "copilot") {
        tree.copilot = {
            defaultModel: copilotModel || DEFAULT_COPILOT_MODEL,
        };
    }

    // Embedding wiring (independent of chat provider).
    const embeddingSection = {};
    switch (embedding) {
        case "local":
            embeddingSection.provider = "local";
            embeddingSection.model =
                localEmbeddingModel || DEFAULT_LOCAL_EMBEDDING_MODEL;
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
    tree.embedding = embeddingSection;
    return tree;
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

function main() {
    const provider = (arg("--provider") ?? "").toLowerCase();
    if (provider !== "ollama" && provider !== "copilot") {
        console.error(
            "generate-selfhost-config: --provider must be 'ollama' or 'copilot'.\n" +
                "(AI Systems provisioning uses getKeys, not this generator.)",
        );
        return 1;
    }

    const embedding = (arg("--embedding") ?? "local").toLowerCase();
    const validEmbedding = ["local", "ollama", "openai", "none"];
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
        localEmbeddingModel: arg("--local-embedding-model"),
        openaiKey: arg("--openai-key"),
    };

    const tree = buildConfigTree(options);
    const yaml = header(provider, embedding) + renderYaml(tree);

    if (hasFlag("--dry-run")) {
        process.stdout.write(yaml);
        return 0;
    }

    const outPath = resolveOutPath();
    if (fs.existsSync(outPath) && !hasFlag("--force")) {
        console.error(
            `Refusing to overwrite existing ${outPath} (pass --force to replace it).`,
        );
        return 1;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, yaml, "utf8");
    console.log(
        `Wrote self-host config (${provider} chat, ${embedding} embeddings) to ${outPath}`,
    );
    if (provider === "ollama") {
        console.log(
            `  Prereq: 'ollama serve' running with the '${options.chatModel || DEFAULT_OLLAMA_CHAT_MODEL}' model pulled.`,
        );
    } else {
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
    return 0;
}

process.exit(main());
