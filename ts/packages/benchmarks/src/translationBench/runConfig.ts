// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TpmLimits } from "../core/rateLimiter.js";

export const DEFAULT_TOK_PER_MIN_PER_SLOT = 70_000;
export const DEFAULT_EST_TOKENS_PER_CALL = 10_400;

export function defaultRateLimiterDbPath(): string {
    return path.join(
        os.homedir(),
        ".typeagent",
        "benchmark",
        "rate-limiters",
        "tpm.sqlite",
    );
}

export interface ModelConfig {
    tpmLimit?: number;
    maxConcurrency?: number;
    concurrency?: number;
}

export interface SynthesizerConfig {
    generatorModel?: string;
    reviewerModel?: string;
    caseCount?: number;
    genCases?: number;
    maxAttempts?: number;
    concurrency?: number;
    headroom?: number;
}

export interface EvalConfig {
    models?: string[];
    modelConcurrency?: number;
    maxCases?: number | null;
    headroom?: number;
}

export interface BatchConfig {
    synthesizer?: SynthesizerConfig;
    eval?: EvalConfig;
}

export interface RunConfigFile {
    models?: Record<string, ModelConfig>;
    base?: BatchConfig;
    batches?: Record<string, BatchConfig>;
}

export interface ResolveOptions {
    batch?: string;
    headroom?: number;
    tokPerMinPerSlot?: number;
}

export interface ResolvedRunConfig {
    batch: string;
    headroom: number;
    generatorModel: string;
    reviewerModel: string;
    caseCount: number;
    genCases: number;
    maxAttempts: number;
    genConcurrency: number;
    evalModels: string[];
    concurrencyByModel: Record<string, number>;
    modelConcurrency: number;
    maxCases: number | undefined;
    tpmLimits: TpmLimits;
}

const DEFAULT_BATCH = "eval";
const DEFAULT_HEADROOM = 0.85;
const DEFAULT_GENERATOR_MODEL = "azure/gpt-5.4";
const DEFAULT_CASE_COUNT = 1000;
const DEFAULT_GEN_CASES = 2;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_GEN_CONCURRENCY = 20;
const DEFAULT_EVAL_CONCURRENCY = 10;

function isPositive(value: number | undefined): value is number {
    return value !== undefined && Number.isFinite(value) && value > 0;
}

function mergeSection<T extends object>(
    base: T | undefined,
    override: T | undefined,
): T {
    return { ...(base ?? {}), ...(override ?? {}) } as T;
}

function concurrencyFor(
    modelConfig: ModelConfig | undefined,
    headroom: number,
    tokPerMinPerSlot: number,
    fallback: number,
): number {
    if (modelConfig === undefined) {
        return fallback;
    }
    if (isPositive(modelConfig.concurrency)) {
        return modelConfig.concurrency;
    }
    if (isPositive(modelConfig.tpmLimit)) {
        const derived = Math.max(
            1,
            Math.floor((headroom * modelConfig.tpmLimit) / tokPerMinPerSlot),
        );
        const cap = isPositive(modelConfig.maxConcurrency)
            ? modelConfig.maxConcurrency
            : Number.POSITIVE_INFINITY;
        return Math.min(derived, cap);
    }
    return fallback;
}

export function loadRunConfigFile(filePath: string): RunConfigFile {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    let text: string;
    try {
        text = fs.readFileSync(filePath, "utf8");
    } catch (error) {
        throw new Error(
            `runConfig: failed to read ${filePath}: ${String(error)}`,
        );
    }
    try {
        return (JSON.parse(text) as RunConfigFile) ?? {};
    } catch (error) {
        throw new Error(
            `runConfig: failed to parse ${filePath}: ${String(error)}`,
        );
    }
}

export function resolveRunConfig(
    file: RunConfigFile,
    options: ResolveOptions = {},
): ResolvedRunConfig {
    const batch = options.batch ?? DEFAULT_BATCH;
    const tokPerMinPerSlot =
        options.tokPerMinPerSlot ?? DEFAULT_TOK_PER_MIN_PER_SLOT;

    const models = file.models ?? {};
    const base = file.base ?? {};
    const selected = file.batches?.[batch];

    const synth = mergeSection(base.synthesizer, selected?.synthesizer);
    const evalCfg = mergeSection(base.eval, selected?.eval);

    const headroom =
        options.headroom ??
        evalCfg.headroom ??
        synth.headroom ??
        DEFAULT_HEADROOM;

    const generatorModel = synth.generatorModel ?? DEFAULT_GENERATOR_MODEL;
    const reviewerModel = synth.reviewerModel ?? generatorModel;

    const genConcurrency = concurrencyFor(
        models[generatorModel],
        headroom,
        tokPerMinPerSlot,
        synth.concurrency ?? DEFAULT_GEN_CONCURRENCY,
    );

    const evalModels = evalCfg.models ?? [];
    const concurrencyByModel: Record<string, number> = {};
    for (const id of evalModels) {
        concurrencyByModel[id] = concurrencyFor(
            models[id],
            headroom,
            tokPerMinPerSlot,
            DEFAULT_EVAL_CONCURRENCY,
        );
    }

    const tpmLimits: Record<string, number> = {};
    for (const [id, model] of Object.entries(models)) {
        if (isPositive(model.tpmLimit)) {
            tpmLimits[id] = model.tpmLimit;
        }
    }

    return {
        batch,
        headroom,
        generatorModel,
        reviewerModel,
        caseCount: synth.caseCount ?? DEFAULT_CASE_COUNT,
        genCases: synth.genCases ?? DEFAULT_GEN_CASES,
        maxAttempts: synth.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        genConcurrency,
        evalModels,
        concurrencyByModel,
        modelConcurrency: Math.max(
            1,
            evalCfg.modelConcurrency ?? evalModels.length,
        ),
        maxCases:
            evalCfg.maxCases === null || evalCfg.maxCases === undefined
                ? undefined
                : evalCfg.maxCases,
        tpmLimits,
    };
}
