// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar fuzz-testing harness.
 *
 * The core validation engine: generates random grammars via
 * {@link grammarGenerator} and checks correctness properties:
 *
 *   - **optimizer**: `matchGrammar` produces identical results with
 *     and without optimizer passes enabled.
 *   - **roundtrip-text**: `parse -> write -> re-parse` yields the
 *     same AST.
 *   - **roundtrip-json**: `load -> serialize -> deserialize` yields
 *     a structurally identical `Grammar`.
 *
 * Designed for two consumers:
 *   1. The CLI runner (`fuzzRunner.ts`) for interactive / extended use.
 *   2. Jest `.spec.ts` files for CI with fixed configs.
 */

import {
    makeRng,
    pick,
    intInRange,
    buildRandomGrammar,
    generateExtraInputs,
    DEFAULT_FEATURES,
    DEFAULT_GENERATOR_CONFIG,
    FEATURE_FIELDS,
    type FuzzFeatureFlags,
    type GeneratorConfig,
    type GeneratedGrammar,
} from "./grammarGenerator.js";
import { loadGrammarRules } from "../grammarLoader.js";
import type { LoadGrammarRulesOptions } from "../grammarLoader.js";
import { matchGrammar } from "../grammarMatcher.js";
import { recommendedOptimizations } from "../grammarOptimizer.js";
import { parseGrammarRules } from "../grammarRuleParser.js";
import { writeGrammarRules } from "../grammarRuleWriter.js";
import { grammarToJson } from "../grammarSerializer.js";
import { grammarFromJson } from "../grammarDeserializer.js";
import type { Grammar } from "../grammarTypes.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type FuzzValidationKind =
    | "optimizer"
    | "roundtrip-text"
    | "roundtrip-json";

export type FuzzConfig = {
    /** Deterministic seed for the PRNG. */
    seed: number;
    /** Number of random grammars to generate. */
    count: number;
    /** Extra random inputs per grammar (beyond the 3 pre-computed ones). */
    inputsPerGrammar: number;
    /** Which grammar features to exercise. */
    features: FuzzFeatureFlags;
    /** Which validations to run on each grammar. */
    validations: FuzzValidationKind[];
    /** Generator config (depths / widths / vocabulary). */
    generator: GeneratorConfig;
    /** Print each grammar and per-input results to stdout. */
    verbose: boolean;
};

export const DEFAULT_CONFIG: FuzzConfig = {
    seed: 0xc0ffee,
    count: 40,
    inputsPerGrammar: 6,
    features: cloneFeatures(DEFAULT_FEATURES),
    validations: ["optimizer", "roundtrip-text", "roundtrip-json"],
    generator: { ...DEFAULT_GENERATOR_CONFIG },
    verbose: false,
};

/** Deep clone of a {@link FuzzFeatureFlags} record. */
export function cloneFeatures(f: FuzzFeatureFlags): FuzzFeatureFlags {
    return {
        partKinds: { ...f.partKinds },
        values: { ...f.values },
        spacing: { ...f.spacing, modes: { ...f.spacing.modes } },
        groups: { ...f.groups },
    };
}

/** Reset every numeric field in `f` to 0 in place. */
export function zeroAllFeatures(f: FuzzFeatureFlags): void {
    for (const field of FEATURE_FIELDS) field.set(f, 0);
}

/** Iterate `(path, value)` pairs in canonical order for diagnostic output. */
export function* featureEntries(
    f: FuzzFeatureFlags,
): Iterable<readonly [string, number]> {
    for (const field of FEATURE_FIELDS) {
        yield [field.path, field.get(f)];
    }
}

/**
 * Nested partial override of a {@link FuzzFeatureFlags} record, used
 * by tests and other callers that prefer a structural literal to the
 * dotted-path setter API.
 */
export type FeaturesOverride = {
    partKinds?: Partial<FuzzFeatureFlags["partKinds"]>;
    values?: Partial<FuzzFeatureFlags["values"]>;
    spacing?: Partial<Omit<FuzzFeatureFlags["spacing"], "modes">> & {
        modes?: Partial<FuzzFeatureFlags["spacing"]["modes"]>;
    };
    groups?: Partial<FuzzFeatureFlags["groups"]>;
};

/**
 * Deep-merge a {@link FeaturesOverride} on top of `base`, returning a
 * fresh record.  Each sub-group is merged independently;
 * `spacing.modes` is merged one level deeper.
 */
export function mergeFeatures(
    base: FuzzFeatureFlags,
    over: FeaturesOverride | undefined,
): FuzzFeatureFlags {
    return {
        partKinds: { ...base.partKinds, ...(over?.partKinds ?? {}) },
        values: { ...base.values, ...(over?.values ?? {}) },
        spacing: {
            ...base.spacing,
            ...(over?.spacing ?? {}),
            modes: { ...base.spacing.modes, ...(over?.spacing?.modes ?? {}) },
        },
        groups: { ...base.groups, ...(over?.groups ?? {}) },
    };
}

export type FuzzResult = {
    grammarIndex: number;
    grammarText: string;
    validation: FuzzValidationKind;
    /** Specific input that was tested (only for optimizer validation). */
    input?: string | undefined;
    passed: boolean;
    error?: string | undefined;
};

// ── Validation implementations ────────────────────────────────────────────────

function matchKeys(
    grammar: Grammar,
    input: string,
): string[] | { error: string } {
    try {
        return matchGrammar(grammar, input)
            .map((m) => JSON.stringify(m.match))
            .sort();
    } catch (e) {
        return { error: (e as Error).message };
    }
}

function isErrorResult(r: unknown): r is { error: string } {
    return (
        typeof r === "object" && r !== null && !Array.isArray(r) && "error" in r
    );
}

/**
 * Validate that `matchGrammar` produces identical results with and
 * without the recommended optimizer passes.
 */
export function validateOptimizerEquivalence(
    grammarIndex: number,
    grammarText: string,
    inputs: string[],
    gen: GeneratedGrammar,
): FuzzResult[] {
    const results: FuzzResult[] = [];
    const loadOpts: LoadGrammarRulesOptions = {
        startValueRequired: gen.startValueRequired,
        enableValueExpressions: gen.usesValueExpressions,
    };

    let baseline: Grammar;
    let optimized: Grammar;
    try {
        baseline = loadGrammarRules("fuzz.grammar", grammarText, loadOpts);
        optimized = loadGrammarRules("fuzz.grammar", grammarText, {
            ...loadOpts,
            optimizations: recommendedOptimizations,
        });
    } catch (e) {
        results.push({
            grammarIndex,
            grammarText,
            validation: "optimizer",
            passed: false,
            error: `Compile error: ${(e as Error).message}`,
        });
        return results;
    }

    for (const input of inputs) {
        const baseResult = matchKeys(baseline, input);
        const optResult = matchKeys(optimized, input);

        let passed: boolean;
        let error: string | undefined;

        if (isErrorResult(baseResult)) {
            // Both throwing is consistent (grammar itself is the problem).
            passed = isErrorResult(optResult);
            if (!passed) {
                error = `Baseline threw but optimized did not: ${baseResult.error}`;
            }
        } else if (isErrorResult(optResult)) {
            passed = false;
            error = `Optimized threw but baseline did not: ${optResult.error}`;
        } else {
            // Compare the sorted multi-set of JSON match strings.
            const eq =
                baseResult.length === optResult.length &&
                baseResult.every((v, i) => v === optResult[i]);
            passed = eq;
            if (!passed) {
                error =
                    `Match mismatch:\n` +
                    `  baseline:  ${JSON.stringify(baseResult)}\n` +
                    `  optimized: ${JSON.stringify(optResult)}`;
            }
        }

        results.push({
            grammarIndex,
            grammarText,
            validation: "optimizer",
            input,
            passed,
            error,
        });
    }

    return results;
}

/**
 * Validate that the writer is idempotent: `write(parse(text))` applied
 * twice yields the same output.  This avoids false positives from the
 * writer normalizing syntax (e.g. `$(v:string)` -> `$(v)`).
 *
 * The check is: parse -> write -> parse -> write, then assert the two
 * written strings are identical.
 */
export function validateTextRoundTrip(
    grammarIndex: number,
    grammarText: string,
    gen: GeneratedGrammar,
): FuzzResult {
    try {
        const enableExpr = gen.usesValueExpressions;
        const parsed1 = parseGrammarRules(
            "fuzz-1",
            grammarText,
            false,
            enableExpr,
        );
        const written1 = writeGrammarRules(parsed1);
        const parsed2 = parseGrammarRules(
            "fuzz-2",
            written1,
            false,
            enableExpr,
        );
        const written2 = writeGrammarRules(parsed2);

        if (written1 !== written2) {
            return {
                grammarIndex,
                grammarText,
                validation: "roundtrip-text",
                passed: false,
                error:
                    `Writer is not idempotent.\n` +
                    `  First write:\n${written1}\n` +
                    `  Second write:\n${written2}`,
            };
        }
        return {
            grammarIndex,
            grammarText,
            validation: "roundtrip-text",
            passed: true,
        };
    } catch (e) {
        return {
            grammarIndex,
            grammarText,
            validation: "roundtrip-text",
            passed: false,
            error: `Exception: ${(e as Error).message}`,
        };
    }
}

/**
 * Strip fields that may differ between a freshly compiled Grammar and
 * one that has been serialized/deserialized:
 *   - `regexpCache`: lazily populated at match time.
 *   - `name` on RulesPart (type === "rules"): debug-only label, may be
 *     absent on the original but populated after deserialization.
 *
 * Both sides are normalized so comparison is purely structural.
 */
function stripVolatileFields(obj: unknown): unknown {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(stripVolatileFields);
    const rec = obj as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
        if (k === "regexpCache") continue;
        // RulesPart.name is a debug label that the serializer
        // round-trips but the compiler may or may not set.  Only
        // strip from RulesPart objects (type === "rules") to avoid
        // masking meaningful `name` fields on other node types
        // (e.g. CompiledVariableValueNode).
        if (k === "name" && rec.type === "rules") continue;
        out[k] = stripVolatileFields(v);
    }
    return out;
}

/**
 * Validate that `load -> grammarToJson -> grammarFromJson` produces
 * a structurally identical Grammar.
 */
export function validateJsonRoundTrip(
    grammarIndex: number,
    grammarText: string,
    gen: GeneratedGrammar,
): FuzzResult {
    try {
        const loadOpts: LoadGrammarRulesOptions = {
            startValueRequired: gen.startValueRequired,
            enableValueExpressions: gen.usesValueExpressions,
        };
        const grammar = loadGrammarRules("fuzz.grammar", grammarText, loadOpts);
        const json = grammarToJson(grammar);
        const restored = grammarFromJson(json);

        const a = JSON.stringify(stripVolatileFields(grammar));
        const b = JSON.stringify(stripVolatileFields(restored));
        if (a !== b) {
            return {
                grammarIndex,
                grammarText,
                validation: "roundtrip-json",
                passed: false,
                error:
                    `Grammar mismatch after JSON round-trip.\n` +
                    `  Diff (first 200 chars):\n` +
                    `    original: ${a.slice(0, 200)}\n` +
                    `    restored: ${b.slice(0, 200)}`,
            };
        }
        return {
            grammarIndex,
            grammarText,
            validation: "roundtrip-json",
            passed: true,
        };
    } catch (e) {
        return {
            grammarIndex,
            grammarText,
            validation: "roundtrip-json",
            passed: false,
            error: `Exception: ${(e as Error).message}`,
        };
    }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Run the full fuzz suite with the given configuration.
 *
 * Returns one {@link FuzzResult} per (grammar, validation, input) tuple.
 * The caller decides how to report them (Jest assertions, console, etc.).
 */
export function runFuzz(config: FuzzConfig): FuzzResult[] {
    const rng = makeRng(config.seed);
    const allResults: FuzzResult[] = [];

    for (let g = 0; g < config.count; g++) {
        const gen = buildRandomGrammar(rng, config.features, config.generator);

        if (config.verbose) {
            process.stdout.write(`\n── grammar #${g} ──\n${gen.text}\n`);
        }

        // Build the input set.
        const extraCount = Math.max(
            0,
            config.inputsPerGrammar - gen.testInputs.length,
        );
        const extraInputs = generateExtraInputs(
            rng,
            extraCount,
            config.generator.words,
        );
        const inputs = [...gen.testInputs, ...extraInputs];

        for (const validation of config.validations) {
            let results: FuzzResult[];

            switch (validation) {
                case "optimizer":
                    results = validateOptimizerEquivalence(
                        g,
                        gen.text,
                        inputs,
                        gen,
                    );
                    break;
                case "roundtrip-text":
                    results = [validateTextRoundTrip(g, gen.text, gen)];
                    break;
                case "roundtrip-json":
                    results = [validateJsonRoundTrip(g, gen.text, gen)];
                    break;
            }

            if (config.verbose) {
                for (const r of results) {
                    const tag = r.passed ? "PASS" : "FAIL";
                    const inputTag =
                        r.input !== undefined ? ` '${r.input}'` : "";
                    process.stdout.write(
                        `  [${tag}] ${r.validation}${inputTag}${r.error ? `: ${r.error.split("\n")[0]}` : ""}\n`,
                    );
                }
            }

            allResults.push(...results);
        }
    }

    return allResults;
}

// Re-export generator types and helpers for the CLI and tests.
export { makeRng, pick, intInRange, generateExtraInputs };
export type { FuzzFeatureFlags, GeneratorConfig, GeneratedGrammar };
export {
    DEFAULT_FEATURES,
    MINIMAL_FEATURES,
    DEFAULT_GENERATOR_CONFIG,
    FEATURE_FIELDS,
    buildRandomGrammar,
    weightedPick,
    pickSpacingMode,
    clamp01,
} from "./grammarGenerator.js";
export type { FeatureFieldDescriptor } from "./grammarGenerator.js";
