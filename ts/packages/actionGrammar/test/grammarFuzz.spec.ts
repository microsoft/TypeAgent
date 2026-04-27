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
    MINIMAL_FEATURES,
} from "../src/fuzz/fuzzHarness.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Deep-merge a partial feature override over the defaults.  Each
 * sub-group (`partKinds`, `values`, `spacing`, `groups`) is merged
 * independently, with `spacing.modes` merged one level deeper.
 */
type FeaturesOverride = {
    partKinds?: Partial<FuzzConfig["features"]["partKinds"]>;
    values?: Partial<FuzzConfig["features"]["values"]>;
    spacing?: Partial<Omit<FuzzConfig["features"]["spacing"], "modes">> & {
        modes?: Partial<FuzzConfig["features"]["spacing"]["modes"]>;
    };
    groups?: Partial<FuzzConfig["features"]["groups"]>;
};

function mergeFeatures(
    base: FuzzConfig["features"],
    over: FeaturesOverride | undefined,
): FuzzConfig["features"] {
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

/**
 * Run the harness and emit one `it()` per result so Jest reports
 * individual grammar/input failures.
 */
function fuzzDescribe(
    name: string,
    configOverrides: Omit<Partial<FuzzConfig>, "features" | "generator"> & {
        features?: FeaturesOverride;
        generator?: Partial<FuzzConfig["generator"]>;
    },
): void {
    describe(name, () => {
        // Merge config.  Per-dimension tests intentionally start from
        // MINIMAL_FEATURES (only literals + ruleRefs enabled) so they
        // isolate the dimension under test rather than inheriting the
        // broad-coverage defaults.
        const config: FuzzConfig = {
            ...DEFAULT_CONFIG,
            ...configOverrides,
            features: mergeFeatures(MINIMAL_FEATURES, configOverrides.features),
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
        partKinds: { literal: 1, ruleRef: 1 },
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
        partKinds: { literal: 1, ruleRef: 1, wildcard: 1, number: 1 },
        values: { attachProb: 0.7 },
    },
    validations: ["optimizer"],
});

fuzzDescribe("Fuzz: parse-write round-trip", {
    seed: 0xf0222,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 1, wildcard: 1, number: 1 },
        values: { attachProb: 0.7 },
    },
    validations: ["roundtrip-text"],
});

fuzzDescribe("Fuzz: spacing modes (optimizer equivalence)", {
    seed: 0xf0223,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 1 },
        spacing: { altProb: 0.3, ruleProb: 0.4 },
    },
    validations: ["optimizer"],
});

fuzzDescribe("Fuzz: JSON serialization round-trip", {
    seed: 0xf0224,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 1, wildcard: 1, number: 1 },
    },
    validations: ["roundtrip-json"],
});

fuzzDescribe("Fuzz: optional / repeat groups (optimizer equivalence)", {
    seed: 0xf0225,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 1 },
        groups: { optionalProb: 0.4, repeatProb: 0.3 },
    },
    validations: ["optimizer"],
});

fuzzDescribe("Fuzz: optional / repeat groups (parse-write round-trip)", {
    seed: 0xf0226,
    count: 30,
    features: {
        partKinds: { literal: 1, ruleRef: 1, wildcard: 1, number: 1 },
        groups: { optionalProb: 0.3, repeatProb: 0.3 },
    },
    validations: ["roundtrip-text", "roundtrip-json"],
});
