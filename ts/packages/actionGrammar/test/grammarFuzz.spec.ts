// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * CI-oriented fuzz tests for the grammar system.
 *
 * Each `describe` block is a fixed-config call to the harness for one
 * fuzz dimension.  All validation logic lives in
 * `src/fuzz/fuzzHarness.ts`; this file just wires configs to Jest
 * `it()` assertions so they run in CI.
 *
 * For interactive / extended runs, use the CLI instead:
 *   node ./dist/fuzz/fuzzRunner.js --help
 */

import {
    runFuzz,
    type FuzzConfig,
    type FuzzResult,
    DEFAULT_CONFIG,
} from "../src/fuzz/fuzzHarness.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Run the harness and emit one `it()` per result so Jest reports
 * individual grammar/input failures.
 */
function fuzzDescribe(
    name: string,
    configOverrides: Omit<Partial<FuzzConfig>, "features" | "generator"> & {
        features?: Partial<FuzzConfig["features"]>;
        generator?: Partial<FuzzConfig["generator"]>;
    },
): void {
    describe(name, () => {
        // Merge config.
        const config: FuzzConfig = {
            ...DEFAULT_CONFIG,
            ...configOverrides,
            features: {
                ...DEFAULT_CONFIG.features,
                ...(configOverrides.features ?? {}),
            },
            generator: {
                ...DEFAULT_CONFIG.generator,
                ...(configOverrides.generator ?? {}),
            },
            validations:
                configOverrides.validations ?? DEFAULT_CONFIG.validations,
            verbose: false,
        };

        // Generate results eagerly (outside `it`) so grammar generation
        // cost is paid once rather than per-test.
        let results: FuzzResult[];
        try {
            results = runFuzz(config);
        } catch (e) {
            it("harness runs without crash", () => {
                throw e;
            });
            return;
        }

        if (results.length === 0) {
            it("generates at least one check", () => {
                throw new Error("No fuzz results produced");
            });
            return;
        }

        for (const r of results) {
            const inputTag = r.input !== undefined ? ` '${r.input}'` : "";
            it(`grammar #${r.grammarIndex} ${r.validation}${inputTag}`, () => {
                if (!r.passed) {
                    throw new Error(r.error ?? "unknown failure");
                }
            });
        }
    });
}

// ── Fuzz dimensions ───────────────────────────────────────────────────────────

// Original optimizer equivalence fuzz (formerly grammarOptimizerFuzz.spec.ts).
// Preserves the original seed + config for regression stability.
fuzzDescribe("Fuzz: optimizer equivalence (literals + ruleRefs)", {
    seed: 0xc0ffee,
    count: 40,
    inputsPerGrammar: 6,
    features: {
        literals: true,
        ruleRefs: true,
    },
    generator: {
        maxRules: 4,
        maxAlts: 4,
        maxParts: 4,
        words: ["a", "b", "c", "d", "e"],
    },
    validations: ["optimizer"],
});

fuzzDescribe("Fuzz: optimizer equivalence (wildcards + values)", {
    seed: 0xf0221,
    count: 30,
    features: {
        literals: true,
        ruleRefs: true,
        wildcards: true,
        numbers: true,
        values: true,
    },
    validations: ["optimizer"],
});

fuzzDescribe("Fuzz: parse-write round-trip", {
    seed: 0xf0222,
    count: 30,
    features: {
        literals: true,
        ruleRefs: true,
        wildcards: true,
        numbers: true,
        values: true,
    },
    validations: ["roundtrip-text"],
});

fuzzDescribe("Fuzz: spacing modes (optimizer equivalence)", {
    seed: 0xf0223,
    count: 30,
    features: {
        literals: true,
        ruleRefs: true,
        spacingModes: true,
    },
    validations: ["optimizer"],
});

fuzzDescribe("Fuzz: JSON serialization round-trip", {
    seed: 0xf0224,
    count: 30,
    features: {
        literals: true,
        ruleRefs: true,
        wildcards: true,
        numbers: true,
    },
    validations: ["roundtrip-json"],
});
