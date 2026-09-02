// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
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
    caseOrder?: "any" | "strict";
}

export interface BatchConfig {
    synthesizer?: SynthesizerConfig;
    eval?: EvalConfig;
}

export interface RunConfigFile {
    $schema?: string;
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
    caseOrder: "any" | "strict" | undefined;
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

const nonEmptyStringSchema = z
    .string()
    .min(1)
    .refine((value) => value.trim() === value, {
        message: "must not have leading or trailing whitespace",
    });
const positiveIntegerSchema = z.number().int().positive();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const modelConfigSchema = z
    .object({
        tpmLimit: z.number().finite().nonnegative().optional(),
        maxConcurrency: positiveIntegerSchema.optional(),
        concurrency: positiveIntegerSchema.optional(),
    })
    .strict();
const synthesizerConfigSchema = z
    .object({
        generatorModel: nonEmptyStringSchema.optional(),
        reviewerModel: nonEmptyStringSchema.optional(),
        caseCount: positiveIntegerSchema.optional(),
        genCases: positiveIntegerSchema.optional(),
        maxAttempts: positiveIntegerSchema.optional(),
        concurrency: positiveIntegerSchema.optional(),
        headroom: z.number().finite().min(0).max(1).optional(),
    })
    .strict();
const evalConfigSchema = z
    .object({
        models: z.array(nonEmptyStringSchema).optional(),
        modelConcurrency: positiveIntegerSchema.optional(),
        maxCases: nonNegativeIntegerSchema.nullable().optional(),
        headroom: z.number().finite().min(0).max(1).optional(),
        caseOrder: z.enum(["any", "strict"]).optional(),
    })
    .strict()
    .superRefine((config, context) => {
        if (
            config.models !== undefined &&
            new Set(config.models).size !== config.models.length
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["models"],
                message: "must not contain duplicates",
            });
        }
    });
const batchConfigSchema = z
    .object({
        synthesizer: synthesizerConfigSchema.optional(),
        eval: evalConfigSchema.optional(),
    })
    .strict();
const runConfigFileSchema = z
    .object({
        $schema: z.string().optional(),
        models: z.record(nonEmptyStringSchema, modelConfigSchema).optional(),
        base: batchConfigSchema.optional(),
        batches: z.record(nonEmptyStringSchema, batchConfigSchema).optional(),
    })
    .strict();
const resolveOptionsSchema = z
    .object({
        batch: nonEmptyStringSchema.optional(),
        headroom: z.number().finite().min(0).max(1).optional(),
        tokPerMinPerSlot: z.number().finite().positive().optional(),
    })
    .strict();

function parseRunConfig(raw: unknown, source: string): RunConfigFile {
    const parsed = runConfigFileSchema.safeParse(raw);
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((issue) => {
                const path =
                    issue.path.length === 0 ? "$" : issue.path.join(".");
                return `${path}: ${issue.message}`;
            })
            .join("; ");
        throw new Error(`runConfig: invalid config at ${source}: ${detail}`);
    }
    return parsed.data as RunConfigFile;
}

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
    const cap = isPositive(modelConfig.maxConcurrency)
        ? modelConfig.maxConcurrency
        : Number.POSITIVE_INFINITY;
    if (isPositive(modelConfig.concurrency)) {
        return Math.min(modelConfig.concurrency, cap);
    }
    if (isPositive(modelConfig.tpmLimit)) {
        const derived = Math.max(
            1,
            Math.floor((headroom * modelConfig.tpmLimit) / tokPerMinPerSlot),
        );
        return Math.min(derived, cap);
    }
    return Math.min(fallback, cap);
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
    let raw: unknown;
    try {
        raw = JSON.parse(text) as unknown;
    } catch (error) {
        throw new Error(
            `runConfig: failed to parse ${filePath}: ${String(error)}`,
        );
    }
    return parseRunConfig(raw, filePath);
}

function selectedBatch(
    batches: Record<string, BatchConfig> | undefined,
    batch: string,
): BatchConfig | undefined {
    if (batches !== undefined && Object.keys(batches).length > 0) {
        if (!(batch in batches)) {
            throw new Error(
                `runConfig: unknown batch '${batch}'. Known batches: ${Object.keys(batches).sort().join(", ")}`,
            );
        }
    }
    return batches?.[batch];
}

function tpmLimitsFromModels(
    models: Record<string, ModelConfig>,
): Record<string, number> {
    const tpmLimits: Record<string, number> = {};
    for (const [id, model] of Object.entries(models)) {
        if (isPositive(model.tpmLimit)) {
            tpmLimits[id] = model.tpmLimit;
        }
    }
    return tpmLimits;
}

function evalConcurrencyByModel(
    evalModels: string[],
    models: Record<string, ModelConfig>,
    headroom: number,
    tokPerMinPerSlot: number,
): Record<string, number> {
    const concurrencyByModel: Record<string, number> = {};
    for (const id of evalModels) {
        concurrencyByModel[id] = concurrencyFor(
            models[id],
            headroom,
            tokPerMinPerSlot,
            DEFAULT_EVAL_CONCURRENCY,
        );
    }
    return concurrencyByModel;
}

function optionalMaxCases(
    maxCases: number | null | undefined,
): number | undefined {
    if (maxCases === null || maxCases === undefined) {
        return undefined;
    }
    return maxCases;
}

export function resolveRunConfig(
    file: RunConfigFile,
    options: ResolveOptions = {},
): ResolvedRunConfig {
    const validatedFile = parseRunConfig(file, "<memory>");
    const validatedOptions = resolveOptionsSchema.parse(options);
    const batch = validatedOptions.batch ?? DEFAULT_BATCH;
    const tokPerMinPerSlot =
        validatedOptions.tokPerMinPerSlot ?? DEFAULT_TOK_PER_MIN_PER_SLOT;

    const models = validatedFile.models ?? {};
    const base = validatedFile.base ?? {};
    const selected = selectedBatch(validatedFile.batches, batch);

    const synth = mergeSection(base.synthesizer, selected?.synthesizer);
    const evalCfg = mergeSection(base.eval, selected?.eval);

    const headroom =
        validatedOptions.headroom ??
        evalCfg.headroom ??
        synth.headroom ??
        DEFAULT_HEADROOM;

    const generatorModel = synth.generatorModel ?? DEFAULT_GENERATOR_MODEL;
    const reviewerModel = synth.reviewerModel ?? generatorModel;
    const evalModels = evalCfg.models ?? [];

    return {
        batch,
        headroom,
        generatorModel,
        reviewerModel,
        caseCount: synth.caseCount ?? DEFAULT_CASE_COUNT,
        genCases: synth.genCases ?? DEFAULT_GEN_CASES,
        maxAttempts: synth.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        genConcurrency: concurrencyFor(
            models[generatorModel],
            headroom,
            tokPerMinPerSlot,
            synth.concurrency ?? DEFAULT_GEN_CONCURRENCY,
        ),
        evalModels,
        concurrencyByModel: evalConcurrencyByModel(
            evalModels,
            models,
            headroom,
            tokPerMinPerSlot,
        ),
        modelConcurrency: Math.max(
            1,
            evalCfg.modelConcurrency ?? evalModels.length,
        ),
        maxCases: optionalMaxCases(evalCfg.maxCases),
        caseOrder: evalCfg.caseOrder,
        tpmLimits: tpmLimitsFromModels(models),
    };
}
