// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Load *.prompt.yaml packs; Zod validates snake_case → camelCase. */

import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";
import { z } from "zod";

/** Directory containing *.prompt.yaml next to this module (src or dist). */
export const TRANSLATION_BENCH_SYNTHESIZER_PROMPTS_DIR = path.dirname(
    fileURLToPath(import.meta.url),
);

const SYNTHESIZER_PROMPT_FILE = "synthesizer.prompt.yaml";
const QUALITY_VERIFIER_PROMPT_FILE = "quality-verifier.prompt.yaml";
const PARAMETER_GRADER_PROMPT_FILE = "parameter-grader.prompt.yaml";

const nonEmptyString = z.string().trim().min(1);
const finiteNumber = z.number().finite();
const stringListSchema = z.array(nonEmptyString).min(1);

/** Ground-truth completion settings from *.prompt.yaml `model_configuration`. */
export const translationBenchModelConfigurationSchema = z
    .object({
        temperature: finiteNumber,
        top_p: finiteNumber.optional(),
        seed: finiteNumber.optional(),
        max_completion_tokens: finiteNumber.optional(),
        max_tokens: finiteNumber.optional(),
        n: finiteNumber.optional(),
        reasoning_effort: z
            .enum(["minimal", "low", "medium", "high"])
            .optional(),
        verbosity: z.enum(["low", "medium", "high"]).optional(),
    })
    .strict();

export type TranslationBenchModelConfiguration = z.infer<
    typeof translationBenchModelConfigurationSchema
>;

/** Completion settings from pack model_configuration (no undefined keys). */
export const translationBenchCompletionSettingsSchema =
    translationBenchModelConfigurationSchema.transform((config) => ({
        temperature: config.temperature,
        ...(config.top_p !== undefined ? { top_p: config.top_p } : {}),
        ...(config.seed !== undefined ? { seed: config.seed } : {}),
        ...(config.max_completion_tokens !== undefined
            ? { max_completion_tokens: config.max_completion_tokens }
            : {}),
        ...(config.max_tokens !== undefined
            ? { max_tokens: config.max_tokens }
            : {}),
        ...(config.n !== undefined ? { n: config.n } : {}),
        ...(config.reasoning_effort !== undefined
            ? { reasoning_effort: config.reasoning_effort }
            : {}),
        ...(config.verbosity !== undefined
            ? { verbosity: config.verbosity }
            : {}),
    }));

export type TranslationBenchCompletionSettings = z.infer<
    typeof translationBenchCompletionSettingsSchema
>;

const yamlRecordSchema = z.record(z.string(), z.unknown());

const promptTemplateVarsSchema = z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()]),
);

/** JSON-compatible tree for prompt YAML injection (via js-yaml.dump). */
const yamlJsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
    z.union([
        z.null(),
        z.boolean(),
        finiteNumber,
        z.string(),
        z.array(yamlJsonValueSchema),
        z.record(z.string(), yamlJsonValueSchema),
    ]),
);

const checkerBlockSchema = z
    .object({
        description: nonEmptyString,
        checks: stringListSchema,
    })
    .strip();

const synthesizerYamlSchema = z
    .object({
        name: nonEmptyString,
        version: finiteNumber.default(1),
        role: nonEmptyString,
        template: nonEmptyString,
        model_configuration: translationBenchModelConfigurationSchema,
    })
    .passthrough();

const qualityVerifierYamlSchema = z
    .object({
        name: nonEmptyString,
        version: finiteNumber.default(1),
        role: nonEmptyString,
        format_checker: checkerBlockSchema,
        semantic_checker: z
            .object({
                template: nonEmptyString,
                approve_score_threshold: finiteNumber.default(0.8),
                issue_codes: stringListSchema,
                model_configuration: translationBenchModelConfigurationSchema,
            })
            .strip(),
        acceptance: z
            .object({
                require_format_pass: z.boolean().default(true),
                require_semantic_approve: z.boolean().default(true),
                max_attempts: finiteNumber.default(5),
            })
            .strip()
            .default({
                require_format_pass: true,
                require_semantic_approve: true,
                max_attempts: 5,
            }),
    })
    .passthrough();

const parameterGraderYamlSchema = z
    .object({
        name: nonEmptyString,
        version: finiteNumber.default(1),
        role: nonEmptyString,
        regex_checker: checkerBlockSchema,
        policy_classifier: z
            .object({
                template: nonEmptyString,
                create_policies: stringListSchema,
                verify_modes: stringListSchema,
                model_configuration: translationBenchModelConfigurationSchema,
            })
            .strip(),
        policy_verifier: z
            .object({
                template: nonEmptyString,
                approve_score_threshold: finiteNumber.default(0.8),
                issue_codes: stringListSchema,
                model_configuration: translationBenchModelConfigurationSchema,
            })
            .strip(),
        acceptance: z
            .object({
                prefer_regex: z.boolean().default(true),
                require_verifier_approve_for_llm: z.boolean().default(true),
                max_classifier_attempts: finiteNumber.default(3),
            })
            .strip()
            .default({
                prefer_regex: true,
                require_verifier_approve_for_llm: true,
                max_classifier_attempts: 3,
            }),
    })
    .passthrough();

/** CamelCase pack schemas (YAML snake_case → pack via transform). */
export const translationBenchSynthesizerPromptPackSchema =
    synthesizerYamlSchema.transform((parsed) => ({
        name: parsed.name,
        version: parsed.version,
        role: parsed.role,
        template: parsed.template,
        modelConfiguration: parsed.model_configuration,
        raw: parsed as Record<string, unknown>,
    }));

export const translationBenchQualityVerifierPromptPackSchema =
    qualityVerifierYamlSchema.transform((parsed) => ({
        name: parsed.name,
        version: parsed.version,
        role: parsed.role,
        formatChecker: {
            description: parsed.format_checker.description,
            checks: parsed.format_checker.checks,
        },
        semanticChecker: {
            template: parsed.semantic_checker.template,
            approveScoreThreshold:
                parsed.semantic_checker.approve_score_threshold,
            issueCodes: parsed.semantic_checker.issue_codes,
            modelConfiguration: parsed.semantic_checker.model_configuration,
        },
        acceptance: {
            requireFormatPass: parsed.acceptance.require_format_pass,
            requireSemanticApprove: parsed.acceptance.require_semantic_approve,
            maxAttempts: parsed.acceptance.max_attempts,
        },
        raw: parsed as Record<string, unknown>,
    }));

export const translationBenchParameterGraderPromptPackSchema =
    parameterGraderYamlSchema.transform((parsed) => ({
        name: parsed.name,
        version: parsed.version,
        role: parsed.role,
        regexChecker: {
            description: parsed.regex_checker.description,
            checks: parsed.regex_checker.checks,
        },
        policyClassifier: {
            template: parsed.policy_classifier.template,
            createPolicies: parsed.policy_classifier.create_policies,
            verifyModes: parsed.policy_classifier.verify_modes,
            modelConfiguration: parsed.policy_classifier.model_configuration,
        },
        policyVerifier: {
            template: parsed.policy_verifier.template,
            approveScoreThreshold:
                parsed.policy_verifier.approve_score_threshold,
            issueCodes: parsed.policy_verifier.issue_codes,
            modelConfiguration: parsed.policy_verifier.model_configuration,
        },
        acceptance: {
            preferRegex: parsed.acceptance.prefer_regex,
            requireVerifierApproveForLlm:
                parsed.acceptance.require_verifier_approve_for_llm,
            maxClassifierAttempts: parsed.acceptance.max_classifier_attempts,
        },
        raw: parsed as Record<string, unknown>,
    }));

export type TranslationBenchSynthesizerPromptPack = z.infer<
    typeof translationBenchSynthesizerPromptPackSchema
>;
export type TranslationBenchQualityVerifierPromptPack = z.infer<
    typeof translationBenchQualityVerifierPromptPackSchema
>;
export type TranslationBenchParameterGraderPromptPack = z.infer<
    typeof translationBenchParameterGraderPromptPackSchema
>;

function formatZodError(label: string, error: z.ZodError): string {
    const detail = error.issues
        .map((issue) => {
            const path = issue.path.length === 0 ? "$" : issue.path.join(".");
            return `${path}: ${issue.message}`;
        })
        .join("; ");
    return `Translation-bench prompt '${label}' invalid: ${detail}`;
}

function parseWithZod<T>(
    schema: z.ZodType<T>,
    value: unknown,
    label: string,
): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        throw new Error(formatZodError(label, parsed.error));
    }
    return parsed.data;
}

/** Load prompt-pack YAML via js-yaml (same library as config/shell). */
export function parseTranslationBenchPromptYaml(text: string): unknown {
    try {
        return yaml.load(text, { schema: yaml.DEFAULT_SCHEMA }) ?? {};
    } catch (error) {
        throw new Error(
            `Invalid translation-bench prompt YAML: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}

/** Parse model_configuration; temperature required, unknown keys rejected. */
export function parseTranslationBenchModelConfiguration(
    value: unknown,
    label: string,
): TranslationBenchModelConfiguration {
    return parseWithZod(translationBenchModelConfigurationSchema, value, label);
}

/** Pack model_configuration → completion settings; pack fields win conflicts. */
export function completionSettingsFromModelConfiguration(
    config: TranslationBenchModelConfiguration,
): TranslationBenchCompletionSettings {
    return parseWithZod(
        translationBenchCompletionSettingsSchema,
        config,
        "model_configuration",
    );
}

/** Serialize a JSON-compatible value as YAML for prompt injection. */
export function toTranslationBenchPromptYaml(value: unknown): string {
    const data = parseWithZod(yamlJsonValueSchema, value, "yaml_value");
    return yaml
        .dump(data, {
            lineWidth: -1,
            noRefs: true,
            sortKeys: false,
        })
        .replace(/\n$/, "");
}

export function renderTranslationBenchPromptTemplate(
    template: string,
    vars: Record<string, string | number | boolean>,
): string {
    const safeVars = parseWithZod(
        promptTemplateVarsSchema,
        vars,
        "template_vars",
    );
    return template.replace(
        /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
        (_, key: string) => {
            if (!(key in safeVars)) {
                throw new Error(
                    `Translation-bench prompt template missing variable '{{${key}}}'`,
                );
            }
            return String(safeVars[key]);
        },
    );
}

export function resolveTranslationBenchPromptsDir(
    overrideDir?: string,
): string {
    if (overrideDir !== undefined && overrideDir.trim()) {
        return path.resolve(overrideDir);
    }
    return TRANSLATION_BENCH_SYNTHESIZER_PROMPTS_DIR;
}

function readPromptYaml(filePath: string): unknown {
    return parseTranslationBenchPromptYaml(fs.readFileSync(filePath, "utf8"));
}

/** Attach on-disk YAML as raw (keeps docs-only keys pack schemas strip). */
function loadPack<T>(
    fileName: string,
    schema: z.ZodType<T>,
    promptsDir: string | undefined,
    attachRaw: (pack: T, raw: Record<string, unknown>) => T,
): T {
    const filePath = path.join(
        resolveTranslationBenchPromptsDir(promptsDir),
        fileName,
    );
    const rawYaml = readPromptYaml(filePath);
    const raw = parseWithZod(yamlRecordSchema, rawYaml, filePath);
    const pack = parseWithZod(schema, rawYaml, filePath);
    return attachRaw(pack, raw);
}

export function loadTranslationBenchSynthesizerPromptPack(
    promptsDir?: string,
): TranslationBenchSynthesizerPromptPack {
    return loadPack(
        SYNTHESIZER_PROMPT_FILE,
        translationBenchSynthesizerPromptPackSchema,
        promptsDir,
        (pack, raw) => ({ ...pack, raw }),
    );
}

export function loadTranslationBenchQualityVerifierPromptPack(
    promptsDir?: string,
): TranslationBenchQualityVerifierPromptPack {
    return loadPack(
        QUALITY_VERIFIER_PROMPT_FILE,
        translationBenchQualityVerifierPromptPackSchema,
        promptsDir,
        (pack, raw) => ({ ...pack, raw }),
    );
}

export function loadTranslationBenchParameterGraderPromptPack(
    promptsDir?: string,
): TranslationBenchParameterGraderPromptPack {
    return loadPack(
        PARAMETER_GRADER_PROMPT_FILE,
        translationBenchParameterGraderPromptPackSchema,
        promptsDir,
        (pack, raw) => ({ ...pack, raw }),
    );
}
