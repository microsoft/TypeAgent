// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Property-based equivalence fuzzer for the grammar optimizer.
 *
 * Delegates to the shared fuzz harness (`src/fuzz/fuzzHarness.ts`).
 * This file preserves backward compatibility with the original test
 * (same seed, same counts, literals + ruleRefs only, optimizer
 * equivalence validation).
 *
 * For interactive / extended runs, use the CLI:
 *   node ./dist/fuzz/fuzzRunner.js --help
 */

import {
    runFuzz,
    type FuzzConfig,
    DEFAULT_CONFIG,
} from "../src/fuzz/fuzzHarness.js";

const config: FuzzConfig = {
    ...DEFAULT_CONFIG,
    seed: 0xc0ffee,
    count: 40,
    inputsPerGrammar: 6,
    features: {
        ...DEFAULT_CONFIG.features,
        literals: true,
        ruleRefs: true,
    },
    validations: ["optimizer"],
    generator: {
        ...DEFAULT_CONFIG.generator,
        maxRules: 4,
        maxAlts: 4,
        maxParts: 4,
        words: ["a", "b", "c", "d", "e"],
    },
    verbose: false,
};

describe("Grammar Optimizer - Random equivalence fuzz", () => {
    const results = runFuzz(config);

    for (const r of results) {
        const inputTag = r.input !== undefined ? ` '${r.input}'` : "";
        it(`grammar #${r.grammarIndex} ${r.validation}${inputTag}`, () => {
            if (!r.passed) {
                throw new Error(r.error ?? "unknown failure");
            }
        });
    }
});
