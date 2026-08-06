// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

/** Directory containing *.prompt.yaml next to this module (src or dist). */
export const TRANSLATION_BENCH_SYNTHESIZER_PROMPTS_DIR = path.dirname(
    fileURLToPath(import.meta.url),
);

const SYNTHESIZER_PROMPT_FILE = "synthesizer.prompt.yaml";
const QUALITY_VERIFIER_PROMPT_FILE = "quality-verifier.prompt.yaml";
const PARAMETER_GRADER_PROMPT_FILE = "parameter-grader.prompt.yaml";

export interface TranslationBenchModelConfiguration {
    temperature: number;
    top_p?: number;
    seed?: number;
    max_completion_tokens?: number;
    max_tokens?: number;
    n?: number;
    reasoning_effort?: "minimal" | "low" | "medium" | "high";
    verbosity?: "low" | "medium" | "high";
}

export interface TranslationBenchSynthesizerPromptPack {
    name: string;
    version: number;
    role: string;
    template: string;
    modelConfiguration: TranslationBenchModelConfiguration;
    raw: Record<string, unknown>;
}

export interface TranslationBenchQualityVerifierPromptPack {
    name: string;
    version: number;
    role: string;
    formatChecker: {
        description: string;
        checks: string[];
    };
    semanticChecker: {
        template: string;
        approveScoreThreshold: number;
        issueCodes: string[];
        modelConfiguration: TranslationBenchModelConfiguration;
    };
    acceptance: {
        requireFormatPass: boolean;
        requireSemanticApprove: boolean;
        maxAttempts: number;
    };
    raw: Record<string, unknown>;
}

/** Parallel to quality-verifier: regex → classifier → policy verifier. */
export interface TranslationBenchParameterGraderPromptPack {
    name: string;
    version: number;
    role: string;
    regexChecker: {
        description: string;
        checks: string[];
    };
    policyClassifier: {
        template: string;
        createPolicies: string[];
        verifyModes: string[];
        modelConfiguration: TranslationBenchModelConfiguration;
    };
    policyVerifier: {
        template: string;
        approveScoreThreshold: number;
        issueCodes: string[];
        modelConfiguration: TranslationBenchModelConfiguration;
    };
    acceptance: {
        preferRegex: boolean;
        requireVerifierApproveForLlm: boolean;
        maxClassifierAttempts: number;
    };
    raw: Record<string, unknown>;
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

function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Translation-bench prompt '${label}' must be a YAML mapping`);
    }
    return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Translation-bench prompt field '${label}' must be a string`);
    }
    return value;
}

function asNumber(value: unknown, label: string, fallback: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Translation-bench prompt field '${label}' must be a number`);
    }
    return value;
}

function asRequiredNumber(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Translation-bench prompt field '${label}' must be a number`);
    }
    return value;
}

const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high"]);
const VERBOSITIES = new Set(["low", "medium", "high"]);

export function parseTranslationBenchModelConfiguration(
    value: unknown,
    label: string,
): TranslationBenchModelConfiguration {
    const raw = asRecord(value, label);
    const allowed = new Set([
        "temperature",
        "top_p",
        "seed",
        "max_completion_tokens",
        "max_tokens",
        "n",
        "reasoning_effort",
        "verbosity",
    ]);
    for (const key of Object.keys(raw)) {
        if (!allowed.has(key)) {
            throw new Error(
                `Translation-bench prompt '${label}' has unsupported key '${key}'`,
            );
        }
    }
    if (!("temperature" in raw)) {
        throw new Error(
            `Translation-bench prompt '${label}.temperature' is required (ground truth, not optional)`,
        );
    }
    const config: TranslationBenchModelConfiguration = {
        temperature: asRequiredNumber(raw.temperature, `${label}.temperature`),
    };
    if (raw.top_p !== undefined) {
        config.top_p = asRequiredNumber(raw.top_p, `${label}.top_p`);
    }
    if (raw.seed !== undefined) {
        config.seed = asRequiredNumber(raw.seed, `${label}.seed`);
    }
    if (raw.max_completion_tokens !== undefined) {
        config.max_completion_tokens = asRequiredNumber(
            raw.max_completion_tokens,
            `${label}.max_completion_tokens`,
        );
    }
    if (raw.max_tokens !== undefined) {
        config.max_tokens = asRequiredNumber(raw.max_tokens, `${label}.max_tokens`);
    }
    if (raw.n !== undefined) {
        config.n = asRequiredNumber(raw.n, `${label}.n`);
    }
    if (raw.reasoning_effort !== undefined) {
        if (
            typeof raw.reasoning_effort !== "string" ||
            !REASONING_EFFORTS.has(raw.reasoning_effort)
        ) {
            throw new Error(
                `Translation-bench prompt '${label}.reasoning_effort' must be minimal|low|medium|high`,
            );
        }
        config.reasoning_effort = raw.reasoning_effort as
            | "minimal"
            | "low"
            | "medium"
            | "high";
    }
    if (raw.verbosity !== undefined) {
        if (typeof raw.verbosity !== "string" || !VERBOSITIES.has(raw.verbosity)) {
            throw new Error(
                `Translation-bench prompt '${label}.verbosity' must be low|medium|high`,
            );
        }
        config.verbosity = raw.verbosity as "low" | "medium" | "high";
    }
    return config;
}

export function completionSettingsFromModelConfiguration(
    config: TranslationBenchModelConfiguration,
): {
    temperature: number;
    top_p?: number;
    seed?: number;
    max_completion_tokens?: number;
    max_tokens?: number;
    n?: number;
    reasoning_effort?: "minimal" | "low" | "medium" | "high";
    verbosity?: "low" | "medium" | "high";
} {
    return {
        temperature: config.temperature,
        ...(config.top_p !== undefined ? { top_p: config.top_p } : {}),
        ...(config.seed !== undefined ? { seed: config.seed } : {}),
        ...(config.max_completion_tokens !== undefined
            ? { max_completion_tokens: config.max_completion_tokens }
            : {}),
        ...(config.max_tokens !== undefined ? { max_tokens: config.max_tokens } : {}),
        ...(config.n !== undefined ? { n: config.n } : {}),
        ...(config.reasoning_effort !== undefined
            ? { reasoning_effort: config.reasoning_effort }
            : {}),
        ...(config.verbosity !== undefined ? { verbosity: config.verbosity } : {}),
    };
}

function asStringArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value)) {
        throw new Error(`Translation-bench prompt field '${label}' must be an array`);
    }
    return value.map((entry, index) => {
        if (typeof entry !== "string" || !entry.trim()) {
            throw new Error(
                `Translation-bench prompt field '${label}[${index}]' must be a string`,
            );
        }
        return entry;
    });
}

export function toTranslationBenchPromptYaml(value: unknown): string {
    const lines: string[] = [];

    function quoteString(text: string): string {
        if (text === "") {
            return '""';
        }
        // Prefer plain scalars when safe; otherwise double-quote.
        if (
            /^(true|false|null|~|yes|no|on|off)$/i.test(text) ||
            /^[-?:,\[\]{}#&*!|>'"%@`]/.test(text) ||
            /[\n\r:#,\{\}\[\]]/.test(text) ||
            /^\s|\s$/.test(text) ||
            /^-?\d+(\.\d+)?$/.test(text)
        ) {
            return JSON.stringify(text);
        }
        return text;
    }

    function write(node: unknown, indent: number, isArrayItem: boolean): void {
        const pad = "  ".repeat(indent);
        const itemPad = isArrayItem ? `${"  ".repeat(Math.max(0, indent - 1))}- ` : pad;

        if (node === null || node === undefined) {
            lines.push(`${isArrayItem ? itemPad : pad}null`);
            return;
        }
        if (typeof node === "boolean" || typeof node === "number") {
            if (!Number.isFinite(node as number) && typeof node === "number") {
                throw new Error("Cannot serialize non-finite number as YAML");
            }
            lines.push(`${isArrayItem ? itemPad : pad}${String(node)}`);
            return;
        }
        if (typeof node === "string") {
            if (node.includes("\n")) {
                lines.push(`${isArrayItem ? itemPad : pad}|`);
                for (const line of node.split("\n")) {
                    lines.push(`${"  ".repeat(indent + (isArrayItem ? 1 : 0))}${line}`);
                }
                return;
            }
            lines.push(`${isArrayItem ? itemPad : pad}${quoteString(node)}`);
            return;
        }
        if (Array.isArray(node)) {
            if (node.length === 0) {
                lines.push(`${isArrayItem ? itemPad : pad}[]`);
                return;
            }
            if (isArrayItem) {
                // Nested array as an item: start on the dash line with empty, then children.
                lines.push(`${itemPad}`);
                for (const entry of node) {
                    write(entry, indent + 1, true);
                }
                return;
            }
            for (const entry of node) {
                write(entry, indent + 1, true);
            }
            return;
        }
        if (typeof node === "object") {
            const entries = Object.entries(node as Record<string, unknown>);
            if (entries.length === 0) {
                lines.push(`${isArrayItem ? itemPad : pad}{}`);
                return;
            }
            let first = true;
            for (const [key, child] of entries) {
                const keyPrefix = first && isArrayItem ? itemPad : pad;
                first = false;
                if (
                    child === null ||
                    child === undefined ||
                    typeof child === "boolean" ||
                    typeof child === "number" ||
                    (typeof child === "string" && !child.includes("\n"))
                ) {
                    const scalar =
                        child === null || child === undefined
                            ? "null"
                            : typeof child === "string"
                              ? quoteString(child)
                              : String(child);
                    lines.push(`${keyPrefix}${key}: ${scalar}`);
                } else if (Array.isArray(child) && child.length === 0) {
                    lines.push(`${keyPrefix}${key}: []`);
                } else if (
                    typeof child === "object" &&
                    child !== null &&
                    !Array.isArray(child) &&
                    Object.keys(child).length === 0
                ) {
                    lines.push(`${keyPrefix}${key}: {}`);
                } else {
                    lines.push(`${keyPrefix}${key}:`);
                    write(child, indent + 1, false);
                }
            }
            return;
        }
        throw new Error(
            `Cannot serialize type '${typeof node}' as translation-bench prompt YAML`,
        );
    }

    write(value, 0, false);
    return lines.join("\n");
}

export function renderTranslationBenchPromptTemplate(
    template: string,
    vars: Record<string, string | number | boolean>,
): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
        if (!(key in vars)) {
            throw new Error(
                `Translation-bench prompt template missing variable '{{${key}}}'`,
            );
        }
        return String(vars[key]);
    });
}

export function resolveTranslationBenchPromptsDir(
    overrideDir?: string,
): string {
    if (overrideDir !== undefined && overrideDir.trim()) {
        return path.resolve(overrideDir);
    }
    return TRANSLATION_BENCH_SYNTHESIZER_PROMPTS_DIR;
}

export function loadTranslationBenchSynthesizerPromptPack(
    promptsDir?: string,
): TranslationBenchSynthesizerPromptPack {
    const dir = resolveTranslationBenchPromptsDir(promptsDir);
    const filePath = path.join(dir, SYNTHESIZER_PROMPT_FILE);
    const raw = asRecord(
        parseTranslationBenchPromptYaml(fs.readFileSync(filePath, "utf8")),
        filePath,
    );
    return {
        name: asString(raw.name, "name"),
        version: asNumber(raw.version, "version", 1),
        role: asString(raw.role, "role"),
        template: asString(raw.template, "template"),
        modelConfiguration: parseTranslationBenchModelConfiguration(
            raw.model_configuration,
            "model_configuration",
        ),
        raw,
    };
}

export function loadTranslationBenchQualityVerifierPromptPack(
    promptsDir?: string,
): TranslationBenchQualityVerifierPromptPack {
    const dir = resolveTranslationBenchPromptsDir(promptsDir);
    const filePath = path.join(dir, QUALITY_VERIFIER_PROMPT_FILE);
    const raw = asRecord(
        parseTranslationBenchPromptYaml(fs.readFileSync(filePath, "utf8")),
        filePath,
    );
    const format = asRecord(raw.format_checker, "format_checker");
    const semantic = asRecord(raw.semantic_checker, "semantic_checker");
    const acceptance = asRecord(raw.acceptance ?? {}, "acceptance");
    return {
        name: asString(raw.name, "name"),
        version: asNumber(raw.version, "version", 1),
        role: asString(raw.role, "role"),
        formatChecker: {
            description: asString(format.description, "format_checker.description"),
            checks: asStringArray(format.checks, "format_checker.checks"),
        },
        semanticChecker: {
            template: asString(semantic.template, "semantic_checker.template"),
            approveScoreThreshold: asNumber(
                semantic.approve_score_threshold,
                "semantic_checker.approve_score_threshold",
                0.8,
            ),
            issueCodes: asStringArray(
                semantic.issue_codes,
                "semantic_checker.issue_codes",
            ),
            modelConfiguration: parseTranslationBenchModelConfiguration(
                semantic.model_configuration,
                "semantic_checker.model_configuration",
            ),
        },
        acceptance: {
            requireFormatPass:
                acceptance.require_format_pass === undefined
                    ? true
                    : acceptance.require_format_pass === true,
            requireSemanticApprove:
                acceptance.require_semantic_approve === undefined
                    ? true
                    : acceptance.require_semantic_approve === true,
            maxAttempts: asNumber(acceptance.max_attempts, "max_attempts", 5),
        },
        raw,
    };
}

export function loadTranslationBenchParameterGraderPromptPack(
    promptsDir?: string,
): TranslationBenchParameterGraderPromptPack {
    const dir = resolveTranslationBenchPromptsDir(promptsDir);
    const filePath = path.join(dir, PARAMETER_GRADER_PROMPT_FILE);
    const raw = asRecord(
        parseTranslationBenchPromptYaml(fs.readFileSync(filePath, "utf8")),
        filePath,
    );
    const regex = asRecord(raw.regex_checker, "regex_checker");
    const classifier = asRecord(raw.policy_classifier, "policy_classifier");
    const verifier = asRecord(raw.policy_verifier, "policy_verifier");
    const acceptance = asRecord(raw.acceptance ?? {}, "acceptance");
    return {
        name: asString(raw.name, "name"),
        version: asNumber(raw.version, "version", 1),
        role: asString(raw.role, "role"),
        regexChecker: {
            description: asString(regex.description, "regex_checker.description"),
            checks: asStringArray(regex.checks, "regex_checker.checks"),
        },
        policyClassifier: {
            template: asString(classifier.template, "policy_classifier.template"),
            createPolicies: asStringArray(
                classifier.create_policies,
                "policy_classifier.create_policies",
            ),
            verifyModes: asStringArray(
                classifier.verify_modes,
                "policy_classifier.verify_modes",
            ),
            modelConfiguration: parseTranslationBenchModelConfiguration(
                classifier.model_configuration,
                "policy_classifier.model_configuration",
            ),
        },
        policyVerifier: {
            template: asString(verifier.template, "policy_verifier.template"),
            approveScoreThreshold: asNumber(
                verifier.approve_score_threshold,
                "policy_verifier.approve_score_threshold",
                0.8,
            ),
            issueCodes: asStringArray(
                verifier.issue_codes,
                "policy_verifier.issue_codes",
            ),
            modelConfiguration: parseTranslationBenchModelConfiguration(
                verifier.model_configuration,
                "policy_verifier.model_configuration",
            ),
        },
        acceptance: {
            preferRegex:
                acceptance.prefer_regex === undefined
                    ? true
                    : acceptance.prefer_regex === true,
            requireVerifierApproveForLlm:
                acceptance.require_verifier_approve_for_llm === undefined
                    ? true
                    : acceptance.require_verifier_approve_for_llm === true,
            maxClassifierAttempts: asNumber(
                acceptance.max_classifier_attempts,
                "max_classifier_attempts",
                3,
            ),
        },
        raw,
    };
}
