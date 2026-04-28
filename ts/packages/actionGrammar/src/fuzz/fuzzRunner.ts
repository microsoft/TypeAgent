#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar fuzz-testing CLI.
 *
 * Primary entry point for interactive and extended CI fuzz runs.
 * Parses flags, builds a {@link FuzzConfig}, delegates to
 * {@link runFuzz}, reports results, and exits 0 (all pass) or 1.
 *
 * Usage:
 *   node ./dist/fuzz/fuzzRunner.js [flags]
 *
 * Examples:
 *   # Quick smoke test
 *   node ./dist/fuzz/fuzzRunner.js --seed 42 --count 10
 *
 *   # Wildcards + values, optimizer only, verbose
 *   node ./dist/fuzz/fuzzRunner.js --features wildcards,values --validation optimizer --verbose
 *
 *   # Extended run, all validations
 *   node ./dist/fuzz/fuzzRunner.js --count 500 --seed 0xdeadbeef
 *
 *   # JSON round-trip only, high width
 *   node ./dist/fuzz/fuzzRunner.js --validation roundtrip-json --width 8 --count 100
 */

import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import {
    runFuzz,
    DEFAULT_CONFIG,
    cloneFeatures,
    zeroAllFeatures,
    featureEntries,
    FEATURE_FIELDS,
    validateOptimizerEquivalence,
    validateTextRoundTrip,
    validateJsonRoundTrip,
    DEFAULT_OPTIMIZER_VARIANTS,
    type FuzzConfig,
    type FuzzResult,
    type FuzzFeatureFlags,
    type FuzzValidationKind,
    type OptimizerVariant,
} from "./fuzzHarness.js";
import type { GeneratedGrammar, GeneratorConfig } from "./grammarGenerator.js";

// ── Flag parsing ──────────────────────────────────────────────────────────────

function printUsage(): void {
    // Derive the optimizer-variant list from the canonical
    // DEFAULT_OPTIMIZER_VARIANTS table so adding/removing a variant
    // automatically updates the help text (no drift between code
    // and docs).
    const variantNames = DEFAULT_OPTIMIZER_VARIANTS.map((v) => v.name).join(
        ", ",
    );
    const lines = [
        "",
        "Grammar fuzz-testing CLI",
        "",
        "Usage: node ./dist/fuzz/fuzzRunner.js [flags]",
        "",
        "Flags:",
        "  --seed <N>           PRNG seed (decimal or 0x hex, default: 0xc0ffee)",
        "  --count <N>          Number of grammars to generate (default: 40)",
        "  --inputs <N>         Extra random inputs per grammar (default: 6)",
        "  --features <csv>     Comma-separated feature overrides.",
        "                       Each entry is `path` (= weight 1) or",
        "                       `path=<value>` where `path` is a dotted",
        "                       reference into the FuzzFeatureFlags tree:",
        "                         partKinds.{literal,ruleRef,wildcard,number,sharedPrefix,nestedRuleRef}",
        "                         values.attachProb",
        "                         spacing.{altProb,ruleProb,alignWithinRuleProb}",
        "                         spacing.modes.{required,optional,none,auto}",
        "                         groups.{optionalProb,repeatProb,singleAltGroupProb}",
        "                         vocabulary.{nonBoundaryProb,escapeProb,separatorInLiteralProb}",
        "                         shapes.{singleAltRuleProb,ruleRefReuseProb,tailFriendlyAltProb}",
        "                         comments.{lineProb,blockProb}",
        "                       Fields named `*Prob` are probabilities in",
        "                       [0,1]; other numeric fields are relative",
        "                       weights for a weighted random pick.  When",
        "                       --features is given, all weights/probs reset",
        "                       to 0 first; partKinds.literal stays at 1 as",
        "                       the fallback part kind unless overridden",
        "                       (e.g. `--features partKinds.wildcard=5`",
        "                       leaves literal=1, so wildcards are 5x as",
        "                       common as literals).",
        "  --validation <csv>   Comma-separated validations (default: all)",
        "                       Options: optimizer, roundtrip-text, roundtrip-json",
        "  --depth <N>          Max rules / nesting depth (default: 4)",
        "  --width <N>          Max alternatives per rule (default: 4)",
        "  --parts <N>          Max parts per alternative (default: 4)",
        "  --non-boundary-words <csv>",
        "                       Comma-separated secondary literal pool whose",
        "                       tokens are biased toward non-word-boundary",
        "                       characters (e.g. punctuation, digits).  Used",
        "                       in conjunction with `--features vocabulary.nonBoundaryProb=...`",
        "                       to stress dispatch eligibility logic.",
        "  --shared-prefix-words <csv>",
        "                       Comma-separated pool sampled by the",
        "                       `partKinds.sharedPrefix` and",
        "                       `shapes.tailFriendlyAltProb` knobs.",
        "                       Defaults to the first two of `words`.",
        "  --optimizer-variants <csv>",
        `                       Subset of {${variantNames}} to test under`,
        "                       the optimizer validation.  Defaults to all variants.",
        "  --require-optimizer-activity",
        "                       Fail the run if no grammar produced",
        "                       observable optimizer activity.  Useful to",
        "                       catch silent regressions where a refactor",
        "                       turns the optimizer into a no-op.",
        "  --repro <dir>        Write repro cases for failures into <dir>",
        "  --replay <dir>       Replay repro case(s) from a directory",
        "  --verbose            Print each grammar and per-input results",
        "  --help               Show this help message",
        "",
        "Examples:",
        "  node ./dist/fuzz/fuzzRunner.js --seed 42 --count 10",
        "  node ./dist/fuzz/fuzzRunner.js --features partKinds.wildcard,values.attachProb=0.7 --validation optimizer --verbose",
        "  node ./dist/fuzz/fuzzRunner.js --features partKinds.wildcard=5,partKinds.literal=1",
        "  node ./dist/fuzz/fuzzRunner.js --features spacing.altProb=0.3,spacing.modes.required=3",
        "  node ./dist/fuzz/fuzzRunner.js --count 500 --seed 0xdeadbeef",
        "  node ./dist/fuzz/fuzzRunner.js --replay ./repro-cases",
        "",
    ];
    console.log(lines.join("\n"));
}

// Dotted-path setters into FuzzFeatureFlags, derived from the
// canonical FEATURE_FIELDS table in grammarGenerator.ts.  Keys are
// lower-cased so CLI lookup is case-insensitive; canonical (camelCase)
// paths are kept around for human-readable diagnostics.
type FeatureSetter = (f: FuzzFeatureFlags, value: number) => void;
const FEATURE_PATHS: Record<string, FeatureSetter> = Object.fromEntries(
    FEATURE_FIELDS.map((field) => [field.path.toLowerCase(), field.set]),
);
const CANONICAL_FEATURE_PATHS: readonly string[] = FEATURE_FIELDS.map(
    (field) => field.path,
);

const VALIDATION_MAP: Record<string, FuzzValidationKind> = {
    optimizer: "optimizer",
    "roundtrip-text": "roundtrip-text",
    roundtriptext: "roundtrip-text",
    "roundtrip-json": "roundtrip-json",
    roundtripjson: "roundtrip-json",
};

function parseSeed(s: string): number {
    if (s.startsWith("0x") || s.startsWith("0X")) {
        return parseInt(s, 16);
    }
    return parseInt(s, 10);
}

type ParsedArgs = {
    config: FuzzConfig;
    reproDir?: string | undefined;
    replayDir?: string | undefined;
};

function parseArgs(argv: string[]): ParsedArgs {
    const config: FuzzConfig = {
        ...DEFAULT_CONFIG,
        features: cloneFeatures(DEFAULT_CONFIG.features),
        generator: { ...DEFAULT_CONFIG.generator },
        validations: [...DEFAULT_CONFIG.validations],
    };

    let reproDir: string | undefined;
    let replayDir: string | undefined;
    let featuresExplicit = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--help":
            case "-h":
                printUsage();
                process.exit(0);
                break; // unreachable, but satisfies lint
            case "--seed":
                config.seed = parseSeed(argv[++i]);
                break;
            case "--count":
                config.count = parseInt(argv[++i], 10);
                break;
            case "--inputs":
                config.inputsPerGrammar = parseInt(argv[++i], 10);
                break;
            case "--depth":
                config.generator.maxRules = parseInt(argv[++i], 10);
                break;
            case "--width":
                config.generator.maxAlts = parseInt(argv[++i], 10);
                break;
            case "--parts":
                config.generator.maxParts = parseInt(argv[++i], 10);
                break;
            case "--verbose":
            case "-v":
                config.verbose = true;
                break;
            case "--repro":
                reproDir = argv[++i];
                break;
            case "--replay":
                replayDir = argv[++i];
                break;
            case "--features": {
                if (!featuresExplicit) {
                    // First --features resets all to 0, then applies
                    // the listed overrides.  partKinds.literal stays at
                    // 1 as the fallback part kind unless overridden.
                    zeroAllFeatures(config.features);
                    config.features.partKinds.literal = 1;
                    featuresExplicit = true;
                }
                const parts = argv[++i].split(",");
                for (const p of parts) {
                    const trimmed = p.trim();
                    if (!trimmed) continue;
                    const eq = trimmed.indexOf("=");
                    const rawPath = eq >= 0 ? trimmed.slice(0, eq) : trimmed;
                    const rawValue = eq >= 0 ? trimmed.slice(eq + 1) : "1";
                    const setter = FEATURE_PATHS[rawPath.trim().toLowerCase()];
                    if (!setter) {
                        console.error(
                            `Unknown feature path: ${rawPath.trim()}.  Valid paths: ${CANONICAL_FEATURE_PATHS.join(", ")}`,
                        );
                        process.exit(1);
                    }
                    const value = Number(rawValue);
                    if (!Number.isFinite(value) || value < 0) {
                        console.error(
                            `Invalid value for feature '${rawPath.trim()}': ${rawValue}`,
                        );
                        process.exit(1);
                    }
                    setter(config.features, value);
                }
                break;
            }
            case "--validation": {
                const parts = argv[++i].split(",");
                config.validations = [];
                for (const p of parts) {
                    const kind = VALIDATION_MAP[p.trim().toLowerCase()];
                    if (!kind) {
                        console.error(
                            `Unknown validation: ${p.trim()}.  Valid: ${Object.keys(VALIDATION_MAP).join(", ")}`,
                        );
                        process.exit(1);
                    }
                    config.validations.push(kind);
                }
                break;
            }
            case "--non-boundary-words": {
                const list = argv[++i]
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0);
                config.generator.nonBoundaryWords = list;
                break;
            }
            case "--shared-prefix-words": {
                const list = argv[++i]
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0);
                config.generator.sharedPrefixWords = list;
                break;
            }
            case "--optimizer-variants": {
                const wanted = argv[++i]
                    .split(",")
                    .map((s) => s.trim().toLowerCase())
                    .filter((s) => s.length > 0);
                const byName = new Map<string, OptimizerVariant>(
                    DEFAULT_OPTIMIZER_VARIANTS.map((v) => [
                        v.name.toLowerCase(),
                        v,
                    ]),
                );
                const picked: OptimizerVariant[] = [];
                for (const name of wanted) {
                    const v = byName.get(name);
                    if (!v) {
                        console.error(
                            `Unknown optimizer variant: ${name}.  Valid: ${DEFAULT_OPTIMIZER_VARIANTS.map((x) => x.name).join(", ")}`,
                        );
                        process.exit(1);
                    }
                    picked.push(v);
                }
                config.optimizerVariants = picked;
                break;
            }
            case "--require-optimizer-activity":
                config.requireAnyOptimizerActivity = true;
                break;
            default:
                console.error(`Unknown flag: ${arg}`);
                printUsage();
                process.exit(1);
        }
    }

    return { config, reproDir, replayDir };
}

// ── Repro case writer ─────────────────────────────────────────────────────────

function writeReproCases(
    reproDir: string,
    failures: FuzzResult[],
    config: FuzzConfig,
): void {
    fs.mkdirSync(reproDir, { recursive: true });

    for (const f of failures) {
        const variantSlug =
            f.optimizerVariant !== undefined ? `-${f.optimizerVariant}` : "";
        const slug = `grammar-${String(f.grammarIndex).padStart(3, "0")}-${f.validation}${variantSlug}`;
        const caseDir = path.join(reproDir, slug);
        fs.mkdirSync(caseDir, { recursive: true });

        // Write the grammar source.
        fs.writeFileSync(path.join(caseDir, "grammar.agr"), f.grammarText);

        // Write metadata for reproduction.
        const meta = {
            seed: `0x${config.seed.toString(16)}`,
            grammarIndex: f.grammarIndex,
            validation: f.validation,
            optimizerVariant: f.optimizerVariant,
            input: f.input,
            error: f.error,
            features: config.features,
            generator: config.generator,
        };
        fs.writeFileSync(
            path.join(caseDir, "repro.json"),
            JSON.stringify(meta, null, 2) + "\n",
        );
    }
}

// ── Replay ────────────────────────────────────────────────────────────────────

type ReproMeta = {
    seed: string;
    grammarIndex: number;
    validation: FuzzValidationKind;
    optimizerVariant?: string;
    input?: string;
    error?: string;
    features: FuzzFeatureFlags;
    generator: GeneratorConfig;
};

/**
 * Discover repro case directories.  `dir` can point to either:
 *   - A single case directory (contains grammar.agr + repro.json)
 *   - A parent directory of multiple case directories
 */
function findReproDirs(dir: string): string[] {
    if (fs.existsSync(path.join(dir, "grammar.agr"))) {
        return [dir];
    }
    // Enumerate subdirectories that contain grammar.agr.
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
        .filter(
            (e) =>
                e.isDirectory() &&
                fs.existsSync(path.join(dir, e.name, "grammar.agr")),
        )
        .map((e) => path.join(dir, e.name))
        .sort();
}

function replayReproCases(dir: string): number {
    const caseDirs = findReproDirs(dir);
    if (caseDirs.length === 0) {
        console.error(chalk.red(`No repro cases found in ${dir}`));
        return 1;
    }

    console.log(
        chalk.bold(`Replaying ${caseDirs.length} repro case(s) from ${dir}`),
    );
    console.log();

    let totalPassed = 0;
    let totalFailed = 0;

    for (const caseDir of caseDirs) {
        const caseName = path.basename(caseDir);
        const grammarText = fs.readFileSync(
            path.join(caseDir, "grammar.agr"),
            "utf-8",
        );
        const meta: ReproMeta = JSON.parse(
            fs.readFileSync(path.join(caseDir, "repro.json"), "utf-8"),
        );

        // Construct a minimal GeneratedGrammar for the validation functions.
        const gen: GeneratedGrammar = {
            text: grammarText,
            testInputs: [],
            usesValueExpressions: meta.features.values.attachProb > 0,
            startValueRequired: false,
        };

        let results: FuzzResult[];
        switch (meta.validation) {
            case "optimizer": {
                const inputs = meta.input !== undefined ? [meta.input] : [];
                // Honor the variant the failure was originally captured
                // under (defaults to all variants if absent).
                const variants =
                    meta.optimizerVariant !== undefined
                        ? DEFAULT_OPTIMIZER_VARIANTS.filter(
                              (v) => v.name === meta.optimizerVariant,
                          )
                        : undefined;
                results = validateOptimizerEquivalence(
                    meta.grammarIndex,
                    grammarText,
                    inputs,
                    gen,
                    variants ?? DEFAULT_OPTIMIZER_VARIANTS,
                );
                break;
            }
            case "roundtrip-text":
                results = [
                    validateTextRoundTrip(meta.grammarIndex, grammarText, gen),
                ];
                break;
            case "roundtrip-json":
                results = [
                    validateJsonRoundTrip(meta.grammarIndex, grammarText, gen),
                ];
                break;
        }

        const passed = results.every((r) => r.passed);
        if (passed) {
            totalPassed++;
            console.log(chalk.green(`  PASS  ${caseName}`));
        } else {
            totalFailed++;
            console.log(chalk.red(`  FAIL  ${caseName}`));
            for (const r of results.filter((r) => !r.passed)) {
                const inputTag =
                    r.input !== undefined ? ` input='${r.input}'` : "";
                console.log(chalk.red(`        ${r.validation}${inputTag}`));
                if (r.error) {
                    for (const line of r.error.split("\n").slice(0, 4)) {
                        console.log(chalk.red(`          ${line}`));
                    }
                }
            }
        }
    }

    console.log();
    if (totalFailed > 0) {
        console.log(
            chalk.red.bold(
                `FAILED: ${totalFailed}/${totalPassed + totalFailed} case(s)`,
            ),
        );
    } else {
        console.log(
            chalk.green.bold(
                `PASSED: ${totalPassed}/${totalPassed + totalFailed} case(s)`,
            ),
        );
    }

    return totalFailed > 0 ? 1 : 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
    const { config, reproDir, replayDir } = parseArgs(process.argv.slice(2));

    // Replay mode: re-run saved repro cases and exit.
    if (replayDir) {
        process.exit(replayReproCases(replayDir));
    }

    // Print configuration summary.
    const enabledFeatures = Array.from(featureEntries(config.features))
        .filter(([, v]) => v > 0)
        .map(([k, v]) => (v === 1 ? k : `${k}=${v}`))
        .join(", ");

    console.log(chalk.bold("Grammar Fuzz Runner"));
    console.log(`  seed:        0x${config.seed.toString(16)}`);
    console.log(`  count:       ${config.count}`);
    console.log(`  inputs/gram: ${config.inputsPerGrammar}`);
    console.log(`  features:    ${enabledFeatures || "(none)"}`);
    console.log(`  validations: ${config.validations.join(", ")}`);
    if (config.validations.includes("optimizer")) {
        const variantNames = (
            config.optimizerVariants ?? DEFAULT_OPTIMIZER_VARIANTS
        )
            .map((v) => v.name)
            .join(", ");
        console.log(`  opt variants: ${variantNames}`);
    }
    console.log(
        `  generator:   depth=${config.generator.maxRules} width=${config.generator.maxAlts} parts=${config.generator.maxParts}`,
    );
    if (config.generator.nonBoundaryWords?.length) {
        console.log(
            `  non-boundary words: ${config.generator.nonBoundaryWords.join(",")}`,
        );
    }
    if (config.generator.sharedPrefixWords?.length) {
        console.log(
            `  shared-prefix words: ${config.generator.sharedPrefixWords.join(",")}`,
        );
    }
    if (config.requireAnyOptimizerActivity) {
        console.log(`  require optimizer activity: yes`);
    }
    console.log();

    const results = runFuzz(config);

    // Summary.
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const total = results.length;

    // Optimizer-activity rollup: per-variant count of grammars that
    // produced any observable optimizer change.  Useful diagnostic
    // when a fuzz run otherwise has nothing to report - tells the
    // caller whether the configured features actually feed the
    // optimizer's preconditions.
    if (config.validations.includes("optimizer")) {
        const perVariant = new Map<
            string,
            { active: Set<number>; total: Set<number> }
        >();
        for (const r of results) {
            if (
                r.validation !== "optimizer" ||
                r.optimizerVariant === undefined
            ) {
                continue;
            }
            let bucket = perVariant.get(r.optimizerVariant);
            if (!bucket) {
                bucket = { active: new Set(), total: new Set() };
                perVariant.set(r.optimizerVariant, bucket);
            }
            bucket.total.add(r.grammarIndex);
            if (r.optimizerActivity === true) {
                bucket.active.add(r.grammarIndex);
            }
        }
        if (perVariant.size > 0) {
            console.log();
            console.log(chalk.bold("Optimizer activity (grammars/total):"));
            for (const [name, b] of perVariant) {
                console.log(`  ${name}: ${b.active.size}/${b.total.size}`);
            }
        }
    }

    console.log();
    if (failed > 0) {
        const failures = results.filter((r) => !r.passed);

        console.log(chalk.red.bold(`FAILED: ${failed}/${total} checks`));
        const show = Math.min(failures.length, 10);
        for (let i = 0; i < show; i++) {
            const f = failures[i];
            const inputTag = f.input !== undefined ? ` input='${f.input}'` : "";
            const variantTag =
                f.optimizerVariant !== undefined
                    ? ` [${f.optimizerVariant}]`
                    : "";
            console.log(
                chalk.red(
                    `  grammar #${f.grammarIndex} ${f.validation}${variantTag}${inputTag}`,
                ),
            );
            if (f.error) {
                for (const line of f.error.split("\n").slice(0, 4)) {
                    console.log(chalk.red(`    ${line}`));
                }
            }
        }
        if (failures.length > show) {
            console.log(chalk.red(`  ... and ${failures.length - show} more`));
        }

        // Write repro cases if requested.
        if (reproDir) {
            writeReproCases(reproDir, failures, config);
            console.log(
                chalk.yellow(
                    `\nRepro cases written to ${reproDir}/ (${failures.length} case(s))`,
                ),
            );
        }
    } else {
        console.log(chalk.green.bold(`PASSED: ${passed}/${total} checks`));
    }

    process.exit(failed > 0 ? 1 : 0);
}

main();
