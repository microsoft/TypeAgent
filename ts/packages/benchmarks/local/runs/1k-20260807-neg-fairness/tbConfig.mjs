// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared config loader for translation-bench local runs.
// Reads config.local.json (git-ignored), selects a batch, applies TB_* overrides.
// Config errors are caught by config.schema.json in your editor — not validated here.
//
// Precedence (highest first):
//   1. TB_* environment variable
//   2. selected batch (TB_BATCH, default "eval")
//   3. base
//   4. built-in default
//
// Per-model concurrency:
//   floor(headroom * tpmLimit / TOK_PER_MIN_PER_SLOT), capped by model.maxConcurrency.
//   (explicit models.<id>.concurrency still wins if set.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Measured: ~10.4K tokens/call at ~8.9s/call → ~70_000 TPM per unit of concurrency.
export const TOK_PER_MIN_PER_SLOT = Number(
    process.env.TB_TOK_PER_MIN_PER_SLOT || 70_000,
);

function loadConfig() {
    const p = path.join(__dirname, "config.local.json");
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8")) || {};
}

function deepMerge(a, b) {
    if (b === undefined || b === null) return a;
    if (Array.isArray(b) || typeof b !== "object") return b;
    const out = { ...(a || {}) };
    for (const k of Object.keys(b)) out[k] = deepMerge(a?.[k], b[k]);
    return out;
}

function concurrencyFor(modelCfg, headroom, fallback) {
    if (!modelCfg) return fallback;
    if (Number.isFinite(modelCfg.concurrency) && modelCfg.concurrency > 0) {
        return modelCfg.concurrency;
    }
    if (Number.isFinite(modelCfg.tpmLimit) && modelCfg.tpmLimit > 0) {
        const derived = Math.max(
            1,
            Math.floor((headroom * modelCfg.tpmLimit) / TOK_PER_MIN_PER_SLOT),
        );
        const cap = Number.isFinite(modelCfg.maxConcurrency)
            ? modelCfg.maxConcurrency
            : Infinity;
        return Math.min(derived, cap);
    }
    return fallback;
}

const raw = loadConfig();
const models = raw.models || {};

export const BATCH = process.env.TB_BATCH || "eval";

export function tbConfig() {
    const base = raw.base || {};
    const batch = (raw.batches || {})[BATCH];
    const synth = deepMerge(base.synthesizer, batch?.synthesizer) || {};
    const evalCfg = deepMerge(base.eval, batch?.eval) || {};
    const headroom = Number(
        process.env.TB_HEADROOM || evalCfg.headroom || 0.85,
    );

    const generatorModel =
        process.env.TB_GENERATOR_MODEL ||
        synth.generatorModel ||
        "azure/gpt-5.4";
    const reviewerModel =
        process.env.TB_REVIEWER_MODEL || synth.reviewerModel || generatorModel;

    const genConcurrency = Number(
        process.env.TB_CONCURRENCY ||
            concurrencyFor(
                models[generatorModel],
                headroom,
                synth.concurrency || 20,
            ),
    );

    const evalModels =
        (process.env.TB_EVAL_MODELS
            ? process.env.TB_EVAL_MODELS.split(",").map((s) => s.trim())
            : evalCfg.models) || [];

    const concurrencyByModel = Object.fromEntries(
        evalModels.map((id) => {
            const short = id.replace(/^azure\//, "");
            const envOverride =
                process.env[`TB_CONC_${short}`] ||
                process.env.TB_HIGH_CONCURRENCY;
            const c = envOverride
                ? Number(envOverride)
                : concurrencyFor(models[id], headroom, 10);
            return [id, c];
        }),
    );

    const maxCasesRaw =
        process.env.TB_EVAL_MAX_CASES !== undefined
            ? process.env.TB_EVAL_MAX_CASES
            : evalCfg.maxCases;

    return {
        batch: BATCH,
        headroom,
        generatorModel,
        reviewerModel,
        caseCount: Number(process.env.TB_CASE_COUNT || synth.caseCount || 1000),
        genCases: Number(process.env.TB_GEN_CASES || synth.genCases || 2),
        maxAttempts: Number(
            process.env.TB_MAX_ATTEMPTS || synth.maxAttempts || 5,
        ),
        genConcurrency,
        evalModels,
        concurrencyByModel,
        modelConcurrency: Number(
            process.env.TB_MODEL_CONCURRENCY ||
                evalCfg.modelConcurrency ||
                evalModels.length ||
                1,
        ),
        maxCases:
            maxCasesRaw === null || maxCasesRaw === undefined
                ? undefined
                : Number(maxCasesRaw),
        tpmLimits: Object.fromEntries(
            Object.entries(models).map(([id, m]) => [id, m?.tpmLimit || 0]),
        ),
    };
}
